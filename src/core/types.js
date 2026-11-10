/**
 * Shared JSDoc types of the decision core. No runtime code.
 *
 * @typedef {'rate-limit' | 'transient' | 'quota' | 'fatal'} Category
 *
 * @typedef {{ provider: string, model: string }} ModelRef
 *
 * @typedef {object} RetryPolicy
 * @property {'exponential'} kind   Delay algorithm. #4 adds 'fixed' | 'linear' | 'custom'.
 * @property {number} initialDelayMs
 * @property {number} multiplier
 * @property {number} maxDelayMs     Cap for a single wait; also truncates Retry-After.
 * @property {number} maxAttempts    Retries allowed per request × model.
 * @property {number} jitterRatio    0..1, symmetric: delay × (1 ± ratio).
 * @property {boolean} honorRetryAfter
 *
 * @typedef {object} RequestState
 * @property {number} attempts       Retries already performed for this request on the current model.
 *
 * @typedef {(
 *   | { kind: 'retry', delayMs: number, attempt: number, maxAttempts: number }
 *   | { kind: 'fallback', to: ModelRef, reason: string }
 *   | { kind: 'skip', target: ModelRef, reason: 'fatal' | 'context-window' | 'missing-model', then: Decision }
 *   | { kind: 'give-up', reason: string }
 *   | { kind: 'pass' }
 * )} Decision
 */
export {};
