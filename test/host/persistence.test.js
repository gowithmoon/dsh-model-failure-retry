// P2: 原模型与回切计时 survive a DSH restart / session reopen (plugin storageDomain).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as plugin from '../../src/host/index.js';
import { createFakeHost } from '../support/fake-host.js';
import { createFakeStorage } from '../support/fake-storage.js';

const MIN = 60_000;
const QUOTA = { code: 'QUOTA' };
const A = { provider: 'mock', model: 'a' };
const B = { provider: 'mock', model: 'b' };
const chains = [{ match: 'mock/a', candidates: [B] }];

let storage;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  storage = createFakeStorage();
});
afterEach(() => vi.useRealTimers());

/** A DSH process: a host with the shared (on-disk) storage and the plugin mounted. */
async function start(config = {}) {
  const host = createFakeHost();
  host.ctx.provide('storageDomain', storage.service);
  const fiber = host.ctx.plugin(plugin, { chains, ...config });
  await fiber;
  await vi.advanceTimersByTimeAsync(0);
  return { host, fiber };
}

/** The session `id` reopened in `host`, on `model` (DSH persists the model selection itself). */
function open(host, id, model) {
  const agent = host.createAgent(model);
  agent.session.id = id;
  return agent;
}

async function turn(host, agent, n, failures = [], { source } = {}) {
  host.status(agent, 'running');
  host.ctx.emit('agent/inbox/claimed', { agent, message: { role: 'user', id: `u${n}`, ...(source ? { source } : {}) }, turn: n });
  for (const f of failures) await host.requestError(agent, f, { turn: n });
  host.status(agent, 'idle');
  await vi.advanceTimersByTimeAsync(0);
}

/** Fall back from a to b in session `id`, then restart DSH. */
async function fallBackThenRestart(id, config) {
  const first = await start(config);
  const agent = open(first.host, id, A);
  await turn(first.host, agent, 1, [QUOTA]);
  expect(agent.model.current()).toEqual(B);
  await turn(first.host, agent, 2, [], { source: agent.followups[0].source });
  await first.fiber.dispose();
  return start(config);
}

describe('session state across a restart (P2)', () => {
  it('still knows the origin: the chain exhausted after a restart selects it back', async () => {
    const { host } = await fallBackThenRestart('session/1');
    const agent = open(host, 'session/1', B);
    await turn(host, agent, 3, [QUOTA]);
    expect(agent.model.current()).toEqual(A);
  });

  it('a user stop after a restart selects the origin back', async () => {
    const { host } = await fallBackThenRestart('s2');
    const agent = open(host, 's2', B);
    host.status(agent, 'running');
    host.ctx.emit('session/event', agent.session, { type: 'turn/end', seq: 1, time: 0, data: { turn: 3, reason: { kind: 'aborted', reason: { kind: 'user' } } } });
    expect(agent.model.current()).toEqual(A);
  });

  it('keeps the switch-back timer: due at the same time as without the restart', async () => {
    const switchBack = { enabled: true, intervalMs: 10 * MIN };
    const { host } = await fallBackThenRestart('s3', { switchBack });
    const agent = open(host, 's3', B);
    vi.setSystemTime(10 * MIN - 1);
    await turn(host, agent, 3);
    expect(agent.model.current()).toEqual(B);
    vi.setSystemTime(10 * MIN);
    await turn(host, agent, 4);
    expect(agent.model.current()).toEqual(A);
  });

  it('forgets the state once the episode ended (switched back), also after a restart', async () => {
    const switchBack = { enabled: true, intervalMs: 0 };
    const first = await start({ switchBack });
    const agent = open(first.host, 's4', A);
    await turn(first.host, agent, 1, [QUOTA]);
    await turn(first.host, agent, 2, [], { source: agent.followups[0].source });
    await turn(first.host, agent, 3); // switched back to a
    expect(agent.model.current()).toEqual(A);
    await first.fiber.dispose();
    const { host } = await start({ switchBack });
    const reopened = open(host, 's4', B); // e.g. the user picked b by hand meanwhile
    await turn(host, reopened, 4);
    expect(reopened.model.current()).toEqual(B);
  });

  it('keeps sessions apart', async () => {
    const { host } = await fallBackThenRestart('s5');
    const other = open(host, 's6', B);
    await turn(host, other, 1, [QUOTA]); // s6 never left anything: no origin to go back to
    expect(other.selections).toEqual([]);
  });
});
