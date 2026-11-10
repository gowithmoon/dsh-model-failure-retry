/**
 * Classification rules (GLOSSARY "分类规则"): user-editable, ordered
 * "status / error code + keyword-or-regex → category" mappings that correct
 * upstream codes which cannot tell a rate limit from an exhausted quota.
 *
 * A rule matches when every condition it sets holds:
 *   - `status`  the HTTP status (see `failureStatus` for adapters without one)
 *   - `code`    the DSH error code, exact
 *   - `pattern` keywords (comma separated, case-insensitive substrings, any of
 *               them) or, with `regex: true`, one case-insensitive regex
 * Unset conditions (`status` 0/undefined, `code`/`pattern` empty) match anything.
 * An invalid regex never matches at runtime; `ruleError` reports it for the UI.
 *
 * @typedef {import('./types.js').Category | 'context-window'} RuleTarget
 * @typedef {object} ClassificationRule
 * @property {number} [status]
 * @property {string} [code]
 * @property {string} [pattern]
 * @property {boolean} [regex]
 * @property {RuleTarget} category
 */

/** Targets a rule can map to; `context-window` is a fatal failure with its own reason. */
export const RULE_TARGETS = Object.freeze(['rate-limit', 'transient', 'quota', 'fatal', 'context-window']);

/** @type {readonly ClassificationRule[]} */
export const DEFAULT_RULES = Object.freeze([
  Object.freeze({
    status: 429,
    pattern: String.raw`\b(?:daily|per[\s_-]?day|hourly|per[\s_-]?hour|weekly|per[\s_-]?week|monthly|per[\s_-]?month|plan|package|balance)\b|每日|每天|每周|每月|套餐|额度|余额`,
    regex: true,
    category: 'quota',
  }),
  Object.freeze({
    pattern: String.raw`context[\s_-]?(?:length|window)[\s_-]?(?:exceeded|too|limit)|maximum context|prompt is too long|上下文(?:长度)?超(?:出|限|长)`,
    regex: true,
    category: 'context-window',
  }),
]);

/** A fresh, mutable copy of the default rules (for config defaults and "restore defaults"). */
export function defaultRules() {
  return DEFAULT_RULES.map((rule) => ({ ...rule }));
}

const STATUS_IN_TEXT = /^\s*([45]\d\d)\b(?![.,]\d)|\b(?:status(?:\s*code)?|HTTP(?:\/[\d.]+)?)[\s:=]*([45]\d\d)\b/i;

/**
 * The status a rule's `status` is compared with. Adapters such as dsh-llm-pi-ai
 * report no status, only text; then RATE_LIMIT counts as 429, and otherwise
 * only a 4xx/5xx status in a status-shaped spot of the message counts: a
 * leading "NNN" ("429: …", "429 Too Many…") or "status NNN" / "HTTP NNN".
 * Any other number ("limit 200 requests per day") is no status.
 * @param {{ code?: string, message?: string, status?: number }} failure
 */
export function failureStatus(failure) {
  if (Number.isInteger(failure.status)) return failure.status;
  if (failure.code === 'RATE_LIMIT') return 429;
  const fromText = STATUS_IN_TEXT.exec(failure.message ?? '');
  return fromText ? Number(fromText[1] ?? fromText[2]) : undefined;
}


/**
 * The first rule (in order) that matches, or undefined.
 * @param {{ code?: string, message?: string, status?: number }} failure
 * @param {readonly ClassificationRule[]} rules
 * @returns {{ rule: ClassificationRule, index: number } | undefined}
 */
export function firstMatchingRule(failure, rules) {
  const status = failureStatus(failure);
  const message = failure.message ?? '';
  for (let index = 0; index < rules.length; index++) {
    const rule = rules[index];
    if (!rule || !RULE_TARGETS.includes(rule.category)) continue;
    if (rule.status && rule.status !== status) continue;
    if (rule.code && rule.code !== failure.code) continue;
    if (!matchesPattern(rule, message)) continue;
    return { rule, index };
  }
  return undefined;
}

/**
 * Why a rule cannot be used as written, for the settings page; undefined when fine.
 * @param {ClassificationRule} rule
 * @returns {'invalid-regex' | undefined}
 */
export function ruleError(rule) {
  if (rule.regex && rule.pattern && compile(rule.pattern) === null) return 'invalid-regex';
  return undefined;
}

function matchesPattern(rule, message) {
  if (!rule.pattern) return true;
  if (rule.regex) {
    const re = compile(rule.pattern);
    return re !== null && re.test(message);
  }
  const haystack = message.toLowerCase();
  return rule.pattern
    .split(/[,，]/)
    .map((k) => k.trim().toLowerCase())
    .filter(Boolean)
    .some((keyword) => haystack.includes(keyword));
}

/** @type {Map<string, RegExp | null>} */
const compiled = new Map();
function compile(source) {
  if (!compiled.has(source)) {
    let re = null;
    try { re = new RegExp(source, 'i'); } catch { /* invalid: never matches */ }
    if (compiled.size > 256) compiled.clear();
    compiled.set(source, re);
  }
  return compiled.get(source);
}
