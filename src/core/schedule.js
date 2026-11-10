/**
 * Retry schedule: the wait before each retry, derived from a retry policy.
 * Shared by the settings timeline (#4) and the runtime.
 *
 * Extension point (#4): add a branch per policy kind in `baseDelay`.
 */

/**
 * Nominal (un-jittered) wait before retry `attempt` (1-based), capped.
 * @param {import('./types.js').RetryPolicy} policy
 * @param {number} attempt
 */
function baseDelay(policy, attempt) {
  const raw = policy.initialDelayMs * policy.multiplier ** (attempt - 1);
  return Math.min(raw, policy.maxDelayMs);
}

/**
 * The full schedule for display: each retry's nominal wait and jitter window.
 * @param {import('./types.js').RetryPolicy} policy
 * @returns {{ attempt: number, delayMs: number, minMs: number, maxMs: number }[]}
 */
export function retrySchedule(policy) {
  return Array.from({ length: policy.maxAttempts }, (_, i) => {
    const attempt = i + 1;
    const delayMs = baseDelay(policy, attempt);
    return {
      attempt,
      delayMs,
      minMs: Math.max(0, delayMs * (1 - policy.jitterRatio)),
      maxMs: Math.min(policy.maxDelayMs, delayMs * (1 + policy.jitterRatio)),
    };
  });
}

/**
 * The actual wait before retry `attempt`.
 * A positive provider Retry-After wins (when honored) and is truncated to the
 * single-wait cap rather than causing a give-up; it is not jittered.
 * @param {import('./types.js').RetryPolicy} policy
 * @param {number} attempt 1-based
 * @param {{ retryAfterMs?: number, random?: () => number }} [options]
 */
export function nextDelay(policy, attempt, { retryAfterMs, random = Math.random } = {}) {
  if (policy.honorRetryAfter && Number.isFinite(retryAfterMs) && retryAfterMs > 0) {
    return Math.min(retryAfterMs, policy.maxDelayMs);
  }
  const base = baseDelay(policy, attempt);
  const factor = 1 + policy.jitterRatio * (2 * random() - 1);
  return Math.min(policy.maxDelayMs, Math.max(0, Math.round(base * factor)));
}
