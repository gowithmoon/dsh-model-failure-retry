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
 *
 * `origin` and `selected` are written through `persist` (P2), so a session
 * reopened after a DSH restart still knows its origin; a record not in memory
 * yet is loaded from it. `tried` and `pending` belong to the running turn and
 * are not kept.
 *
 * All changes go through the methods below; callers only read `get()`.
 */
import { sameModel, toRef } from '../core/chain.js';

/**
 * @typedef {import('../core/types.js').ModelRef} ModelRef
 * @typedef {ModelRef & { reasoningEffort?: string }} Selection
 * @typedef {{ origin?: Selection, tried: ModelRef[], selected?: Selection,
 *   pending?: { signal: AbortSignal, summary: string, from: ModelRef, to: ModelRef } }} FallbackState
 * @typedef {{
 *   load(agent: object): { origin?: Selection, selected?: Selection } | undefined,
 *   save(agent: object, fields: { origin?: Selection, selected?: Selection }): void,
 * }} FallbackPersistence
 */

/** @param {{ persist?: FallbackPersistence }} [options] */
export function createFallbackStates({ persist } = {}) {
  /** @type {WeakMap<object, FallbackState>} */
  const byAgent = new WeakMap();

  /** @returns {FallbackState} */
  function get(agent) {
    let state = byAgent.get(agent);
    if (!state) {
      const saved = persist?.load(agent);
      state = { tried: [], ...(saved?.origin ? { origin: saved.origin, selected: saved.selected } : {}) };
      byAgent.set(agent, state);
    }
    return state;
  }

  function save(agent) {
    const { origin, selected } = get(agent);
    persist?.save(agent, { origin, selected });
  }

  function reset(agent) {
    const had = !!get(agent).origin;
    byAgent.set(agent, { tried: [] });
    if (had) save(agent);
  }

  function markTried(agent, ref) {
    const { tried } = get(agent);
    if (!tried.some((t) => sameModel(t, ref))) tried.push(toRef(ref));
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
      reset(agent);
      return true;
    },
    /** The core's view of the episode, or undefined before any switch. */
    episode(agent) {
      const { origin, tried } = get(agent);
      return origin ? { start: origin, tried } : undefined;
    },
    /** End the episode: no origin, nothing tried. */
    clear: reset,
    /** Leaving `model`: `current` becomes the origin unless there is one already. */
    leave(agent, { current, model }) {
      const state = get(agent);
      if (!state.origin) {
        state.origin = current;
        save(agent);
      }
      markTried(agent, model);
    },
    markTried,
    /** Switched to `selection`; the follow-up turn is due once the agent goes idle. */
    switchTo(agent, selection, pending) {
      markTried(agent, selection);
      const state = get(agent);
      state.selected = selection;
      state.pending = pending;
      save(agent);
    },
    /**
     * The turn ended: hand out the pending switch, if any. A turn that ended
     * without a switch starts a fresh walk next time (the origin is kept for #9).
     */
    takePending(agent) {
      const state = get(agent);
      const { pending } = state;
      if (pending) state.pending = undefined;
      else state.tried = [];
      return pending;
    },
  };
}
