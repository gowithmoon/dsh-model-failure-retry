/**
 * Map an LLM failure to a failure category.
 *
 * Classification rules (src/core/rules.js) are evaluated first, in order; the
 * first hit wins and is reported as `rule` / `ruleIndex`. When no rule hits,
 * the built-in mapping by DSH error code applies. Codes not listed there
 * (EMPTY_RESPONSE, IMAGE_OFFLOAD_REQUIRED, ...) are not owned by the plugin
 * and yield `category: undefined`, so other listeners keep handling them.
 *
 * Context-window overflow is a fatal failure with `reason: 'context-window'`
 * (from the CONTEXT_WINDOW_EXCEEDED code or a `context-window` rule). Fallback
 * (#6) skips candidates on that reason.
 *
 * @param {{ code: string, message?: string, status?: number }} failure
 * @param {readonly import('./rules.js').ClassificationRule[]} [rules]
 * @returns {{
 *   category: import('./types.js').Category | undefined,
 *   reason?: 'context-window',
 *   rule?: import('./rules.js').ClassificationRule,
 *   ruleIndex?: number,
 * }}
 */
import { firstMatchingRule } from './rules.js';

export function classify(failure, rules = []) {
  const hit = firstMatchingRule(failure, rules);
  if (hit) return { ...target(hit.rule.category), rule: hit.rule, ruleIndex: hit.index };
  if (failure.code === 'CONTEXT_WINDOW_EXCEEDED') return target('context-window');
  return { category: CODE_CATEGORY[failure.code] };
}

function target(category) {
  return category === 'context-window' ? { category: 'fatal', reason: 'context-window' } : { category };
}

/** @type {Readonly<Record<string, import('./types.js').Category>>} */
const CODE_CATEGORY = Object.freeze({
  RATE_LIMIT: 'rate-limit',
  SERVER: 'transient',
  TIMEOUT: 'transient',
  TRANSPORT: 'transient',
  QUOTA: 'quota',
  ACCOUNT_QUOTA: 'quota',
  AUTH: 'fatal',
  INVALID_REQUEST: 'fatal',
  INVALID_CREDENTIAL: 'fatal',
});
