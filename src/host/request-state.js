/**
 * Retry counters, one per agent, keyed by "request × model": the counter
 * restarts when the turn/step or the model changes. A retry re-runs the same
 * step, so consecutive failures of one request share the key.
 *
 * Extension (#6): fallback state (origin model, chain, tried candidates)
 * belongs beside `attempts` in the per-agent record.
 */
import { label } from '../core/chain.js';

export function createRequestStates() {
  /** @type {WeakMap<object, { key: string, attempts: number }>} */
  const byAgent = new WeakMap();

  return {
    /** @returns {{ key: string, attempts: number }} the live record for this request. */
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
