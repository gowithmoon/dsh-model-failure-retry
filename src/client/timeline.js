/**
 * The settings timeline: the retry schedule laid out on a time axis with the
 * first failure at T0. Built on the same `retrySchedule` the runtime uses, so
 * what the page draws is what will happen (Retry-After aside).
 */
import { retrySchedule } from '../core/schedule.js';

/**
 * @param {import('../core/types.js').RetryPolicy} policy
 * @returns {{
 *   retries: { attempt: number, delayMs: number, atMs: number, minAtMs: number, maxAtMs: number }[],
 *   endMs: number, endMinMs: number, endMaxMs: number,
 * }} `atMs` is the nominal moment of each retry; `minAtMs..maxAtMs` its jitter
 * window, accumulated. `end*` is when the plugin gives up or falls back.
 */
export function timeline(policy) {
  let at = 0;
  let min = 0;
  let max = 0;
  const retries = retrySchedule(policy).map((step) => {
    at += step.delayMs;
    min += step.minMs;
    max += step.maxMs;
    return { attempt: step.attempt, delayMs: step.delayMs, atMs: at, minAtMs: min, maxAtMs: max };
  });
  return { retries, endMs: at, endMinMs: min, endMaxMs: max };
}
