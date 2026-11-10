/**
 * Switch-back (GLOSSARY: 回切, #9), DSH side.
 *
 * Hook: the first `agent/inbox/claimed` of a new turn. dsh-agent-loop claims
 * the turn's messages and only then reads `agent.model.current()` for the
 * step, so a `select()` here applies to this very step. `agent/pre-step`
 * would be too late: it receives the step's selection already fixed, and a
 * select there only reaches the next step (the tool loop). Later claims of
 * the same turn (steps 2+) are ignored, so a tool loop never switches back.
 *
 * The follow-up turn after a switch (`source.kind === 'model-fallback'`) is a
 * continuation, not a new turn: it never switches back.
 *
 * Timer: the time the origin last failed, taken from decision events whose
 * `model` is their `origin`. A manual model change (current ≠ the model the
 * plugin selected) resets origin and timer, published as `origin-reset`.
 *
 * Switching back publishes `{kind:'switch-back', from, to}` (no `failure`)
 * and clears the fallback state, so the next failure of the origin starts a
 * fresh walk with the origin as start.
 */
import { switchBackDue } from '../core/switch-back.js';
import { label, sameModel, toRef } from '../core/chain.js';

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {{
 *   fallbacks: ReturnType<typeof import('./fallback-state.js').createFallbackStates>,
 *   publish: (agent: object, payload: object) => void,
 *   settings: () => import('../core/switch-back.js').SwitchBackSettings | undefined,
 *   decisionEvent: string,
 *   active: () => boolean,
 * }} deps
 */
export function installSwitchBack(ctx, { fallbacks, publish, settings, decisionEvent, active }) {
  /** @type {WeakMap<object, number>} when each agent's origin last failed */
  const lastFailureAt = new WeakMap();
  /** @type {WeakMap<object, number>} the last turn whose first claim we saw */
  const seenTurn = new WeakMap();

  ctx.on(decisionEvent, ({ agent, model, origin, decision }) => {
    if (decision?.kind === 'origin-reset') lastFailureAt.delete(agent);
    else if (sameModel(model, origin)) lastFailureAt.set(agent, Date.now());
  });

  ctx.on('agent/inbox/claimed', ({ agent, message, turn }) => {
    if (seenTurn.get(agent) === turn) return;
    seenTurn.set(agent, turn);
    if (!active() || message?.source?.kind === 'model-fallback') return;
    const current = agent.model?.current?.();
    if (!current) return;
    const model = toRef(current);
    if (fallbacks.syncManualChange(agent, model)) {
      lastFailureAt.delete(agent);
      publish(agent, { model, decision: { kind: 'origin-reset' } });
      return;
    }
    const { origin } = fallbacks.get(agent);
    if (!switchBackDue({ settings: settings(), origin, current: model, lastFailureAt: lastFailureAt.get(agent), now: Date.now() })) return;
    ctx.logger?.info?.(`switch back ${label(model)} → ${label(origin)}`);
    publish(agent, { model, decision: { kind: 'switch-back', from: model, to: origin } });
    fallbacks.clear(agent);
    lastFailureAt.delete(agent);
    agent.model.select(origin);
  });
}
