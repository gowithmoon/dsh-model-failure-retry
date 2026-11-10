/**
 * Fallback chains (GLOSSARY: 切换链): which chain applies to a model and the
 * order its candidates are tried in.
 *
 * @typedef {{ match: string, candidates: import('./types.js').ModelRef[] }} FallbackChain
 */
import { matchesModel } from './match.js';

/**
 * The first chain whose match rule hits `model`. Later chains that also match
 * are ignored, so a `*\/*` catch-all only applies when it comes last.
 * @param {import('./types.js').ModelRef} model
 * @param {readonly FallbackChain[] | undefined} chains
 * @returns {{ index: number, chain: FallbackChain } | undefined}
 */
export function matchChain(model, chains) {
  const index = (chains ?? []).findIndex((chain) => matchesModel(chain.match, model));
  return index < 0 ? undefined : { index, chain: chains[index] };
}

/**
 * Candidates to try, in order. If `current` is in the list: from the next one,
 * wrapping around, stopping before `current`. Otherwise: the whole list.
 * @param {readonly import('./types.js').ModelRef[]} candidates
 * @param {import('./types.js').ModelRef} current
 * @returns {import('./types.js').ModelRef[]}
 */
export function candidateOrder(candidates, current) {
  const list = (candidates ?? []).map(toRef);
  const at = list.findIndex((c) => sameModel(c, current));
  if (at < 0) return list;
  return [...list.slice(at + 1), ...list.slice(0, at)];
}

/** Same provider and model id (reasoning effort is ignored). */
export function sameModel(a, b) {
  return !!a && !!b && a.provider === b.provider && a.model === b.model;
}

/** Just the provider and model id of a ref (drops reasoning effort and extra fields). */
export function toRef(ref) {
  return { provider: ref.provider, model: ref.model };
}

/** `provider/model`, the label used in logs, stats and the status line. */
export function label(ref) {
  return `${ref.provider}/${ref.model}`;
}
