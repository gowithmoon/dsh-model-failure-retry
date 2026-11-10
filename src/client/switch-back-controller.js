/**
 * Switch-back (回切, #9) part of the settings section, over the plugin's
 * ConfigForm. Writes only `switchBack.enabled` and `switchBack.intervalMs`.
 */
import { DEFAULT_SWITCH_BACK } from '../core/switch-back.js';

/**
 * @param {import('./types.js').ConfigFormLike} form
 */
export function createSwitchBackController(form) {
  let source;
  let view;

  function derive() {
    const snap = form.getSnapshot();
    if (snap === source) return view;
    source = snap;
    const sb = { ...DEFAULT_SWITCH_BACK, ...snap.value?.switchBack };
    const next = {
      writable: snap.status === 'ready' && snap.writable,
      enabled: sb.enabled,
      intervalMs: sb.intervalMs,
    };
    // Keep the old view when nothing of ours changed (other fields edited).
    if (!view || Object.keys(next).some((k) => next[k] !== view[k])) view = Object.freeze(next);
    return view;
  }

  const mutate = (key, value) => form.mutate([{ op: 'set', path: ['switchBack', key], value }], form.getSnapshot().revision);

  return {
    getSnapshot: derive,
    subscribe: (listener) => form.subscribe(() => {
      const before = view;
      if (derive() !== before) listener();
    }),
    setEnabled: (on) => mutate('enabled', on),
    setIntervalMs: (ms) => mutate('intervalMs', ms),
  };
}

/** "10" / "0.5" (minutes) → milliseconds; undefined when not a non-negative number. */
export function parseMinutes(text) {
  if (!/^\s*\d+(\.\d+)?\s*$/.test(String(text))) return undefined;
  return Math.round(Number(text) * 60_000);
}
