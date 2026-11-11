/**
 * Error-code preset catalog for the classification rules editor. Pure data and
 * small helpers (no React): the settings page turns each code into a chip, and
 * one click adds a bare rule `{ code → category }`.
 *
 * The code list and grouping follow dsh-llm-retry-settings@0.1.19 (MIT); the
 * categories are this plugin's own mapping onto RULE_TARGETS. The catalog is
 * opt-in: it never changes DEFAULT_RULES.
 *
 * @typedef {import('./rules.js').RuleTarget} RuleTarget
 * @typedef {'transient' | 'quota' | 'request' | 'content' | 'auth' | 'misc'} PresetGroupId
 * @typedef {object} Preset
 * @property {string} code
 * @property {PresetGroupId} group
 * @property {RuleTarget} category
 * @property {boolean} retryUseless  retrying the same request usually cannot help
 * @property {string} descKey        locale key of the one-line description
 */
import { RULE_TARGETS } from './rules.js';

/** [code, category, retryUseless] per group, in display order. */
const TABLE = {
  transient: [
    ['SERVER', 'transient', false],
    ['TIMEOUT', 'transient', false],
    ['TRANSPORT', 'transient', false],
    ['EMPTY_RESPONSE', 'transient', false],
    ['STREAM_CLOSED', 'transient', false],
    ['MALFORMED_RESPONSE', 'transient', false],
    ['INVALID_RESPONSE', 'transient', false],
    ['PI_AI_ERROR', 'transient', false],
    ['PI_AI_NOT_WARMED', 'transient', false],
    ['NO_ADAPTER', 'transient', false],
  ],
  quota: [
    ['RATE_LIMIT', 'rate-limit', false],
    ['QUOTA', 'quota', true],
  ],
  request: [
    ['INVALID_REQUEST', 'transient', false],
    ['CONTEXT_WINDOW_EXCEEDED', 'context-window', true],
    ['UNSUPPORTED_OPTION', 'fatal', true],
    ['UNKNOWN_MODEL', 'fatal', true],
    ['REQUEST_EXTENSION', 'fatal', true],
    ['INVALID_REPLAY_STATE', 'fatal', true],
  ],
  content: [
    ['UNSUPPORTED_CONTENT', 'fatal', true],
    ['UNSUPPORTED_REASONING_EFFORT', 'fatal', true],
    ['FILES_API', 'fatal', true],
    ['CLIENT_UPGRADE_REQUIRED', 'fatal', true],
    ['MODEL_UNSUPPORTED', 'fatal', true],
  ],
  auth: [
    ['AUTH', 'fatal', true],
    ['INVALID_CREDENTIAL', 'fatal', true],
    ['MISSING_CREDENTIAL', 'fatal', true],
    ['ACCOUNT_SIGN_IN_REQUIRED', 'fatal', true],
    ['ACCOUNT_TOKEN_INVALID', 'transient', false],
  ],
  misc: [
    ['ABORTED', 'fatal', true],
    ['UNKNOWN', 'fatal', true],
  ],
};

/** Valid shape of an error code (also what a custom code must match). */
const CODE_PATTERN = /^[A-Z0-9_][A-Z0-9_.-]*$/;

/** Category a custom (non-catalog) code gets unless the user picks another. */
export const DEFAULT_CUSTOM_CATEGORY = 'fatal';

/** @param {unknown} code */
export function isValidCode(code) {
  return typeof code === 'string' && CODE_PATTERN.test(code);
}

/** Trim and upper-case what the user typed into a code field. */
export const normalizeCode = (input) => String(input ?? '').trim().toUpperCase();

/** @type {readonly Preset[]} */
export const PRESETS = Object.freeze(
  Object.entries(TABLE).flatMap(([group, rows]) => rows.map(([code, category, retryUseless]) =>
    Object.freeze({ code, group, category, retryUseless, descKey: `preset.code.${code}` }))),
);

/** Groups in display order; `codes` keeps the table order. */
export const PRESET_GROUPS = Object.freeze(
  Object.keys(TABLE).map((id) => Object.freeze({
    id,
    labelKey: `preset.group.${id}`,
    noteKey: `preset.group.${id}.note`,
    codes: Object.freeze(TABLE[id].map(([code]) => code)),
  })),
);

export const PRESET_CODES = Object.freeze(PRESETS.map((p) => p.code));

const byCode = new Map(PRESETS.map((p) => [p.code, p]));
const byGroup = new Map(PRESET_GROUPS.map((g) => [g.id, g]));

/** @param {string} code @returns {Preset | undefined} */
export const presetOf = (code) => byCode.get(code);

/** @param {string} id */
export const presetGroup = (id) => byGroup.get(id);

/**
 * The bare rule one chip stands for: any status, any text, just the code.
 * A catalog code uses its own category; a custom code uses `category`
 * (default fatal). Throws on a malformed code or unknown category.
 * @param {string} code
 * @param {RuleTarget} [category]
 * @returns {import('./rules.js').ClassificationRule}
 */
export function presetRule(code, category) {
  if (!isValidCode(code)) throw new TypeError(`invalid error code: ${code}`);
  const chosen = byCode.get(code)?.category ?? category ?? DEFAULT_CUSTOM_CATEGORY;
  if (!RULE_TARGETS.includes(chosen)) throw new TypeError(`invalid category: ${chosen}`);
  return { status: 0, code, pattern: '', regex: false, category: chosen };
}

/** True for a rule that is exactly what `presetRule(code)` makes (any category). */
export const isBareRule = (rule, code) => Boolean(rule)
  && rule.code === code && !rule.status && !rule.pattern && !rule.regex;
