/**
 * Retry schedule: the wait before each retry, derived from a retry policy.
 * Shared by the settings timeline (#4) and the runtime.
 *
 * Growth kinds: fixed (initial every time), linear (initial × n), exponential
 * (initial × multiplier^(n-1)), custom (`sequenceMs`, last value repeats).
 * Every wait is capped at `maxDelayMs`.
 */

/**
 * Nominal (un-jittered) wait before retry `attempt` (1-based), capped.
 * @param {import('./types.js').RetryPolicy} policy
 * @param {number} attempt
 */
function baseDelay(policy, attempt) {
  return Math.min(rawDelay(policy, attempt), policy.maxDelayMs);
}

/** @param {import('./types.js').RetryPolicy} policy @param {number} attempt */
function rawDelay(policy, attempt) {
  switch (policy.kind) {
    case 'fixed':
      return policy.initialDelayMs;
    case 'linear':
      return policy.initialDelayMs * attempt;
    case 'custom': {
      // Shorter than maxAttempts: keep repeating the last delay; longer: the tail is never reached.
      const seq = policy.sequenceMs ?? [];
      if (seq.length === 0) return policy.initialDelayMs;
      return seq[Math.min(attempt, seq.length) - 1];
    }
    default:
      return policy.initialDelayMs * policy.multiplier ** (attempt - 1);
  }
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
