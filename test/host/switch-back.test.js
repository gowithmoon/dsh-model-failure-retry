import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as plugin from '../../src/host/index.js';
import { createFakeHost } from '../support/fake-host.js';

const MIN = 60_000;
const QUOTA = { code: 'QUOTA' };
const A = { provider: 'mock', model: 'a' };
const B = { provider: 'mock', model: 'b' };
const chains = [{ match: '*/*', candidates: [B, { provider: 'other', model: 'c' }] }];

let host;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  host = createFakeHost();
});
afterEach(() => vi.useRealTimers());

async function mount(switchBack = { enabled: true, intervalMs: 10 * MIN }, config = {}) {
  await host.ctx.plugin(plugin, { chains, switchBack, ...config });
}

/**
 * One turn as dsh-agent-loop runs it: running, the first step claims the
 * turn's message (`agent/inbox/claimed`, before the step's model is read),
 * then each step's failures, then idle. `steps` lists failures per step.
 */
async function turn(agent, n, steps = [[]], { source } = {}) {
  host.status(agent, 'running');
  const message = { role: 'user', id: `u${n}`, content: [{ type: 'text', text: 'hi' }], ...(source ? { source } : {}) };
  host.ctx.emit('agent/inbox/claimed', { agent, message, turn: n });
  const models = [];
  for (const [i, failures] of steps.entries()) {
    models.push(agent.model.current().model);
    for (const f of failures) await host.requestError(agent, f, { turn: n, step: i + 1 });
  }
  host.status(agent, 'idle');
  await vi.advanceTimersByTimeAsync(0);
  return models;
}

/** Turn 1 on a fails with quota → b; the follow-up turn 2 succeeds on b. */
async function fallBackToB(agent) {
  await turn(agent, 1, [[QUOTA]]);
  const [followup] = agent.followups;
  await turn(agent, 2, [[]], { source: followup.source });
  expect(agent.model.current()).toEqual(B);
}

describe('switch back to the origin model (fake host)', () => {
  it('is off by default', async () => {
    await host.ctx.plugin(plugin, { chains });
    const agent = host.createAgent(A);
    await fallBackToB(agent);
    vi.advanceTimersByTime(60 * MIN);
    expect(await turn(agent, 3)).toEqual(['b']);
  });

  it('does not switch back when turned off', async () => {
    await mount({ enabled: false, intervalMs: 0 });
    const agent = host.createAgent(A);
    await fallBackToB(agent);
    vi.advanceTimersByTime(60 * MIN);
    expect(await turn(agent, 3)).toEqual(['b']);
  });

  it('does not switch back before the interval has passed', async () => {
    await mount();
    const agent = host.createAgent(A);
    await fallBackToB(agent);
    vi.advanceTimersByTime(10 * MIN - 1);
    expect(await turn(agent, 3)).toEqual(['b']);
  });

  it('switches back at the first step of a new turn once the interval has passed', async () => {
    await mount();
    const agent = host.createAgent({ ...A, reasoningEffort: 'high' });
    const events = [];
    host.ctx.on(plugin.DECISION_EVENT, (e) => events.push(e));
    await fallBackToB(agent);
    vi.advanceTimersByTime(10 * MIN);
    expect(await turn(agent, 3)).toEqual(['a']);
    expect(agent.model.current()).toEqual({ ...A, reasoningEffort: 'high' });
    expect(agent.followups).toHaveLength(1); // no probe, no extra message
    const last = events.at(-1);
    expect(last).toMatchObject({ agent, model: B, decision: { kind: 'switch-back', from: B, to: { ...A, reasoningEffort: 'high' } } });
  });

  it('does not switch back in the middle of a tool loop', async () => {
    await mount();
    const agent = host.createAgent(A);
    await turn(agent, 1, [[QUOTA]]);
    host.status(agent, 'running');
    host.ctx.emit('agent/inbox/claimed', { agent, message: { role: 'user', id: 'f', source: agent.followups[0].source }, turn: 2 });
    vi.advanceTimersByTime(30 * MIN); // a long tool call; the next step claims tool results only
    host.ctx.emit('agent/inbox/claimed', { agent, message: { role: 'user', id: 'steer' }, turn: 2 });
    expect(agent.model.current()).toEqual(B);
    host.status(agent, 'idle');
  });

  it('does not count the follow-up turn after a switch as a new turn', async () => {
    await mount({ enabled: true, intervalMs: 0 });
    const agent = host.createAgent(A);
    await fallBackToB(agent); // asserts the follow-up ran on b
  });

  it('when the origin fails again after switching back, walks the chain as usual', async () => {
    await mount();
    const agent = host.createAgent(A);
    await fallBackToB(agent);
    vi.advanceTimersByTime(10 * MIN);
    expect(await turn(agent, 3, [[QUOTA]])).toEqual(['a']);
    expect(agent.model.current()).toEqual(B);
    expect(agent.followups).toHaveLength(2);
    // the timer restarted with this failure of a
    await turn(agent, 4, [[]], { source: agent.followups[1].source });
    vi.advanceTimersByTime(10 * MIN - 1);
    expect(await turn(agent, 5)).toEqual(['b']);
    vi.advanceTimersByTime(1);
    expect(await turn(agent, 6)).toEqual(['a']);
  });

  it('a manual model change resets the origin and the timer', async () => {
    await mount();
    const agent = host.createAgent(A);
    await fallBackToB(agent);
    vi.advanceTimersByTime(10 * MIN);
    agent.model.select({ provider: 'mock', model: 'x' }); // the user picks x
    expect(await turn(agent, 3)).toEqual(['x']); // not back to a
    // x fails → b; x is the new origin, timed from its own failure
    await turn(agent, 4, [[QUOTA]]);
    await turn(agent, 5, [[]], { source: agent.followups[1].source });
    vi.advanceTimersByTime(10 * MIN - 1);
    expect(await turn(agent, 6)).toEqual(['b']);
    vi.advanceTimersByTime(1);
    expect(await turn(agent, 7)).toEqual(['x']);
  });

  it('switches back only the session that fell back', async () => {
    await mount();
    const parent = host.createAgent(A);
    const child = host.createAgent(A);
    await fallBackToB(child);
    parent.model.select(B);
    vi.advanceTimersByTime(10 * MIN);
    expect(await turn(parent, 1)).toEqual(['b']);
    expect(await turn(child, 3)).toEqual(['a']);
  });
});
