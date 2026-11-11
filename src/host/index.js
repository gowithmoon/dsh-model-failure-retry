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
import { label, matchChain, sameModel, toRef } from '../core/chain.js';
import { classify } from '../core/classify.js';
import { decide, leavesModel } from '../core/decide.js';
import { createFallbackStates } from './fallback-state.js';
import { createRequestStates } from './request-state.js';
import { installSwitchBack } from './switch-back.js';
import { FALLBACK_SOURCE_KIND, installStatusProjection, recordRetry, recordRetryStarted } from './status-projection.js';
import { installStats } from './stats.js';
import { installSessionStore } from './session-store.js';
import { Config, snapshotConfig } from './schema.js';
import { wait } from './wait.js';

export const name = 'dsh-model-failure-retry';
export { Config };

/** Cordis event carrying every decision; payload: see docs/architecture.md. */
export const DECISION_EVENT = 'model-failure-retry/decision';
/** Text of the follow-up message after a switch (ADR 0002: short, non-empty). */
export const FOLLOWUP_TEXT = 'Continue.';

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
  const sessions = installSessionStore(ctx);
  const fallbacks = createFallbackStates({ persist: sessions });

  /** Publish one decision to observers (#7/#8/#9). Never lets an observer break recovery. */
  function publish(agent, payload) {
    const { origin, tried } = fallbacks.get(agent);
    try {
      ctx.emit(DECISION_EVENT, { agent, ...payload, origin, tried: [...tried] });
    } catch (error) {
      ctx.logger?.warn?.(`decision observer failed: ${error}`);
    }
  }

  installStatusProjection(ctx);

  /**
   * The user stopped the turn (agent.cancel / DSH stop) while we were waiting
   * or had just switched: drop the episode and select the origin back.
   */
  function stopped(agent, { model, failure }) {
    if (lifetime.signal.aborted) return;
    const { origin } = fallbacks.get(agent);
    ctx.logger?.info?.(`stopped by the user on ${label(model)}`);
    publish(agent, { model, ...(failure ? { failure } : {}), decision: { kind: 'stopped' } });
    fallbacks.clear(agent);
    if (origin && !sameModel(origin, agent.model.current())) agent.model.select(origin);
  }

  installStats(ctx, {
    decisionEvent: DECISION_EVENT,
    retentionDays: () => config.stats.retentionDays.get(),
    rules: () => config.rules.get(),
  });

  installSwitchBack(ctx, {
    fallbacks,
    persist: sessions,
    publish,
    decisionEvent: DECISION_EVENT,
    settings: () => snapshotConfig(config).switchBack,
    active: () => !lifetime.signal.aborted && config.enabled.get(),
  });

  function logGiveUp(decision, failure, model) {
    ctx.logger?.info?.(`give up (${decision.reason}) after ${failure.code} on ${label(model)}`);
  }

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
    return supported ? { ...toRef(to), reasoningEffort: effort } : toRef(to);
  }

  ctx.on('agent/request-error', async (payload, next) => {
    const { agent, turn, step, provider, failure, signal } = payload;
    if (lifetime.signal.aborted) return next();
    const current = agent.model?.current?.() ?? { provider, model: '' };
    const model = toRef(current);
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
        if (signal.aborted) {
          stopped(agent, { model, failure });
          return undefined;
        }
        ctx.logger?.info?.(
          `retry ${decision.attempt}/${decision.maxAttempts} in ${decision.delayMs}ms after ${failure.code} on ${label(model)}`,
        );
        const retry = recordRetry(agent, { state, turn, step, provider: model.provider, failure, decision, category: classify(failure, core.rules).category });
        const elapsed = await wait(decision.delayMs, AbortSignal.any([signal, lifetime.signal]));
        if (!elapsed) {
          if (signal.aborted) stopped(agent, { model, failure });
          return undefined;
        }
        recordRetryStarted(agent, retry);
        state.attempts = decision.attempt;
        return { kind: 'retry' };
      }
      default:
        logGiveUp(decision, failure, model);
        return undefined;
    }
  }, { prepend: true });

  /**
   * Leave the current model: walk skips, then switch to the candidate or —
   * when the chain is exhausted — back to the origin. The turn always ends
   * with the error (returns undefined).
   */
  function leave(agent, decision, { model, current, failure, signal, infos }) {
    if (lifetime.signal.aborted) return undefined;
    if (signal.aborted) {
      // The user stopped during the candidate lookup.
      stopped(agent, { model, failure });
      return undefined;
    }
    fallbacks.leave(agent, { current, model });
    while (decision.kind === 'skip') {
      ctx.logger?.info?.(`skip ${label(decision.target)} (${decision.reason})`);
      fallbacks.markTried(agent, decision.target);
      publish(agent, { model, failure, decision: { kind: 'skip', target: decision.target, reason: decision.reason } });
      decision = decision.then;
    }

    if (decision.kind === 'fallback') {
      const selection = selectionFor(decision.to, infos.get(keyOf(decision.to)), current.reasoningEffort);
      ctx.logger?.info?.(`fallback ${label(model)} → ${label(selection)} (${decision.reason})`);
      fallbacks.switchTo(agent, selection, {
        signal, from: model, to: toRef(selection),
        summary: `${label(model)} failed (${decision.reason}); switched to ${label(selection)}`,
      });
      agent.model.select(selection);
      publish(agent, { model, failure, decision: { ...decision, selection } });
      return undefined;
    }

    // give-up: chain exhausted (or no chain). Back to the origin, if we ever left it.
    const { origin } = fallbacks.get(agent);
    logGiveUp(decision, failure, model);
    publish(agent, { model, failure, decision });
    fallbacks.clear(agent);
    if (origin && !sameModel(origin, model)) agent.model.select(origin);
    return undefined;
  }

  /** session → agent, for `session/event` (which carries only the session). */
  const agentOfSession = new WeakMap();
  ctx.on('agent/status', ({ agent }) => {
    if (agent?.session && typeof agent.session === 'object') agentOfSession.set(agent.session, agent);
  }, { prepend: true });

  // A user stop ends the fallback episode wherever it lands, also in the
  // follow-up turn on the candidate (P1): select the origin back.
  ctx.on('session/event', (session, event) => {
    if (event?.type !== 'turn/end') return;
    const reason = event.data?.reason;
    if (reason?.kind !== 'aborted' || reason.reason?.kind !== 'user') return;
    const agent = agentOfSession.get(session);
    if (!agent || !fallbacks.get(agent).origin) return;
    const current = agent.model?.current?.();
    stopped(agent, { model: current ? toRef(current) : fallbacks.get(agent).origin });
  });

  ctx.on('agent/status', ({ agent, status }) => {
    if (status !== 'idle') return;
    const pending = fallbacks.takePending(agent);
    if (!pending) return;
    if (lifetime.signal.aborted || !config.enabled.get()) return; // turned off meanwhile (P6): no follow-up
    if (pending.signal.aborted) {
      stopped(agent, { model: pending.to });
      return;
    }
    agent.followup(Object.freeze({
      role: 'user',
      id: randomUUID(),
      content: [{ type: 'text', text: FOLLOWUP_TEXT }],
      source: { kind: FALLBACK_SOURCE_KIND, form: 'notice', summary: pending.summary, from: pending.from, to: pending.to },
    }));
  });
}
