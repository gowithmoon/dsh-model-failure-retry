import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as plugin from '../../src/host/index.js';
import { STATS_SERVICE } from '../../src/host/stats.js';
import { createFakeHost } from '../support/fake-host.js';
import { createFakeStorage } from '../support/fake-storage.js';

const DAY = 86_400_000;
const RL = { code: 'RATE_LIMIT', message: '429 Too Many Requests' };
const QUOTA = { code: 'QUOTA', message: 'daily limit reached' };
const chains = [{ match: 'mock/a', candidates: [{ provider: 'mock', model: 'ghost' }, { provider: 'mock', model: 'b' }] }];

async function settle(promise) {
  let done = false;
  promise.finally(() => { done = true; });
  while (!done) await vi.advanceTimersByTimeAsync(1000);
  return promise;
}

let host;
let storage;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(10 * DAY);
  host = createFakeHost();
  storage = createFakeStorage();
  host.ctx.provide('storageDomain', storage.service);
  host.provideLlm({ mock: { a: {}, b: {} } });
});
afterEach(() => vi.useRealTimers());

async function mount(config = {}) {
  const fiber = host.ctx.plugin(plugin, { chains, ...config });
  await fiber;
  await vi.advanceTimersByTimeAsync(0);
  return fiber;
}

function agentIn(sessionId, { subagent = false, model = 'a' } = {}) {
  const agent = host.createAgent({ provider: 'mock', model });
  agent.session = { id: sessionId, header: { id: sessionId, ...(subagent ? { origin: 'subagent' } : {}) } };
  return agent;
}

function turnEnd(agent, reason) {
  host.ctx.emit('session/event', agent.session, { type: 'turn/end', seq: 1, time: Date.now(), data: { turn: 1, reason } });
}

const stats = () => host.ctx.get(STATS_SERVICE);
const stored = () => [...(storage.data.get('model_failure_retry_stats')?.get('events')?.values() ?? [])];

describe('stats (fake host)', () => {
  it('records a retry with its fields, then the rescue when the turn completes', async () => {
    await mount();
    const agent = agentIn('s1');
    await settle(host.requestError(agent, RL));
    turnEnd(agent, { kind: 'completed' });
    await vi.advanceTimersByTimeAsync(0);
    const rows = stored().sort((x, y) => x.time - y.time);
    expect(rows.map((r) => r.kind)).toEqual(['retry', 'rescued']);
    expect(rows[0]).toMatchObject({
      sessionId: 's1', subagent: false, provider: 'mock', model: 'a', category: 'rate-limit',
      status: 429, code: 'RATE_LIMIT', error: '429 Too Many Requests', attempt: 1, maxAttempts: 5,
    });
    expect(rows[0].delayMs).toBeGreaterThan(0);
    expect(rows[0].time).toBe(10 * DAY);
  });

  it('records skip, fallback (from/to) and the subagent flag; the error turn of a switch is no failure', async () => {
    await mount();
    const agent = agentIn('child', { subagent: true });
    await host.requestError(agent, QUOTA);
    turnEnd(agent, { kind: 'error', error: QUOTA });
    turnEnd(agent, { kind: 'completed' }); // the follow-up turn on b
    await vi.advanceTimersByTimeAsync(0);
    const rows = stored();
    expect(rows.map((r) => r.kind).sort()).toEqual(['fallback', 'rescued', 'skip']);
    expect(rows.find((r) => r.kind === 'skip')).toMatchObject({ model: 'ghost', reason: 'missing-model', subagent: true, sessionId: 'child' });
    expect(rows.find((r) => r.kind === 'fallback')).toMatchObject({ from: 'mock/a', to: 'mock/b', category: 'quota', reason: 'quota' });
    expect(rows.find((r) => r.kind === 'rescued')).toMatchObject({ model: 'b' });
  });

  it('records a final failure, and nothing more at the turn end', async () => {
    await mount({ chains: [] });
    const agent = agentIn('s1');
    await host.requestError(agent, { code: 'AUTH', message: '401 invalid key' });
    turnEnd(agent, { kind: 'error', error: {} });
    await vi.advanceTimersByTimeAsync(0);
    expect(stored()).toEqual([expect.objectContaining({ kind: 'failure', reason: 'fatal', category: 'fatal', status: 401 })]);
  });

  it('records a user stop while the plugin is waiting to retry', async () => {
    await mount();
    const agent = agentIn('s1');
    const pending = host.requestError(agent, RL);
    await vi.advanceTimersByTimeAsync(100);
    agent.controller.abort();
    await pending;
    turnEnd(agent, { kind: 'aborted', reason: { kind: 'user' } });
    await vi.advanceTimersByTimeAsync(0);
    expect(stored().map((r) => r.kind).sort()).toEqual(['retry', 'stop']);
  });

  it('does not record pass decisions, nor turns the plugin never touched', async () => {
    await mount();
    const agent = agentIn('s1');
    await host.requestError(agent, { code: 'UNKNOWN', message: 'weird' });
    turnEnd(agent, { kind: 'completed' });
    turnEnd(agent, { kind: 'aborted', reason: { kind: 'user' } });
    await vi.advanceTimersByTimeAsync(0);
    expect(stored()).toEqual([]);
  });

  it('records the #9 switch-back published on the decision event', async () => {
    await mount();
    const agent = agentIn('s1', { model: 'b' });
    host.ctx.emit(plugin.DECISION_EVENT, { agent, model: { provider: 'mock', model: 'b' }, decision: { kind: 'switch-back', from: { provider: 'mock', model: 'b' }, to: { provider: 'mock', model: 'a' } } });
    await vi.advanceTimersByTimeAsync(0);
    expect(stored()).toEqual([expect.objectContaining({ kind: 'switch-back', from: 'mock/b', to: 'mock/a' })]);
  });

  it('keeps records across a restart and purges the expired ones', async () => {
    const fiber = await mount();
    const agent = agentIn('s1');
    await settle(host.requestError(agent, RL));
    await fiber.dispose();
    expect(storage.opened[0].closed).toBe(true);

    vi.setSystemTime(10 * DAY + 5 * DAY);
    await mount({ stats: { retentionDays: 30 } });
    expect(stored()).toHaveLength(1);
    expect((await stats().query({})).total).toBe(1);

    vi.setSystemTime(10 * DAY + 31 * DAY);
    expect((await stats().query({})).total).toBe(0); // purged on query
    expect(stored()).toHaveLength(0);
  });

  it('purges with the configured retention, also on a timer', async () => {
    await mount({ stats: { retentionDays: 1 } });
    const agent = agentIn('s1');
    await settle(host.requestError(agent, RL));
    expect(stored()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(DAY + 2 * 3_600_000);
    expect(stored()).toHaveLength(0);
  });

  it('query filters and aggregates over stored records', async () => {
    await mount();
    await settle(host.requestError(agentIn('s1'), RL));
    await host.requestError(agentIn('s2'), QUOTA);
    const all = await stats().query({ bucket: 'day' });
    expect(all.summary).toMatchObject({ retries: 1, fallbacks: 1, skips: 1 });
    expect(all.buckets).toHaveLength(1);
    const s2 = await stats().query({ sessionId: 's2' });
    expect(s2.total).toBe(2);
    expect(s2.facets.sessions.sort()).toEqual(['s1', 's2']);
    expect((await stats().query({ category: 'rate-limit' })).total).toBe(1);
  });

  it('works without a storage service (records nothing, query is empty)', async () => {
    const bare = createFakeHost();
    await bare.ctx.plugin(plugin, {});
    const agent = bare.createAgent();
    agent.session = { id: 's1', header: {} };
    await settle(bare.requestError(agent, RL));
    expect((await bare.ctx.get(STATS_SERVICE).query({})).total).toBe(0);
  });

  it('registers the query as a strict Remote invocation bound to the service', async () => {
    const registered = [];
    host.ctx.provide('typert', { register: (c) => { registered.push(c); return () => { registered.splice(registered.indexOf(c), 1); }; } });
    const fiber = await mount();
    expect(registered).toHaveLength(1);
    const [inv] = registered[0].invocations;
    expect(inv).toMatchObject({ id: `dsh-model-failure-retry#${STATS_SERVICE}/query`, service: STATS_SERVICE, method: 'query', invocation: { kind: 'direct' } });
    expect(inv.parameters[0].codec.create().parse({ sessionId: 's1', page: 2, junk: { x: 1 } })).toEqual({ sessionId: 's1', page: 2 });
    expect(() => inv.parameters[0].codec.create().parse([])).toThrow();
    const service = stats();
    expect(service.typertRemote).toMatchObject({ serviceKey: STATS_SERVICE, namespace: STATS_SERVICE });
    expect(typeof service.query).toBe('function');
    await fiber.dispose();
    expect(registered).toHaveLength(0);
  });
});
