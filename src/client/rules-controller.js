/**
 * Classification rules sub-section (#5): view state, list edits and the live
 * test box over the plugin's ConfigForm. Writes only the `rules` path, always
 * as the whole list (the field is one volatile array).
 */
import { classify } from '../core/classify.js';
import { defaultRules, ruleError } from '../core/rules.js';

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
