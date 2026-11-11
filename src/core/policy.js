/**
 * Retry policy defaults and resolution.
 *
 * `resolvePolicy(target, config)` picks the first override in
 * `config.overrides` whose `match` (provider/model wildcard) hits the target,
 * else the global `config.policy`. An override carries a complete policy of
 * its own; fields it leaves unset come from DEFAULT_POLICY, not from the
 * global policy. Keep the policy a plain object so the settings timeline and
 * the runtime share it.
 */
import { matchesModel } from './match.js';

/** @type {Readonly<import('./types.js').RetryPolicy>} */
export const DEFAULT_POLICY = Object.freeze({
  kind: 'exponential',
  initialDelayMs: 5000,
  multiplier: 2,
  maxDelayMs: 60000,
  maxAttempts: 5,
  jitterRatio: 0.1,
  honorRetryAfter: true,
  sequenceMs: Object.freeze([5000, 10000, 30000, 60000]),
});

/**
 * @param {import('./types.js').ModelRef | undefined} target
 * @param {{ policy?: Partial<import('./types.js').RetryPolicy>, overrides?: import('./types.js').PolicyOverride[] }} config
 * @returns {import('./types.js').RetryPolicy}
 */
export function resolvePolicy(target, config) {
  const override = config.overrides?.find((o) => matchesModel(o.match, target));
  return { ...DEFAULT_POLICY, ...(override ? override.policy : config.policy) };
}
