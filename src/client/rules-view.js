/** Pure view helpers for the classification rules section. */
import { PRESETS, PRESET_GROUPS } from '../core/rule-presets.js';

const MAX_PATTERN = 60;

/** Replace `{name}` placeholders in a locale string. */
export const fill = (text, values) => text.replace(/\{(\w+)\}/g, (_, key) => String(values[key] ?? ''));
const clip = (text) => (text.length > MAX_PATTERN ? `${text.slice(0, MAX_PATTERN - 1)}…` : text);

/**
 * One-line natural-language summary of a rule, e.g.
 * "HTTP 429 · keywords daily, 每日 → Quota exhausted".
 * @param {(key: string) => string} t
 * @param {import('../core/rules.js').ClassificationRule} rule
 */
export function describeRule(t, rule) {
  const parts = [];
  if (rule.status) parts.push(fill(t('rules.summary.status'), { status: rule.status }));
  if (rule.code) parts.push(fill(t('rules.summary.code'), { code: rule.code }));
  if (rule.pattern) {
    parts.push(rule.regex
      ? fill(t('rules.summary.regex'), { pattern: `/${clip(rule.pattern)}/i` })
      : fill(t('rules.summary.keywords'), { pattern: clip(rule.pattern.split(/[,，]/).map((k) => k.trim()).filter(Boolean).join(', ')) }));
  }
  const condition = parts.length > 0 ? parts.join(' · ') : t('rules.summary.any');
  return `${condition} → ${t(`category.${rule.category}`)}`;
}

/**
 * The catalog groups that have a code matching `query` (code, description or
 * group name, case-insensitive); an empty query keeps everything.
 * @param {(key: string) => string} t
 * @param {string} query
 * @returns {{ id: string, labelKey: string, noteKey: string, codes: readonly string[], all: readonly string[] }[]}
 */
export function filterCatalog(t, query) {
  const needle = query.trim().toLowerCase();
  const result = [];
  for (const group of PRESET_GROUPS) {
    const groupHit = needle !== '' && t(group.labelKey).toLowerCase().includes(needle);
    const codes = group.codes.filter((code) => {
      if (needle === '' || groupHit) return true;
      const preset = PRESETS.find((p) => p.code === code);
      return code.toLowerCase().includes(needle) || t(preset.descKey).toLowerCase().includes(needle);
    });
    if (codes.length > 0) result.push({ ...group, codes, all: group.codes });
  }
  return result;
}
