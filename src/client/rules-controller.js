/**
 * Classification rules sub-section (#5): view state, list edits and the live
 * test box over the plugin's ConfigForm. Writes only the `rules` path, always
 * as the whole list (the field is one volatile array).
 */
import { classify } from '../core/classify.js';
import { defaultRules, ruleError } from '../core/rules.js';
import {
  isBareRule, isValidCode, normalizeCode, presetEffect, presetGroup, presetOf, presetRule,
} from '../core/rule-presets.js';

const BLANK = Object.freeze({ status: 0, code: '', pattern: '', regex: false });
const NEW_RULE = Object.freeze({ ...BLANK, category: 'quota' });

/**
 * The DSH error code an adapter would most likely report for a bare HTTP
 * status (as dsh-llm-deepseek does), so the test box can fall back to the
 * error-code mapping when no rule hits.
 */
function codeForStatus(status) {
  if (status === undefined) return undefined;
  if (status === 401 || status === 403) return 'AUTH';
  if (status === 402) return 'QUOTA';
  if (status === 429) return 'RATE_LIMIT';
  if (status === 400 || status === 413) return 'INVALID_REQUEST';
  if (status >= 500) return 'SERVER';
  return `HTTP_${status}`;
}

/**
 * @param {import('./types.js').ConfigFormLike} form
 */
export function createRulesController(form) {
  let source;
  let view;

  function derive() {
    const snap = form.getSnapshot();
    if (snap === source) return view;
    source = snap;
    const rules = Array.isArray(snap.value?.rules) ? snap.value.rules : defaultRules();
    view = Object.freeze({
      status: snap.status,
      writable: snap.status === 'ready' && snap.writable,
      rules: Object.freeze(rules.map((rule) => Object.freeze({ ...BLANK, ...rule, error: ruleError(rule) }))),
    });
    return view;
  }

  /** The stored rules without view-only fields. */
  const current = () => derive().rules.map(({ error, ...rule }) => rule);
  const write = (rules) => form.mutate([{ op: 'set', path: ['rules'], value: rules }], form.getSnapshot().revision);

  return {
    getSnapshot: derive,
    subscribe: (listener) => form.subscribe(() => {
      const before = view;
      if (derive() !== before) listener();
    }),
    add: () => write([...current(), { ...NEW_RULE }]),
    remove: (index) => write(current().filter((_, i) => i !== index)),
    update: (index, patch) => write(current().map((rule, i) => (i === index ? { ...rule, ...patch } : rule))),
    /** Move rule `index` by `delta` (-1 up, +1 down); a no-op at the ends. */
    move(index, delta) {
      const rules = current();
      const to = index + delta;
      if (to < 0 || to >= rules.length) return Promise.resolve(true);
      [rules[index], rules[to]] = [rules[to], rules[index]];
      return write(rules);
    },
    restoreDefaults: () => write(defaultRules()),
    /** Insert a copy of rule `index` right after it. */
    duplicate(index) {
      const rules = current();
      if (!rules[index]) return Promise.resolve(false);
      rules.splice(index + 1, 0, { ...rules[index] });
      return write(rules);
    },
    /** Does any rule (bare or custom) already name this error code? */
    hasCode: (code) => derive().rules.some((rule) => rule.code === code),
    /** Is this code covered by a bare rule only (so a chip click may remove it)? */
    hasBareRule: (code) => derive().rules.some((rule) => isBareRule(rule, code)),
    /**
     * Append a bare `{code → category}` rule. Appending keeps the default
     * keyword rules first, so a code rule cannot swallow a failure that a
     * default rule should classify; move it up to take precedence. Nothing is
     * written (resolves true) when some rule already has the code, or when the
     * code is a catalog code the built-in mapping already classifies the same
     * way (`presetEffect` is `builtin`). Resolves false for a malformed code or
     * category.
     * @param {string} code  catalog or custom code
     * @param {string} [category]  only used for codes outside the catalog
     */
    addPreset(code, category) {
      const normalized = normalizeCode(code);
      if (!isValidCode(normalized)) return Promise.resolve(false);
      if (derive().rules.some((rule) => rule.code === normalized)) return Promise.resolve(true);
      if (presetOf(normalized) && presetEffect(normalized) === 'builtin') return Promise.resolve(true);
      let rule;
      try { rule = presetRule(normalized, category); } catch { return Promise.resolve(false); }
      return write([...current(), rule]);
    },
    /**
     * Remove the bare rule(s) for a code. Rules that also set a status or
     * pattern are the user's own and stay; with only those, nothing is written
     * and the result is false.
     */
    removePreset(code) {
      const rules = current();
      const kept = rules.filter((rule) => !isBareRule(rule, code));
      if (kept.length === rules.length) return Promise.resolve(false);
      return write(kept);
    },
    /**
     * Append, in one write and in group order, every code of a group whose
     * effect is `add` and that no rule names yet. `builtin` codes would change
     * nothing and an `override` code must be picked on its own, so both are
     * skipped. With nothing to add, nothing is written (resolves true).
     */
    addPresetGroup(groupId) {
      const group = presetGroup(groupId);
      if (!group) return Promise.resolve(false);
      const rules = current();
      const missing = group.codes.filter((code) => presetEffect(code) === 'add'
        && !rules.some((rule) => rule.code === code));
      if (missing.length === 0) return Promise.resolve(true);
      return write([...rules, ...missing.map((code) => presetRule(code))]);
    },
    /** Remove the bare rules of a group's codes in one write; custom rules stay. */
    removePresetGroup(groupId) {
      const group = presetGroup(groupId);
      if (!group) return Promise.resolve(false);
      const rules = current();
      const kept = rules.filter((rule) => !group.codes.some((code) => isBareRule(rule, code)));
      if (kept.length === rules.length) return Promise.resolve(true);
      return write(kept);
    },
    /**
     * Classify a sample failure with the current rules.
     * @param {{ status: string, message: string }} sample  raw input-box values
     * @returns {{ category: string | undefined, reason?: string, ruleIndex?: number }}
     */
    test({ status, message }) {
      const n = Number.parseInt(String(status).trim(), 10);
      const code = Number.isInteger(n) ? n : undefined;
      const { rule, ...result } = classify({ code: codeForStatus(code), status: code, message }, current());
      return result;
    },
  };
}
