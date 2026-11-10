/**
 * Shared JSDoc types of the decision core. No runtime code.
 *
 * @typedef {'rate-limit' | 'transient' | 'quota' | 'fatal'} Category
 *
 * @typedef {{ provider: string, model: string }} ModelRef
 *
 * @typedef {object} RetryPolicy
 * @property {'fixed' | 'linear' | 'exponential' | 'custom'} kind   Growth kind.
 * @property {number} initialDelayMs
 * @property {number} multiplier     Exponential only.
 * @property {number[]} [sequenceMs] Custom only: the waits in order; the last repeats.
 * @property {number} maxDelayMs     Cap for a single wait; also truncates Retry-After.
 * @property {number} maxAttempts    Retries allowed per request × model.
 * @property {number} jitterRatio    0..1, symmetric: delay × (1 ± ratio).
 * @property {boolean} honorRetryAfter
 *
 * @typedef {object} PolicyOverride  A per-model retry policy; the first matching one wins.
 * @property {string} match            provider/model wildcard (see match.js).
 * @property {Partial<RetryPolicy>} policy
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
