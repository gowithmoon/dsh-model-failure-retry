import { describe, expect, it } from 'vitest';
import { createChainsController, createModelCatalog } from '../../src/client/chains-controller.js';

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
const last = (form) => form.writes.at(-1).ops[0];

const catalogValue = {
  groups: [
    { id: 'deepseek', name: 'DeepSeek', models: [{ id: 'chat', name: 'Chat' }, { id: 'reasoner', name: 'Reasoner' }] },
    { id: 'relay', name: 'Relay', models: [{ id: 'gpt-4o', name: 'GPT-4o' }] },
  ],
  failures: [],
};
const loaded = () => {
  const catalog = createModelCatalog();
  catalog.setLoader(async () => ({ ok: true, value: catalogValue }));
  return catalog;
};
const flush = () => new Promise((r) => setTimeout(r, 0));

const A = { match: 'deepseek/*', candidates: [{ provider: 'relay', model: 'gpt-4o' }] };
const B = { match: '*/*', candidates: [] };

describe('model catalog', () => {
  it('is unavailable without a loader, and lists providers and their models once loaded', async () => {
    const catalog = createModelCatalog();
    expect(catalog.getSnapshot().status).toBe('unavailable');
    catalog.setLoader(async () => ({ ok: true, value: catalogValue }));
    catalog.refresh();
    expect(catalog.getSnapshot().status).toBe('loading');
    await flush();
    const snap = catalog.getSnapshot();
    expect(snap.status).toBe('ready');
    expect(snap.providers.map((p) => p.id)).toEqual(['deepseek', 'relay']);
    expect(snap.modelsOf('deepseek').map((m) => m.id)).toEqual(['chat', 'reasoner']);
    expect(snap.modelsOf('nope')).toEqual([]);
  });

  it('reports a load failure', async () => {
    const catalog = createModelCatalog();
    catalog.setLoader(async () => ({ ok: false, error: { code: 'X', message: 'down' } }));
    catalog.refresh();
    await flush();
    expect(catalog.getSnapshot().status).toBe('error');
  });
});

describe('fallback chains controller', () => {
  it('shows no chains until the Host value has some', () => {
    const c = createChainsController(fakeForm({ status: 'loading' }), createModelCatalog());
    expect(c.getSnapshot().chains).toEqual([]);
    expect(c.getSnapshot().writable).toBe(false);
  });

  it('adds, removes and reorders chains as whole-list writes', async () => {
    const form = fakeForm(ready({ chains: [A, B] }));
    const c = createChainsController(form, createModelCatalog());
    await c.move(0, 1);
    expect(last(form)).toEqual({ op: 'set', path: ['chains'], value: [B, A] });
    await c.move(1, 1); // already last: no write
    expect(form.writes).toHaveLength(1);
    await c.add();
    expect(last(form).value).toEqual([A, B, { match: '*/*', candidates: [] }]);
    await c.remove(0);
    expect(last(form).value).toEqual([B]);
    await c.setMatch(1, ' relay/* ');
    expect(last(form).value).toEqual([A, { ...B, match: 'relay/*' }]);
    expect(form.writes.every((w) => w.rev === 3)).toBe(true);
  });

  it('adds, edits, removes and reorders candidates of one chain', async () => {
    const form = fakeForm(ready({ chains: [A] }));
    const c = createChainsController(form, createModelCatalog());
    await c.addCandidate(0, { provider: 'deepseek', model: 'chat' });
    expect(last(form).value[0].candidates).toEqual([{ provider: 'relay', model: 'gpt-4o' }, { provider: 'deepseek', model: 'chat' }]);
    form.push(ready({ chains: [{ match: 'x', candidates: [{ provider: 'p', model: '1' }, { provider: 'p', model: '2' }] }] }));
    await c.moveCandidate(0, 1, -1);
    expect(last(form).value[0].candidates.map((m) => m.model)).toEqual(['2', '1']);
    await c.setCandidate(0, 0, { provider: 'q', model: '9' });
    expect(last(form).value[0].candidates).toEqual([{ provider: 'q', model: '9' }, { provider: 'p', model: '2' }]);
    await c.removeCandidate(0, 1);
    expect(last(form).value[0].candidates).toEqual([{ provider: 'p', model: '1' }]);
  });

  it('flags candidates whose provider or model is not in the catalog, once it is loaded', async () => {
    const catalog = loaded();
    const form = fakeForm(ready({
      chains: [{ match: '*/*', candidates: [{ provider: 'relay', model: 'gpt-4o' }, { provider: 'gone', model: 'x' }, { provider: 'deepseek', model: 'old' }] }],
    }));
    const c = createChainsController(form, catalog);
    expect(c.getSnapshot().chains[0].candidates.map((m) => m.missing)).toEqual([undefined, undefined, undefined]);
    let notified = 0;
    c.subscribe(() => { notified += 1; });
    catalog.refresh();
    await flush();
    expect(notified).toBeGreaterThan(0);
    expect(c.getSnapshot().chains[0].candidates.map((m) => m.missing)).toEqual([undefined, 'provider', 'model']);
    expect(c.getSnapshot().catalog.status).toBe('ready');
  });

  it('flags a match rule that cannot match anything and stores candidates without view fields', async () => {
    const form = fakeForm(ready({ chains: [{ match: '', candidates: [] }] }));
    const c = createChainsController(form, loaded());
    expect(c.getSnapshot().chains[0].error).toBe('empty-match');
    await c.addCandidate(0, { provider: 'relay', model: 'gpt-4o', missing: 'model' });
    expect(last(form).value[0].candidates).toEqual([{ provider: 'relay', model: 'gpt-4o' }]);
  });
});
