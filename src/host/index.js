/**
 * Host plugin: the DSH adapter around the decision core.
 *
 * Listens on `agent/request-error` with prepend (ADR 0001): for categories it
 * owns it never calls `next()`, so the builtin llm-retry cannot retry the same
 * failure again; only a `pass` decision calls `next()`.
 *
 * Fallback (#6, ADR 0002): `agent.model.select(candidate)`, let the turn end
 * with the error, and on `agent/status` idle start a follow-up turn with
 * `agent.followup(...)`. When the whole chain failed, select the origin back.
 *
 * Every decision is published as `model-failure-retry/decision` (see
 * `DECISION_EVENT`) for the status line (#7), stats (#8) and switch-back (#9).
 */
import { randomUUID } from 'node:crypto';
import { matchChain, sameModel } from '../core/chain.js';
import { decide } from '../core/decide.js';
import { createFallbackStates } from './fallback-state.js';
import { createRequestStates } from './request-state.js';
import { installSwitchBack } from './switch-back.js';
import { Config, snapshotConfig } from './schema.js';
import { wait } from './wait.js';

export const name = 'dsh-model-failure-retry';
export { Config };

/** Cordis event carrying every decision; payload: see docs/architecture.md. */
export const DECISION_EVENT = 'model-failure-retry/decision';
/** Text of the follow-up message after a switch (ADR 0002: short, non-empty). */
export const FOLLOWUP_TEXT = 'Continue.';

const label = (ref) => `${ref.provider}/${ref.model}`;
const keyOf = label;

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {ReturnType<typeof Config>} config
 */
export function apply(ctx, config) {
  // Own settings page instead of the auto-generated form; optional service.
  ctx.inject(['settings'], (sub) => {
    sub.effect(() => sub.settings.configure({ auto: false }, ctx.fiber), 'model-failure-retry: settings policy');
  });

  const lifetime = new AbortController();
  ctx.effect(() => () => lifetime.abort(new Error('model-failure-retry disposed')), 'model-failure-retry: lifetime');

  const requests = createRequestStates();
  const fallbacks = createFallbackStates();

  /** Publish one decision to observers (#7/#8/#9). Never lets an observer break recovery. */
  function publish(agent, payload) {
    const { origin, tried } = fallbacks.get(agent);
    try {
      ctx.emit(DECISION_EVENT, { agent, ...payload, origin, tried: [...tried] });
    } catch (error) {
      ctx.logger?.warn?.(`decision observer failed: ${error}`);
    }
  }

  installSwitchBack(ctx, {
    fallbacks,
    publish,
    decisionEvent: DECISION_EVENT,
    settings: () => snapshotConfig(config).switchBack,
    active: () => !lifetime.signal.aborted && config.enabled.get(),
  });

  /** Model info for each candidate of the chain `start` matches: Map key → info | null (missing). */
  async function candidateInfos(start, chains) {
    const llm = ctx.get('llm');
    const chain = matchChain(start, chains)?.chain;
    const infos = new Map();
    if (!llm || !chain) return infos;
    await Promise.all(chain.candidates.map(async (c) => {
      const info = await llm.resolveModelInfo(c.provider, c.model).catch(() => null);
      infos.set(keyOf(c), info);
    }));
    return infos;
  }

  /** The selection for a candidate: keep the reasoning effort if it supports it, else its default. */
  function selectionFor(to, info, effort) {
    const supported = effort && info?.reasoning?.efforts?.some((e) => e.id === effort);
    return supported ? { provider: to.provider, model: to.model, reasoningEffort: effort } : { provider: to.provider, model: to.model };
  }

  ctx.on('agent/request-error', async (payload, next) => {
    const { agent, turn, step, provider, failure, signal } = payload;
    if (lifetime.signal.aborted) return next();
    const current = agent.model?.current?.() ?? { provider, model: '' };
    const model = { provider: current.provider, model: current.model };
    if (fallbacks.syncManualChange(agent, model)) publish(agent, { model, failure, decision: { kind: 'origin-reset' } });
    const state = requests.get(agent, { turn, step, model });
    const core = snapshotConfig(config);
    const requestState = { attempts: state.attempts, model, episode: fallbacks.episode(agent) };
    let decision = decide(failure, requestState, core);
    if (leavesModel(decision)) {
      // Only now look up which candidates still exist (async), then decide again.
      const infos = await candidateInfos(requestState.episode?.start ?? model, core.chains);
      const isAvailable = (ref) => !infos.has(keyOf(ref)) || infos.get(keyOf(ref)) !== null;
      decision = decide(failure, requestState, core, { isAvailable });
      return leave(agent, decision, { model, current, failure, signal, infos });
    }
    publish(agent, { model, failure, decision });

    switch (decision.kind) {
      case 'pass':
        return next();
      case 'retry': {
        ctx.logger?.info?.(
          `retry ${decision.attempt}/${decision.maxAttempts} in ${decision.delayMs}ms after ${failure.code} on ${label(model)}`,
        );
        const elapsed = await wait(decision.delayMs, AbortSignal.any([signal, lifetime.signal]));
        if (!elapsed) return undefined;
        state.attempts = decision.attempt;
        return { kind: 'retry' };
      }
      default:
        ctx.logger?.info?.(`give up (${decision.reason}) after ${failure.code} on ${label(model)}`);
        return undefined;
    }
  }, { prepend: true });

  /**
   * Leave the current model: walk skips, then switch to the candidate or —
   * when the chain is exhausted — back to the origin. The turn always ends
   * with the error (returns undefined).
   */
  function leave(agent, decision, { model, current, failure, signal, infos }) {
    if (signal.aborted || lifetime.signal.aborted) return undefined;
    const fb = fallbacks.get(agent);
    const firstSwitch = !fb.origin;
    if (firstSwitch) fb.origin = current;
    if (!fb.tried.some((t) => sameModel(t, model))) fb.tried.push(model);
    while (decision.kind === 'skip') {
      ctx.logger?.info?.(`skip ${label(decision.target)} (${decision.reason})`);
      if (!fb.tried.some((t) => sameModel(t, decision.target))) fb.tried.push(decision.target);
      publish(agent, { model, failure, decision: { kind: 'skip', target: decision.target, reason: decision.reason } });
      decision = decision.then;
    }

    if (decision.kind === 'fallback') {
      const selection = selectionFor(decision.to, infos.get(keyOf(decision.to)), current.reasoningEffort);
      ctx.logger?.info?.(`fallback ${label(model)} → ${label(selection)} (${decision.reason})`);
      fb.tried.push({ provider: selection.provider, model: selection.model });
      fb.selected = selection;
      fb.pending = { signal, summary: `${label(model)} failed (${decision.reason}); switched to ${label(selection)}` };
      agent.model.select(selection);
      publish(agent, { model, failure, decision: { ...decision, selection } });
      return undefined;
    }

    // give-up: chain exhausted (or no chain). Back to the origin, if we ever left it.
    const origin = fb.origin;
    ctx.logger?.info?.(`give up (${decision.reason}) after ${failure.code} on ${label(model)}`);
    publish(agent, { model, failure, decision });
    fallbacks.clear(agent);
    if (origin && !sameModel(origin, model)) agent.model.select(origin);
    return undefined;
  }

  ctx.on('agent/status', ({ agent, status }) => {
    if (status !== 'idle') return;
    const fb = fallbacks.get(agent);
    const pending = fb.pending;
    if (!pending) {
      // A turn ended without a switch: the next failure starts a fresh walk (origin is kept for #9).
      fb.tried = [];
      return;
    }
    fb.pending = undefined;
    if (pending.signal.aborted || lifetime.signal.aborted) return;
    agent.followup(Object.freeze({
      role: 'user',
      id: randomUUID(),
      content: [{ type: 'text', text: FOLLOWUP_TEXT }],
      source: { kind: 'model-fallback', form: 'notice', summary: pending.summary },
    }));
  });
}

/** Whether a decision moves off the current model (needs candidate lookup). */
function leavesModel(decision) {
  return decision.kind === 'fallback' || decision.kind === 'skip'
    || (decision.kind === 'give-up' && decision.reason === 'chain-exhausted');
}
