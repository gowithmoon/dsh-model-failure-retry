import { describe, expect, it } from 'vitest';
import { createStatsController, rangeOf } from '../../src/client/stats-controller.js';

function fakeForm(value = {}) {
  let snap = { status: 'ready', writable: true, revision: 1, value };
  const listeners = new Set();
  const mutations = [];
  return {
    mutations,
    getSnapshot: () => snap,
    subscribe: (l) => { listeners.add(l); return () => listeners.delete(l); },
    mutate: async (ops) => { mutations.push(ops); return true; },
    set(next) { snap = { ...snap, ...next }; for (const l of listeners) l(); },
  };
}

const result = (extra = {}) => ({ summary: { retries: 1 }, buckets: [], events: [], total: 0, page: 1, pageSize: 20, facets: { sessions: [], models: [] }, ...extra });

describe('stats controller', () => {
  it('is unavailable until a loader is set, then loads with the default query', async () => {
    const c = createStatsController(fakeForm(), { now: () => 100 * 3_600_000, tzOffsetMin: () => -480 });
    expect(c.getSnapshot().status).toBe('unavailable');
    const calls = [];
    c.setLoader(async (q) => { calls.push(q); return result(); });
    await c.refresh();
    expect(c.getSnapshot()).toMatchObject({ status: 'ready', result: { summary: { retries: 1 } } });
    expect(calls[0]).toMatchObject({ bucket: 'hour', page: 1, tzOffsetMin: -480, from: 76 * 3_600_000 });
  });

  it('filters reset the page; paging keeps the filter', async () => {
    const calls = [];
    const c = createStatsController(fakeForm(), { now: () => 0, tzOffsetMin: () => 0 });
    c.setLoader(async (q) => { calls.push(q); return result(); });
    await c.setPage(3);
    await c.setFilter({ sessionId: 's1' });
    expect(calls.at(-1)).toMatchObject({ sessionId: 's1', page: 1 });
    await c.setPage(2);
    expect(calls.at(-1)).toMatchObject({ sessionId: 's1', page: 2 });
    await c.setFilter({ sessionId: '' });
    expect(calls.at(-1).sessionId).toBeUndefined();
  });

  it('range 7d / 30d switches to day buckets', async () => {
    const calls = [];
    const c = createStatsController(fakeForm(), { now: () => 0, tzOffsetMin: () => 0 });
    c.setLoader(async (q) => { calls.push(q); return result(); });
    await c.setFilter({ range: '30d' });
    expect(calls.at(-1)).toMatchObject({ bucket: 'day', from: -30 * 86_400_000 });
    expect(rangeOf('all')).toBeUndefined();
  });

  it('reports a failed query', async () => {
    const c = createStatsController(fakeForm(), {});
    c.setLoader(async () => { throw new Error('boom'); });
    await c.refresh();
    expect(c.getSnapshot().status).toBe('error');
  });

  it('reads and writes the retention days', async () => {
    const form = fakeForm({ stats: { retentionDays: 7 } });
    const c = createStatsController(form, {});
    expect(c.getSnapshot()).toMatchObject({ retentionDays: 7, writable: true });
    await c.setRetentionDays(14);
    expect(form.mutations[0]).toEqual([{ op: 'set', path: ['stats', 'retentionDays'], value: 14 }]);
    let notified = 0;
    c.subscribe(() => notified++);
    form.set({ value: { stats: { retentionDays: 14 } } });
    expect(c.getSnapshot().retentionDays).toBe(14);
    expect(notified).toBe(1);
  });

  it('defaults the retention to 30 days', () => {
    expect(createStatsController(fakeForm(), {}).getSnapshot().retentionDays).toBe(30);
  });
});
