import { describe, expect, it } from 'vitest';
import { en, zh } from '../../src/client/locales.js';
import { describeRule, filterCatalog } from '../../src/client/rules-view.js';
import { DEFAULT_RULES } from '../../src/core/rules.js';
import { PRESET_CODES } from '../../src/core/rule-presets.js';

const tEn = (key) => en[key];
const tZh = (key) => zh[key];

describe('rule summaries', () => {
  it('describes status, code, keywords and category in one line', () => {
    const rule = { status: 429, code: '', pattern: 'daily, 每日', regex: false, category: 'quota' };
    expect(describeRule(tZh, rule)).toBe('HTTP 429 · 关键词 daily, 每日 → 配额耗尽');
    expect(describeRule(tZh, { code: 'RATE_LIMIT', category: 'rate-limit' })).toBe('错误码 RATE_LIMIT → 限流');
    expect(describeRule(tZh, { category: 'fatal' })).toBe('任意失败 → 终止性错误');
    expect(describeRule(tEn, { category: 'fatal' })).toBe('any failure → Fatal error');
  });

  it('shows a regex as /.../i and clips very long patterns', () => {
    expect(describeRule(tEn, { pattern: 'a|b', regex: true, category: 'quota' })).toBe('regex /a|b/i → Quota exhausted');
    expect(describeRule(tEn, DEFAULT_RULES[0])).toMatch(/^HTTP 429 · regex \/.{59}…\/i → Quota exhausted$/);
  });
});

describe('catalog filter', () => {
  it('keeps every code for an empty query', () => {
    expect(filterCatalog(tEn, '  ').flatMap((g) => g.codes)).toEqual(PRESET_CODES);
  });

  it('matches by code, description and group name, in either language', () => {
    expect(filterCatalog(tEn, 'rate_l').flatMap((g) => g.codes)).toEqual(['RATE_LIMIT']);
    expect(filterCatalog(tZh, '余额').flatMap((g) => g.codes)).toEqual(['QUOTA']);
    const byGroup = filterCatalog(tZh, '取消');
    expect(byGroup.map((g) => g.id)).toEqual(['misc']);
    expect(byGroup[0].codes).toEqual(['ABORTED', 'UNKNOWN']);
  });

  it('returns nothing when nothing matches, and keeps the full group size', () => {
    expect(filterCatalog(tEn, 'zzzz-nothing')).toEqual([]);
    expect(filterCatalog(tEn, 'timeout')[0]).toMatchObject({ id: 'transient', codes: ['TIMEOUT'] });
    expect(filterCatalog(tEn, 'timeout')[0].all).toHaveLength(10);
  });
});
