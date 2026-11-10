import { describe, expect, it } from 'vitest';
import { DEFAULT_POLICY } from '../../src/core/policy.js';
import { createPolicyController, formatSequence, parseSequence } from '../../src/client/policy-controller.js';

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
const ops = (form) => form.writes.map((w) => w.ops);

describe('policy controller', () => {
  it('shows the default policy and no overrides while loading', () => {
    const c = createPolicyController(fakeForm({ status: 'loading', value: undefined, revision: undefined, writable: false }));
    expect(c.getSnapshot()).toMatchObject({ writable: false, policy: DEFAULT_POLICY, overrides: [] });
  });

  it('fills a partial Host value with defaults, for the global policy and each override', () => {
    const c = createPolicyController(fakeForm(ready({
      policy: { kind: 'linear' },
      overrides: [{ match: 'relay/*', policy: { maxAttempts: 2 } }],
    })));
    const view = c.getSnapshot();
    expect(view.policy).toEqual({ ...DEFAULT_POLICY, kind: 'linear' });
    expect(view.overrides).toEqual([{ match: 'relay/*', policy: { ...DEFAULT_POLICY, maxAttempts: 2 } }]);
    expect(c.getSnapshot()).toBe(view);
  });

  it('writes one global policy field at its path', async () => {
    const form = fakeForm(ready({}));
    await createPolicyController(form).setPolicyField('maxAttempts', 3);
    expect(ops(form)).toEqual([[{ op: 'set', path: ['policy', 'maxAttempts'], value: 3 }]]);
    expect(form.writes[0].rev).toBe(7);
  });

  it('adds, edits, moves and removes overrides by writing the whole list', async () => {
    const a = { match: 'a/*', policy: { ...DEFAULT_POLICY } };
    const b = { match: 'b/*', policy: { ...DEFAULT_POLICY } };
    const form = fakeForm(ready({ policy: { initialDelayMs: 2000 }, overrides: [a, b] }));
    const c = createPolicyController(form);

    await c.addOverride();
    expect(ops(form).at(-1)).toEqual([{ op: 'set', path: ['overrides'], value: [a, b, { match: '', policy: { ...DEFAULT_POLICY, initialDelayMs: 2000 } }] }]);

    await c.setOverrideMatch(0, 'relay/*');
    expect(ops(form).at(-1)[0].value[0]).toEqual({ ...a, match: 'relay/*' });

    await c.setOverrideField(1, 'kind', 'fixed');
    expect(ops(form).at(-1)[0].value[1].policy.kind).toBe('fixed');

    await c.moveOverride(1, -1);
    expect(ops(form).at(-1)[0].value.map((o) => o.match)).toEqual(['b/*', 'a/*']);

    await c.moveOverride(0, -1); // already first: no write
    expect(form.writes).toHaveLength(4);

    await c.removeOverride(0);
    expect(ops(form).at(-1)[0].value.map((o) => o.match)).toEqual(['b/*']);
  });
});

describe('custom sequence text', () => {
  it('parses seconds separated by commas or spaces into milliseconds', () => {
    expect(parseSequence('5,10,30,60')).toEqual([5000, 10000, 30000, 60000]);
    expect(parseSequence(' 1.5 ,  2  3 ')).toEqual([1500, 2000, 3000]);
    expect(parseSequence('5，10')).toEqual([5000, 10000]); // full-width comma
  });

  it('rejects empty, negative or non-numeric input', () => {
    expect(parseSequence('')).toBeUndefined();
    expect(parseSequence('5,-1')).toBeUndefined();
    expect(parseSequence('5,abc')).toBeUndefined();
  });

  it('formats milliseconds back to the text form', () => {
    expect(formatSequence([5000, 10000, 1500])).toBe('5, 10, 1.5');
  });
});
