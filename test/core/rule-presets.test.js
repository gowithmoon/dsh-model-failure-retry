import { describe, expect, it } from 'vitest';
import { RULE_TARGETS } from '../../src/core/rules.js';
import {
  PRESETS, PRESET_CODES, PRESET_GROUPS, isBareRule, isValidCode, normalizeCode, presetOf, presetRule,
} from '../../src/core/rule-presets.js';

const GROUPS = {
  transient: ['SERVER', 'TIMEOUT', 'TRANSPORT', 'EMPTY_RESPONSE', 'STREAM_CLOSED', 'MALFORMED_RESPONSE', 'INVALID_RESPONSE', 'PI_AI_ERROR', 'PI_AI_NOT_WARMED', 'NO_ADAPTER'],
  quota: ['RATE_LIMIT', 'QUOTA'],
  request: ['INVALID_REQUEST', 'CONTEXT_WINDOW_EXCEEDED', 'UNSUPPORTED_OPTION', 'UNKNOWN_MODEL', 'REQUEST_EXTENSION', 'INVALID_REPLAY_STATE'],
  content: ['UNSUPPORTED_CONTENT', 'UNSUPPORTED_REASONING_EFFORT', 'FILES_API', 'CLIENT_UPGRADE_REQUIRED', 'MODEL_UNSUPPORTED'],
  auth: ['AUTH', 'INVALID_CREDENTIAL', 'MISSING_CREDENTIAL', 'ACCOUNT_SIGN_IN_REQUIRED', 'ACCOUNT_TOKEN_INVALID'],
  misc: ['ABORTED', 'UNKNOWN'],
};
const USELESS = new Set([
  'QUOTA', 'CONTEXT_WINDOW_EXCEEDED', 'UNSUPPORTED_OPTION', 'UNKNOWN_MODEL', 'REQUEST_EXTENSION', 'INVALID_REPLAY_STATE',
  ...GROUPS.content, 'AUTH', 'INVALID_CREDENTIAL', 'MISSING_CREDENTIAL', 'ACCOUNT_SIGN_IN_REQUIRED', 'ABORTED', 'UNKNOWN',
]);
const CATEGORY = {
  RATE_LIMIT: 'rate-limit',
  QUOTA: 'quota',
  INVALID_REQUEST: 'transient',
  CONTEXT_WINDOW_EXCEEDED: 'context-window',
  ACCOUNT_TOKEN_INVALID: 'transient',
};

describe('error-code preset catalog', () => {
  it('has the 30 reference codes, each once', () => {
    expect(PRESET_CODES).toHaveLength(30);
    expect(new Set(PRESET_CODES).size).toBe(30);
    expect([...PRESET_CODES].sort()).toEqual(Object.values(GROUPS).flat().sort());
  });

  it('lists the six groups in order with their codes in order', () => {
    expect(PRESET_GROUPS.map((g) => g.id)).toEqual(Object.keys(GROUPS));
    for (const g of PRESET_GROUPS) {
      expect(g.codes).toEqual(GROUPS[g.id]);
      expect(g.labelKey).toBe(`preset.group.${g.id}`);
      expect(g.noteKey).toBe(`preset.group.${g.id}.note`);
    }
    expect(PRESETS.map((p) => p.code)).toEqual(Object.values(GROUPS).flat());
  });

  it('maps every code to its rule target and retry-useless flag', () => {
    for (const p of PRESETS) {
      const fatalByDefault = !(p.code in CATEGORY) && !GROUPS.transient.includes(p.code);
      const expected = CATEGORY[p.code] ?? (fatalByDefault ? 'fatal' : 'transient');
      expect(p.category, p.code).toBe(expected);
      expect(RULE_TARGETS).toContain(p.category);
      expect(p.retryUseless, p.code).toBe(USELESS.has(p.code));
      expect(p.group).toBe(PRESET_GROUPS.find((g) => g.codes.includes(p.code)).id);
      expect(p.descKey).toBe(`preset.code.${p.code}`);
    }
  });

  it('builds a bare rule for a code', () => {
    expect(presetRule('RATE_LIMIT')).toEqual({ status: 0, code: 'RATE_LIMIT', pattern: '', regex: false, category: 'rate-limit' });
    expect(presetRule('CONTEXT_WINDOW_EXCEEDED').category).toBe('context-window');
    expect(presetRule('QUOTA', 'transient').category).toBe('quota'); // the catalog decides for its own codes
  });

  it('gives a custom code the chosen category, fatal by default', () => {
    expect(presetRule('MY_PROVIDER_BUSY')).toEqual({ status: 0, code: 'MY_PROVIDER_BUSY', pattern: '', regex: false, category: 'fatal' });
    expect(presetRule('MY_PROVIDER_BUSY', 'transient').category).toBe('transient');
    expect(() => presetRule('MY_PROVIDER_BUSY', 'nope')).toThrow(TypeError);
    expect(() => presetRule('bad code')).toThrow(TypeError);
  });

  it('validates the shape of a code', () => {
    for (const ok of ['A', '_X', '0', 'A.B-C_1', 'HTTP_503']) expect(isValidCode(ok), ok).toBe(true);
    for (const bad of ['', 'a', 'A B', '-A', '.A', 'A*', 'É', ' A', 'A\n', undefined, null, 5]) expect(isValidCode(bad), String(bad)).toBe(false);
    expect(normalizeCode('  my_code ')).toBe('MY_CODE');
    expect(presetOf('AUTH')?.group).toBe('auth');
    expect(presetOf('NOPE')).toBeUndefined();
  });

  it('recognizes a bare rule', () => {
    const bare = presetRule('AUTH');
    expect(isBareRule(bare, 'AUTH')).toBe(true);
    expect(isBareRule({ ...bare, category: 'transient' }, 'AUTH')).toBe(true);
    expect(isBareRule({ ...bare, status: 401 }, 'AUTH')).toBe(false);
    expect(isBareRule({ ...bare, pattern: 'x' }, 'AUTH')).toBe(false);
    expect(isBareRule({ ...bare, regex: true }, 'AUTH')).toBe(false);
    expect(isBareRule(bare, 'QUOTA')).toBe(false);
  });
});
