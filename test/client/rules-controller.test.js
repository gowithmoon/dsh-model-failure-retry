import { describe, expect, it } from 'vitest';
import { createRulesController } from '../../src/client/rules-controller.js';
import { DEFAULT_RULES } from '../../src/core/rules.js';

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
