/**
 * Retry counters, one per agent, keyed by "request × model": the counter
 * restarts when the turn/step or the model changes. A retry re-runs the same
 * step, so consecutive failures of one request share the key.
 *
 * `retryId` identifies one retry run in the status projection; it is set
 * lazily by status-projection.js `recordRetry` and dies with the record.
 * Fallback state (origin, tried candidates) lives in fallback-state.js.
 *
 * @typedef {{ key: string, attempts: number, retryId?: string }} RequestState
 */
import { label } from '../core/chain.js';

export function createRequestStates() {
  /** @type {WeakMap<object, RequestState>} */
  const byAgent = new WeakMap();

  return {
    /** @returns {RequestState} the live record for this request. */
    get(agent, { turn, step, model }) {
      const key = `${turn}:${step}:${label(model)}`;
      let state = byAgent.get(agent);
      if (state?.key !== key) {
        state = { key, attempts: 0 };
        byAgent.set(agent, state);
      }
      return state;
    },
  };
}
