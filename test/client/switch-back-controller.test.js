import { describe, expect, it } from 'vitest';
import { createSwitchBackController, parseMinutes } from '../../src/client/switch-back-controller.js';

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
const ready = (value) => ({ status: 'ready', value, revision: 3, writable: true });

describe('switch-back controller', () => {
  it('shows the defaults (off, 10 minutes) while loading', () => {
    const c = createSwitchBackController(fakeForm({ status: 'loading', value: undefined, revision: undefined, writable: false }));
    expect(c.getSnapshot()).toEqual({ writable: false, enabled: false, intervalMs: 600_000 });
  });

  it('reads the Host value and memoizes the view', () => {
    const form = fakeForm(ready({ switchBack: { enabled: true, intervalMs: 60_000 } }));
    const c = createSwitchBackController(form);
    const view = c.getSnapshot();
    expect(view).toEqual({ writable: true, enabled: true, intervalMs: 60_000 });
    expect(c.getSnapshot()).toBe(view);
  });

  it('writes the toggle and the interval at their paths', async () => {
    const form = fakeForm(ready({}));
    const c = createSwitchBackController(form);
    await c.setEnabled(true);
    await c.setIntervalMs(120_000);
    expect(form.writes).toEqual([
      { ops: [{ op: 'set', path: ['switchBack', 'enabled'], value: true }], rev: 3 },
      { ops: [{ op: 'set', path: ['switchBack', 'intervalMs'], value: 120_000 }], rev: 3 },
    ]);
  });

  it('notifies only when its own view changes', () => {
    const form = fakeForm(ready({ switchBack: { enabled: false } }));
    const c = createSwitchBackController(form);
    let calls = 0;
    c.subscribe(() => calls++);
    c.getSnapshot();
    form.push(ready({ switchBack: { enabled: true } }));
    expect(calls).toBe(1);
  });
});

describe('parseMinutes', () => {
  it('turns minutes into milliseconds', () => {
    expect(parseMinutes('10')).toBe(600_000);
    expect(parseMinutes(' 0.5 ')).toBe(30_000);
    expect(parseMinutes('0')).toBe(0);
  });
  it('rejects anything else', () => {
    for (const bad of ['', '-1', 'abc', '1e3']) expect(parseMinutes(bad)).toBeUndefined();
  });
});
