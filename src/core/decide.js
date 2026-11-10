/**
 * The decision core's entry point: what to do about one failed request.
 *
 * Extension points:
 *   - quota/fatal (#6): instead of give-up, consult `matchChain` /
 *     `candidateOrder` and return `fallback` / `skip`; requestState will then
 *     carry current/origin model, chain and tried candidates.
 *   - policy (#4): `resolvePolicy(requestState.model, config)` already takes
 *     the target model.
 *
 * @param {{ code: string, message?: string, status?: number, providerRetryAfterMs?: number }} failure
 * @param {import('./types.js').RequestState & { model?: import('./types.js').ModelRef }} requestState
 * @param {import('./config.js').CoreConfig} config
 * @param {{ random?: () => number }} [options]
 * @returns {import('./types.js').Decision}
 */
import { classify } from './classify.js';
import { resolvePolicy } from './policy.js';
import { nextDelay } from './schedule.js';

export function decide(failure, requestState, config, { random } = {}) {
  if (!config.enabled) return PASS;
  const { category, reason } = classify(failure, config.rules);
  if (category === undefined) return PASS;
  // Context overflow is terminal for the plugin but must still reach the
  // compaction plugin, which listens after us; so the current model passes it on.
  // (#6: a fallback candidate hitting this reason is skipped instead.)
  if (reason === 'context-window') return PASS;
  if (category === 'quota' || category === 'fatal') return { kind: 'give-up', reason: category };
  if (!config.categories[category]?.enabled) return PASS;

  const policy = resolvePolicy(requestState.model, config);
  if (requestState.attempts >= policy.maxAttempts) return { kind: 'give-up', reason: 'retries-exhausted' };
  const attempt = requestState.attempts + 1;
  return {
    kind: 'retry',
    delayMs: nextDelay(policy, attempt, { retryAfterMs: failure.providerRetryAfterMs, random }),
    attempt,
    maxAttempts: policy.maxAttempts,
  };
}

/** @type {import('./types.js').Decision} */
const PASS = Object.freeze({ kind: 'pass' });
