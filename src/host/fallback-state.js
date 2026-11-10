/**
 * Per-session fallback state (#6), one record per agent:
 *
 * - `origin`   — 原模型: the model the session used before its first switch
 *                (with its reasoning effort); the switch-back target (#9).
 * - `tried`    — models already tried since the last turn that ended without a
 *                switch; together with `origin` it is the core's FallbackEpisode.
 * - `selected` — the model this plugin last selected. When the agent's model
 *                differs from it, the user changed models by hand: the state
 *                resets, so the next switch takes the user's pick as origin.
 * - `pending`  — a switch whose follow-up turn is due once the agent goes idle.
 *
 * A record without `origin` means "no switch in this session (any more)".
 */
import { sameModel } from '../core/chain.js';

/**
 * @typedef {import('../core/types.js').ModelRef & { reasoningEffort?: string }} Selection
 * @typedef {{ origin?: Selection, tried: import('../core/types.js').ModelRef[], selected?: Selection,
 *   pending?: { signal: AbortSignal, summary: string } }} FallbackState
 */
export function createFallbackStates() {
  /** @type {WeakMap<object, FallbackState>} */
  const byAgent = new WeakMap();

  /** @returns {FallbackState} */
  function get(agent) {
    let state = byAgent.get(agent);
    if (!state) {
      state = { tried: [] };
      byAgent.set(agent, state);
    }
    return state;
  }

  return {
    get,
    /**
     * Reset the record if the user picked another model since our last select.
     * @returns {boolean} whether it was reset.
     */
    syncManualChange(agent, current) {
      const state = get(agent);
      if (!state.origin || !state.selected || sameModel(state.selected, current)) return false;
      byAgent.set(agent, { tried: [] });
      return true;
    },
    /** The core's view of the episode, or undefined before any switch. */
    episode(agent) {
      const { origin, tried } = get(agent);
      return origin ? { start: origin, tried } : undefined;
    },
    clear(agent) {
      byAgent.set(agent, { tried: [] });
    },
  };
}
