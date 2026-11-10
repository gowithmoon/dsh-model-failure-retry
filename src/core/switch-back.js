/**
 * Switch-back (GLOSSARY: 回切, #9): whether a session that fell back should
 * return to its origin model at the start of a new turn. Pure logic; the DSH
 * adapter (src/host/switch-back.js) decides when "start of a new turn" is.
 *
 * @typedef {{ enabled: boolean, intervalMs: number }} SwitchBackSettings
 */
import { sameModel } from './chain.js';

/** Defaults: off, 10 minutes. */
export const DEFAULT_SWITCH_BACK = Object.freeze({ enabled: false, intervalMs: 10 * 60_000 });

/**
 * @param {{ settings: SwitchBackSettings | undefined,
 *   origin: import('./types.js').ModelRef | undefined,
 *   current: import('./types.js').ModelRef | undefined,
 *   lastFailureAt: number | undefined, now: number }} input
 *   `lastFailureAt`: when the origin model last failed (ms), undefined if never seen.
 * @returns {boolean}
 */
export function switchBackDue({ settings, origin, current, lastFailureAt, now }) {
  if (!settings?.enabled || !origin || lastFailureAt === undefined) return false;
  if (sameModel(origin, current)) return false;
  return now - lastFailureAt >= settings.intervalMs;
}
