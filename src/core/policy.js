/**
 * Retry policy defaults and resolution.
 *
 * Extension point (#4): `resolvePolicy(target, config)` will pick the first
 * matching per-model override before falling back to the global policy, and
 * policies gain kinds 'fixed' | 'linear' | 'custom'. Keep the policy a plain
 * object so the settings timeline and the runtime share it.
 */

/** @type {Readonly<import('./types.js').RetryPolicy>} */
export const DEFAULT_POLICY = Object.freeze({
  kind: 'exponential',
  initialDelayMs: 5000,
  multiplier: 2,
  maxDelayMs: 60000,
  maxAttempts: 5,
  jitterRatio: 0.1,
  honorRetryAfter: true,
});

/**
 * @param {import('./types.js').ModelRef | undefined} target
 * @param {{ policy?: Partial<import('./types.js').RetryPolicy> }} config
 * @returns {import('./types.js').RetryPolicy}
 */
export function resolvePolicy(target, config) {
  void target;
  return { ...DEFAULT_POLICY, ...config.policy };
}
