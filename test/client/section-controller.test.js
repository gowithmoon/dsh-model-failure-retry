import { describe, expect, it } from 'vitest';
import { createSectionController } from '../../src/client/section-controller.js';

/** A ConfigForm stand-in recording mutations and letting tests push snapshots. */
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

const ready = (value, extra = {}) => ({ status: 'ready', value, base: undefined, user: undefined, revision: 3, writable: true, ...extra });

describe('settings section controller', () => {
  it('shows defaults (all on) while the form is loading', () => {
    const c = createSectionController(fakeForm({ status: 'loading', value: undefined, revision: undefined, writable: false }));
    expect(c.getSnapshot()).toMatchObject({
      status: 'loading',
      writable: false,
      enabled: true,
      categories: { 'rate-limit': true, transient: true },
    });
  });

  it('reflects the Host value and keeps a stable snapshot between changes', () => {
    const form = fakeForm(ready({ enabled: false, categories: { 'rate-limit': { enabled: true }, transient: { enabled: false } } }));
    const c = createSectionController(form);
    const first = c.getSnapshot();
    expect(first).toMatchObject({ status: 'ready', writable: true, enabled: false, categories: { 'rate-limit': true, transient: false } });
    expect(c.getSnapshot()).toBe(first);
    let notified = 0;
    c.subscribe(() => { notified++; });
    form.push(ready({ enabled: true, categories: {} }));
    expect(notified).toBe(1);
    expect(c.getSnapshot()).toMatchObject({ enabled: true, categories: { 'rate-limit': true, transient: true } });
  });

  it('writes the master switch and category switches at their config paths', async () => {
    const form = fakeForm(ready({}));
    const c = createSectionController(form);
    await c.setEnabled(false);
    await c.setCategory('transient', false);
    expect(form.writes.map((w) => w.ops)).toEqual([
      [{ op: 'set', path: ['enabled'], value: false }],
      [{ op: 'set', path: ['categories', 'transient', 'enabled'], value: false }],
    ]);
  });
});
