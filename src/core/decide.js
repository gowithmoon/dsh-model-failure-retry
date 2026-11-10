/**
 * The decision core's entry point: what to do about one failed request.
 *
 * Fallback (#6): when the current model is done for (quota, retries used up,
 * or — on a candidate — a fatal error / context overflow), the chain that
 * matches the episode's start model is walked in candidate order, skipping
 * models already tried and models that no longer exist.
 *
 * @param {{ code: string, message?: string, status?: number, providerRetryAfterMs?: number }} failure
 * @param {import('./types.js').RequestState} requestState
 * @param {import('./config.js').CoreConfig} config
 * @param {{ random?: () => number, isAvailable?: (ref: import('./types.js').ModelRef) => boolean }} [options]
 *   `isAvailable` says whether a candidate still exists; missing ones are skipped.
 * @returns {import('./types.js').Decision}
 */
import { candidateOrder, matchChain, sameModel } from './chain.js';
import { classify } from './classify.js';
import { resolvePolicy } from './policy.js';
import { nextDelay } from './schedule.js';

export function decide(failure, requestState, config, { random, isAvailable = () => true } = {}) {
  if (!config.enabled) return PASS;
  const { category, reason } = classify(failure, config.rules);
  if (category === undefined) return PASS;

  const { model } = requestState;
  const start = requestState.episode?.start ?? model;
  const onCandidate = !!model && !!start && !sameModel(model, start);
  const next = (why) => nextCandidate(why, requestState, config, isAvailable);
  const skip = (why) => ({ kind: 'skip', target: model, reason: why, then: next(why) });

  if (reason === 'context-window') {
    // On the start model the compaction plugin (listening after us) handles it.
    return onCandidate ? skip('context-window') : PASS;
  }
  if (category === 'fatal') return onCandidate ? skip('fatal') : { kind: 'give-up', reason: 'fatal' };
  if (category === 'quota') return next('quota');
  if (!config.categories[category]?.enabled) return PASS;

  const policy = resolvePolicy(model, config);
  if (requestState.attempts >= policy.maxAttempts) return next('retries-exhausted');
  const attempt = requestState.attempts + 1;
  return {
    kind: 'retry',
    delayMs: nextDelay(policy, attempt, { retryAfterMs: failure.providerRetryAfterMs, random }),
    attempt,
    maxAttempts: policy.maxAttempts,
  };
}

/**
 * The decision after leaving the current model: the next untried, available
 * candidate of the chain matching the episode's start model.
 * @returns {import('./types.js').Decision}
 */
function nextCandidate(reason, { model, episode }, config, isAvailable) {
  const start = episode?.start ?? model;
  const matched = start && matchChain(start, config.chains);
  if (!matched) return { kind: 'give-up', reason };
  const tried = [...(episode?.tried ?? []), model];
  const queue = candidateOrder(matched.chain.candidates, start).filter((c) => !tried.some((t) => sameModel(t, c)));
  const walk = (i) => {
    if (i >= queue.length) return { kind: 'give-up', reason: 'chain-exhausted' };
    const to = queue[i];
    if (!isAvailable(to)) return { kind: 'skip', target: to, reason: 'missing-model', then: walk(i + 1) };
    return { kind: 'fallback', to, reason };
  };
  return walk(0);
}

/** @type {import('./types.js').Decision} */
const PASS = Object.freeze({ kind: 'pass' });
