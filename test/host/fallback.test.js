import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as plugin from '../../src/host/index.js';
import { createFakeHost } from '../support/fake-host.js';

async function settle(promise) {
  let done = false;
  promise.finally(() => { done = true; });
  while (!done) await vi.advanceTimersByTimeAsync(1000);
  return promise;
}

let host;
beforeEach(() => {
  vi.useFakeTimers();
  host = createFakeHost();
});
afterEach(() => vi.useRealTimers());

const QUOTA = { code: 'QUOTA' };
const chains = [{ match: 'mock/a', candidates: [{ provider: 'mock', model: 'b' }, { provider: 'other', model: 'c' }] }];

async function mount(config = {}) {
  const fiber = host.ctx.plugin(plugin, { chains, ...config });
  await fiber;
  return fiber;
}

/** One turn of the agent: running, the given failures in order, then idle. */
async function turn(agent, failures, at = {}) {
  host.status(agent, 'running');
  const results = [];
  for (const f of failures) results.push(await settle(host.requestError(agent, f, at)));
  host.status(agent, 'idle');
  await vi.advanceTimersByTimeAsync(0);
  return results;
}

describe('fallback along a chain (fake host)', () => {
  it('quota → selects the next candidate, ends the turn, then follows up once idle', async () => {
    await mount();
    const agent = host.createAgent({ provider: 'mock', model: 'a' });
    host.status(agent, 'running');
    await expect(host.requestError(agent, QUOTA)).resolves.toBeUndefined();
    expect(agent.model.current()).toEqual({ provider: 'mock', model: 'b' });
    expect(agent.followups).toEqual([]); // not while the turn is still running
    host.status(agent, 'idle');
    expect(agent.followups).toHaveLength(1);
    const [message] = agent.followups;
    expect(message.role).toBe('user');
    expect(message.content).toEqual([{ type: 'text', text: 'Continue.' }]);
    expect(message.source).toMatchObject({ kind: 'model-fallback', form: 'notice' });
    expect(message.source.summary).toContain('mock/b');
    expect(host.builtinRetry.calls).toEqual([]);

    // the follow-up turn succeeds on b: no further switch, the session stays on b
    await turn(agent, []);
    expect(agent.followups).toHaveLength(1);
    expect(agent.model.current()).toEqual({ provider: 'mock', model: 'b' });
  });

  it('the whole chain fails → selects the origin model back, without a follow-up', async () => {
    await mount();
    const agent = host.createAgent({ provider: 'mock', model: 'a' });
    await turn(agent, [QUOTA]);
    await turn(agent, [QUOTA], { turn: 2 });
    expect(agent.model.current()).toEqual({ provider: 'other', model: 'c' });
    expect(agent.followups).toHaveLength(2);
    await turn(agent, [QUOTA], { turn: 3 });
    expect(agent.model.current()).toEqual({ provider: 'mock', model: 'a' });
    expect(agent.followups).toHaveLength(2);
  });

  it('a manual model change becomes the new origin', async () => {
    await mount({ chains: [{ match: '*/*', candidates: [{ provider: 'mock', model: 'b' }] }] });
    const agent = host.createAgent({ provider: 'mock', model: 'a' });
    await turn(agent, [QUOTA]);
    expect(agent.model.current()).toEqual({ provider: 'mock', model: 'b' });
    agent.model.select({ provider: 'mock', model: 'x' }); // the user picks x
    await turn(agent, [QUOTA], { turn: 3 }); // x → b
    expect(agent.model.current()).toEqual({ provider: 'mock', model: 'b' });
    await turn(agent, [QUOTA], { turn: 4 }); // b fails too: chain exhausted
    expect(agent.model.current()).toEqual({ provider: 'mock', model: 'x' });
  });

  it('switches after the retries are used up, and the candidate counts its own retries from zero', async () => {
    await mount({
      policy: { kind: 'fixed', initialDelayMs: 1000, jitterRatio: 0, maxAttempts: 2 },
      overrides: [{ match: 'mock/b', policy: { kind: 'fixed', initialDelayMs: 1000, jitterRatio: 0, maxAttempts: 1 } }],
    });
    const agent = host.createAgent({ provider: 'mock', model: 'a' });
    const rl = { code: 'RATE_LIMIT' };
    expect(await turn(agent, [rl, rl, rl])).toEqual([{ kind: 'retry' }, { kind: 'retry' }, undefined]);
    expect(agent.model.current()).toEqual({ provider: 'mock', model: 'b' });
    // b's own policy: one retry, then on to c
    expect(await turn(agent, [rl, rl], { turn: 2 })).toEqual([{ kind: 'retry' }, undefined]);
    expect(agent.model.current()).toEqual({ provider: 'other', model: 'c' });
  });

  it('skips a candidate that fails fatally or overflows its context', async () => {
    await mount({ chains: [{ match: 'mock/a', candidates: ['b', 'c', 'd'].map((model) => ({ provider: 'mock', model })) }] });
    const agent = host.createAgent({ provider: 'mock', model: 'a' });
    await turn(agent, [QUOTA]);
    await turn(agent, [{ code: 'AUTH' }], { turn: 2 });
    expect(agent.model.current()).toEqual({ provider: 'mock', model: 'c' });
    await turn(agent, [{ code: 'CONTEXT_WINDOW_EXCEEDED' }], { turn: 3 });
    expect(agent.model.current()).toEqual({ provider: 'mock', model: 'd' });
    expect(host.builtinRetry.calls).toEqual([]);
  });

  it('skips a candidate that no longer exists, and keeps the reasoning effort only where supported', async () => {
    host.provideLlm({
      mock: { a: { reasoning: { efforts: [{ id: 'high' }] } }, c: { reasoning: { efforts: [{ id: 'high' }] } }, d: {} },
    });
    await mount({ chains: [{ match: 'mock/a', candidates: ['b', 'c', 'd'].map((model) => ({ provider: 'mock', model })) }] });
    const agent = host.createAgent({ provider: 'mock', model: 'a', reasoningEffort: 'high' });
    await turn(agent, [QUOTA]);
    expect(agent.model.current()).toEqual({ provider: 'mock', model: 'c', reasoningEffort: 'high' }); // b is missing
    await turn(agent, [QUOTA], { turn: 2 });
    expect(agent.model.current()).toEqual({ provider: 'mock', model: 'd' }); // d has no reasoning: its default
  });

  it('switches only the session that failed (a subagent has its own state)', async () => {
    await mount();
    const parent = host.createAgent({ provider: 'mock', model: 'a' });
    const child = host.createAgent({ provider: 'mock', model: 'a' });
    await turn(child, [QUOTA]);
    expect(child.model.current().model).toBe('b');
    expect(parent.model.current().model).toBe('a');
    expect(parent.followups).toEqual([]);
  });

  it('gives up as before when no chain matches the model', async () => {
    await mount();
    const agent = host.createAgent({ provider: 'mock', model: 'z' });
    expect(await turn(agent, [QUOTA])).toEqual([undefined]);
    expect(agent.selections).toEqual([]);
    expect(agent.followups).toEqual([]);
  });

  it('does not follow up when the turn signal aborted (user stop)', async () => {
    await mount();
    const agent = host.createAgent({ provider: 'mock', model: 'a' });
    agent.controller.abort(new Error('stop'));
    await turn(agent, [QUOTA]);
    expect(agent.selections).toEqual([]);
    expect(agent.followups).toEqual([]);
  });

  it('publishes every decision with the fallback state for other modules (#7/#8/#9)', async () => {
    host.provideLlm({ mock: { a: {}, c: {} } });
    await mount({ chains: [{ match: 'mock/a', candidates: ['b', 'c'].map((model) => ({ provider: 'mock', model })) }] });
    const events = [];
    host.ctx.on(plugin.DECISION_EVENT, (e) => events.push(e));
    host.ctx.on(plugin.DECISION_EVENT, () => { throw new Error('a broken observer'); });
    const agent = host.createAgent({ provider: 'mock', model: 'a' });
    await turn(agent, [QUOTA]);
    await turn(agent, [QUOTA], { turn: 2 });
    const a = { provider: 'mock', model: 'a' };
    expect(events.map((e) => [e.model.model, e.decision.kind, e.decision.reason])).toEqual([
      ['a', 'skip', 'missing-model'],
      ['a', 'fallback', 'quota'],
      ['c', 'give-up', 'chain-exhausted'],
    ]);
    expect(events[1]).toMatchObject({ agent, origin: a, decision: { to: { model: 'c' }, selection: { provider: 'mock', model: 'c' } } });
    expect(events[2].origin).toEqual(a);
    expect(agent.model.current()).toEqual(a);
  });
});
