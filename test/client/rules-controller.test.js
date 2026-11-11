import { describe, expect, it } from 'vitest';
import { createRulesController } from '../../src/client/rules-controller.js';
import { DEFAULT_RULES } from '../../src/core/rules.js';
import { PRESET_GROUPS, presetEffect, presetRule } from '../../src/core/rule-presets.js';

function fakeForm(snapshot) {
  const listeners = new Set();
  const writes = [];
  return {
    writes,
    push(next) { snapshot = next; for (const l of listeners) l(); },
    getSnapshot: () => snapshot,
    subscribe(l) { listeners.add(l); return () => listeners.delete(l); },
    async mutate(ops, rev) { writes.push({ ops, rev }); return true; },
  };
}
const ready = (value) => ({ status: 'ready', value, revision: 7, writable: true });
const lastRules = (form) => form.writes.at(-1).ops[0];

const A = { status: 429, code: '', pattern: 'a', regex: false, category: 'quota' };
const B = { status: 0, code: '', pattern: 'b', regex: false, category: 'fatal' };
const C = { status: 0, code: '', pattern: 'c', regex: false, category: 'transient' };

describe('classification rules controller', () => {
  it('shows the default rules until the Host value has its own', () => {
    const c = createRulesController(fakeForm({ status: 'loading', value: undefined, revision: undefined, writable: false }));
    expect(c.getSnapshot().rules.map(({ error, ...r }) => r)).toEqual(DEFAULT_RULES.map((r) => ({ status: 0, code: '', pattern: '', regex: false, ...r })));
    expect(c.getSnapshot().writable).toBe(false);
  });

  it('flags a rule whose regex is invalid', () => {
    const c = createRulesController(fakeForm(ready({ rules: [A, { ...B, pattern: '(b', regex: true }] })));
    expect(c.getSnapshot().rules.map((r) => r.error)).toEqual([undefined, 'invalid-regex']);
  });

  it('adds, removes, edits and reorders rules as whole-list writes', async () => {
    const form = fakeForm(ready({ rules: [A, B, C] }));
    const c = createRulesController(form);
    await c.move(2, -1);
    expect(lastRules(form)).toEqual({ op: 'set', path: ['rules'], value: [A, C, B] });
    await c.move(0, -1); // already first: no write
    expect(form.writes).toHaveLength(1);
    await c.remove(1);
    expect(lastRules(form).value).toEqual([A, C]);
    await c.update(0, { pattern: 'daily', regex: true });
    expect(lastRules(form).value).toEqual([{ ...A, pattern: 'daily', regex: true }, B, C]);
    await c.add();
    expect(lastRules(form).value).toEqual([A, B, C, { status: 0, code: '', pattern: '', regex: false, category: 'quota' }]);
    expect(form.writes.every((w) => w.rev === 7)).toBe(true);
  });

  it('restores the default rules', async () => {
    const form = fakeForm(ready({ rules: [B] }));
    await createRulesController(form).restoreDefaults();
    expect(lastRules(form)).toEqual({ op: 'set', path: ['rules'], value: DEFAULT_RULES.map((r) => ({ ...r })) });
  });

  it('tests a status and error text against the current rules', () => {
    const form = fakeForm(ready({ rules: [B, ...DEFAULT_RULES] }));
    const c = createRulesController(form);
    expect(c.test({ status: '429', message: 'daily limit reached' })).toEqual({ category: 'quota', ruleIndex: 1 });
    expect(c.test({ status: '429', message: 'too many requests' })).toEqual({ category: 'rate-limit' });
    expect(c.test({ status: '', message: 'b happened' })).toEqual({ category: 'fatal', ruleIndex: 0 });
    expect(c.test({ status: '400', message: 'maximum context length exceeded' })).toEqual({ category: 'fatal', reason: 'context-window', ruleIndex: 2 });
    expect(c.test({ status: '', message: 'whatever' })).toEqual({ category: undefined });
    form.push(ready({ rules: [] }));
    expect(c.test({ status: '429', message: 'daily limit reached' })).toEqual({ category: 'rate-limit' });
  });

  it('notifies subscribers only when the rules view changes', () => {
    const form = fakeForm(ready({ rules: [A] }));
    const c = createRulesController(form);
    const first = c.getSnapshot();
    expect(c.getSnapshot()).toBe(first);
    let n = 0;
    c.subscribe(() => { n++; });
    form.push(ready({ rules: [B] }));
    expect(n).toBe(1);
    expect(c.getSnapshot().rules[0].pattern).toBe('b');
  });
});

const bare = (code, category) => presetRule(code, category);
const group = (id) => PRESET_GROUPS.find((g) => g.id === id);

describe('error-code presets in the controller', () => {
  it('appends a bare preset rule at the end, as one whole-list write', async () => {
    const form = fakeForm(ready({ rules: [A, B] }));
    const c = createRulesController(form);
    expect(await c.addPreset('EMPTY_RESPONSE')).toBe(true);
    expect(form.writes).toHaveLength(1);
    expect(lastRules(form)).toEqual({ op: 'set', path: ['rules'], value: [A, B, bare('EMPTY_RESPONSE')] });
    expect(form.writes[0].rev).toBe(7);
  });

  it('does not write a catalog code the built-in mapping already classifies the same way', async () => {
    const form = fakeForm(ready({ rules: [...DEFAULT_RULES] }));
    const c = createRulesController(form);
    expect(await c.addPreset('RATE_LIMIT')).toBe(true);
    expect(await c.addPreset('context_window_exceeded')).toBe(true);
    expect(form.writes).toHaveLength(0);
  });

  it('appends an override code, after the default rules, changing the built-in category', async () => {
    const form = fakeForm(ready({ rules: [...DEFAULT_RULES] }));
    const c = createRulesController(form);
    expect(c.test({ status: '400', message: 'bad request' })).toEqual({ category: 'fatal' });
    expect(await c.addPreset('INVALID_REQUEST')).toBe(true);
    expect(lastRules(form).value).toHaveLength(DEFAULT_RULES.length + 1);
    expect(lastRules(form).value.at(-1)).toEqual(bare('INVALID_REQUEST'));
    expect(lastRules(form).value.at(-1).category).toBe('transient');
    form.push(ready({ rules: lastRules(form).value }));
    expect(c.test({ status: '400', message: 'bad request' })).toEqual({ category: 'transient', ruleIndex: 2 });
    expect(c.test({ status: '400', message: 'maximum context length exceeded' })).toEqual({ category: 'fatal', reason: 'context-window', ruleIndex: 1 });
  });

  it('does not write when any rule already has the code', async () => {
    const custom = { ...A, code: 'RATE_LIMIT', pattern: 'daily' };
    const form = fakeForm(ready({ rules: [custom, bare('AUTH')] }));
    const c = createRulesController(form);
    expect(await c.addPreset('RATE_LIMIT')).toBe(true);
    expect(await c.addPreset('AUTH')).toBe(true);
    expect(form.writes).toHaveLength(0);
    expect(c.hasCode('RATE_LIMIT')).toBe(true);
    expect(c.hasCode('QUOTA')).toBe(false);
  });

  it('appends a custom code with a chosen category, fatal by default, after normalizing it', async () => {
    const form = fakeForm(ready({ rules: [A] }));
    const c = createRulesController(form);
    await c.addPreset(' my_busy ');
    expect(lastRules(form).value).toEqual([A, bare('MY_BUSY', 'fatal')]);
    form.push(ready({ rules: [A] }));
    await c.addPreset('MY_BUSY', 'transient');
    expect(lastRules(form).value.at(-1)).toMatchObject({ code: 'MY_BUSY', category: 'transient' });
  });

  it('refuses a malformed code or category without writing', async () => {
    const form = fakeForm(ready({ rules: [A] }));
    const c = createRulesController(form);
    expect(await c.addPreset('has space')).toBe(false);
    expect(await c.addPreset('')).toBe(false);
    expect(await c.addPreset('OK_CODE', 'nonsense')).toBe(false);
    expect(await c.addPreset('EMPTY_RESPONSE', 'nonsense')).toBe(true); // catalog code ignores the argument
    expect(form.writes).toHaveLength(1);
  });
});
describe('removing presets and duplicating rules', () => {
  it('removes only the bare preset rule', async () => {
    const custom = { ...A, code: 'AUTH', pattern: 'x' };
    const form = fakeForm(ready({ rules: [bare('AUTH'), custom, B] }));
    const c = createRulesController(form);
    expect(c.hasBareRule('AUTH')).toBe(true);
    expect(await c.removePreset('AUTH')).toBe(true);
    expect(lastRules(form).value).toEqual([custom, B]);
    expect(form.writes[0].rev).toBe(7);
  });

  it('leaves a code that only custom rules name, and says so', async () => {
    const custom = { ...A, code: 'AUTH', status: 401 };
    const form = fakeForm(ready({ rules: [custom, B] }));
    const c = createRulesController(form);
    expect(c.hasCode('AUTH')).toBe(true);
    expect(c.hasBareRule('AUTH')).toBe(false);
    expect(await c.removePreset('AUTH')).toBe(false);
    expect(await c.removePreset('QUOTA')).toBe(false);
    expect(form.writes).toHaveLength(0);
  });

  it('appends a whole group in one write, skipping codes already there, in group order', async () => {
    const existing = { ...A, code: 'STREAM_CLOSED' };
    const form = fakeForm(ready({ rules: [existing, B] }));
    const c = createRulesController(form);
    await c.addPresetGroup('transient');
    expect(form.writes).toHaveLength(1);
    const added = ['EMPTY_RESPONSE', 'MALFORMED_RESPONSE', 'INVALID_RESPONSE', 'PI_AI_ERROR', 'PI_AI_NOT_WARMED', 'NO_ADAPTER'];
    expect(lastRules(form).value).toEqual([existing, B, ...added.map((code) => bare(code))]);
    form.push(ready({ rules: lastRules(form).value }));
    expect(await c.addPresetGroup('transient')).toBe(true); // nothing missing: no write
    expect(form.writes).toHaveLength(1);
    expect(await c.addPresetGroup('nope')).toBe(false);
  });

  it('adds only the new codes of a group: 7 of 10 transient codes, none of quota', async () => {
    const form = fakeForm(ready({ rules: [A] }));
    const c = createRulesController(form);
    expect(await c.addPresetGroup('quota')).toBe(true); // RATE_LIMIT and QUOTA are built in
    expect(form.writes).toHaveLength(0);
    await c.addPresetGroup('transient');
    const value = lastRules(form).value;
    expect(value).toHaveLength(1 + 7);
    expect(value.slice(1)).toEqual(group('transient').codes.filter((code) => presetEffect(code) === 'add').map((code) => bare(code)));
    expect(value.map((r) => r.code)).not.toContain('SERVER');
  });

  it('leaves an override code out of a group add', async () => {
    const form = fakeForm(ready({ rules: [A] }));
    await createRulesController(form).addPresetGroup('request');
    const codes = lastRules(form).value.slice(1).map((r) => r.code);
    expect(codes).toEqual(['UNSUPPORTED_OPTION', 'UNKNOWN_MODEL', 'REQUEST_EXTENSION', 'INVALID_REPLAY_STATE']);
  });

  it('still removes an existing bare rule for a built-in code', async () => {
    const form = fakeForm(ready({ rules: [A, bare('RATE_LIMIT')] }));
    const c = createRulesController(form);
    expect(c.hasBareRule('RATE_LIMIT')).toBe(true);
    expect(await c.removePreset('RATE_LIMIT')).toBe(true);
    expect(lastRules(form).value).toEqual([A]);
  });

  it('appends every new code of a group, in order, after the old rules', async () => {
    const form = fakeForm(ready({ rules: [A] }));
    await createRulesController(form).addPresetGroup('auth');
    expect(lastRules(form).value).toEqual([A, ...['MISSING_CREDENTIAL', 'ACCOUNT_SIGN_IN_REQUIRED', 'ACCOUNT_TOKEN_INVALID'].map((code) => bare(code))]);
  });

  it('removes a group\'s bare rules in one write and keeps custom rules', async () => {
    const custom = { ...A, code: 'AUTH', pattern: 'x' };
    const rules = [bare('AUTH'), bare('QUOTA'), custom, bare('MISSING_CREDENTIAL'), B];
    const form = fakeForm(ready({ rules }));
    const c = createRulesController(form);
    await c.removePresetGroup('auth');
    expect(form.writes).toHaveLength(1);
    expect(lastRules(form).value).toEqual([bare('QUOTA'), custom, B]);
    form.push(ready({ rules: lastRules(form).value }));
    expect(await c.removePresetGroup('auth')).toBe(true); // nothing to remove: no write
    expect(form.writes).toHaveLength(1);
    expect(await c.removePresetGroup('nope')).toBe(false);
  });

  it('duplicates a rule right after the original', async () => {
    const form = fakeForm(ready({ rules: [A, B, C] }));
    const c = createRulesController(form);
    await c.duplicate(1);
    expect(lastRules(form)).toEqual({ op: 'set', path: ['rules'], value: [A, B, B, C] });
    expect(lastRules(form).value[1]).not.toBe(lastRules(form).value[2]);
    expect(await c.duplicate(9)).toBe(false);
    expect(form.writes).toHaveLength(1);
  });

  it('keeps add() appending a blank rule at the end', async () => {
    const form = fakeForm(ready({ rules: [bare('AUTH')] }));
    await createRulesController(form).add();
    expect(lastRules(form).value.at(-1)).toEqual({ status: 0, code: '', pattern: '', regex: false, category: 'quota' });
  });
});
