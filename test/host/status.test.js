import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as plugin from '../../src/host/index.js';
import { STATUS_PROJECTION } from '../../src/host/status-projection.js';
import { createFakeHost } from '../support/fake-host.js';

const A = { provider: 'mock', model: 'a' };
const B = { provider: 'mock', model: 'b' };
const chains = [{ match: '*/*', candidates: [B] }];

let host;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
  host = createFakeHost();
});
afterEach(() => vi.useRealTimers());

async function mount(config = {}) {
  await host.ctx.plugin(plugin, { chains, ...config });
  await vi.advanceTimersByTimeAsync(0);
}

const status = (agent) => host.projection(agent, STATUS_PROJECTION);

describe('stop (agent.cancel / DSH stop)', () => {
  const events = [];
  beforeEach(() => { events.length = 0; });
  async function mountObserved(config) {
    await mount(config);
    host.ctx.on(plugin.DECISION_EVENT, (e) => events.push(e.decision.kind));
  }

  it('ends the wait at once, does not retry, and clears the status with the turn', async () => {
    await mountObserved();
    const agent = host.createAgent(A);
    const pending = host.requestError(agent, { code: 'RATE_LIMIT' });
    await vi.advanceTimersByTimeAsync(0);
    agent.cancel({ kind: 'user' });
    await vi.advanceTimersByTimeAsync(0);
    await expect(pending).resolves.toBeUndefined();
    expect(agent.session.events.map((e) => e.type)).toEqual(['llm/retry']);
    expect(events).toEqual(['retry', 'stopped']);
    expect(host.builtinRetry.calls).toEqual([]);
  });

  it('a failure after the stop is neither retried nor switched', async () => {
    await mountObserved();
    const agent = host.createAgent(A);
    agent.cancel({ kind: 'user' });
    await expect(host.requestError(agent, { code: 'QUOTA' })).resolves.toBeUndefined();
    await expect(host.requestError(agent, { code: 'TIMEOUT' })).resolves.toBeUndefined();
    expect(agent.selections).toEqual([]);
    expect(agent.session.events).toEqual([]);
    expect(host.builtinRetry.calls).toEqual([]);
  });

  it('stopping while waiting on a candidate selects the origin back', async () => {
    await mountObserved();
    const agent = host.createAgent(A);
    host.status(agent, 'running');
    await host.requestError(agent, { code: 'QUOTA' });
    host.status(agent, 'idle');
    expect(agent.model.current()).toEqual(B);
    // The follow-up turn on B hits a rate limit, and the user stops during the wait.
    const turn2 = new AbortController();
    agent.controller = turn2;
    Object.defineProperty(agent, 'signal', { get: () => turn2.signal });
    agent.cancel = (cause) => turn2.abort(cause);
    host.status(agent, 'running');
    const pending = host.requestError(agent, { code: 'RATE_LIMIT' }, { turn: 2 });
    await vi.advanceTimersByTimeAsync(0);
    agent.cancel({ kind: 'user' });
    await vi.advanceTimersByTimeAsync(0);
    await expect(pending).resolves.toBeUndefined();
    expect(agent.model.current()).toEqual(A);
    host.status(agent, 'idle');
    expect(agent.followups).toHaveLength(1); // only the first switch's
    expect(events).toEqual(['fallback', 'retry', 'stopped']);
  });

  it('stopping right after a switch skips the follow-up and selects the origin back', async () => {
    await mountObserved();
    const agent = host.createAgent(A);
    host.status(agent, 'running');
    await host.requestError(agent, { code: 'QUOTA' });
    agent.cancel({ kind: 'user' });
    host.status(agent, 'idle');
    expect(agent.followups).toEqual([]);
    expect(agent.model.current()).toEqual(A);
    expect(events).toEqual(['fallback', 'stopped']);
  });
});

describe('in-session status projection', () => {
  it('shows the category, attempt, max attempts and retry time while waiting', async () => {
    await mount({ policy: { maxAttempts: 5, initialDelayMs: 10_000, maxDelayMs: 10_000, jitterRatio: 0 } });
    const agent = host.createAgent(A);
    host.sessionEvent(agent, 'step/start', { turn: 1, step: 1 });
    const pending = host.requestError(agent, { code: 'RATE_LIMIT' });
    await vi.advanceTimersByTimeAsync(0);
    expect(status(agent)).toEqual({
      kind: 'retry', category: 'rate-limit', attempt: 1, maxAttempts: 5, retryAt: 1_000_000 + 10_000,
    });
    await vi.advanceTimersByTimeAsync(10_000);
    await expect(pending).resolves.toEqual({ kind: 'retry' });
    expect(status(agent)).toBeNull();
  });

  it('is cleared when the step or turn ends', async () => {
    await mount();
    const agent = host.createAgent(A);
    host.requestError(agent, { code: 'TIMEOUT' });
    await vi.advanceTimersByTimeAsync(0);
    expect(status(agent)?.kind).toBe('retry');
    host.sessionEvent(agent, 'turn/end', { turn: 1, reason: { kind: 'aborted', reason: { kind: 'user' } } });
    expect(status(agent)).toBeNull();
  });

  it('starts empty: a reopened session shows no status', async () => {
    await mount();
    const agent = host.createAgent(A);
    expect(status(agent)).toBeNull();
  });

  it('records the retry in the session log as llm/retry, then llm/retry-started', async () => {
    await mount();
    const agent = host.createAgent(A);
    const pending = host.requestError(agent, { code: 'TIMEOUT' }, { turn: 3, step: 2 });
    await vi.advanceTimersByTimeAsync(60_000);
    await pending;
    const [scheduled, started] = agent.session.events;
    expect(scheduled).toMatchObject({
      type: 'llm/retry',
      data: { turn: 3, step: 2, provider: 'mock', mode: 'normal', policyKey: 'model-failure-retry:transient', retry: 1, maxRetries: 5 },
    });
    expect(started).toMatchObject({ type: 'llm/retry-started', data: { retryId: scheduled.data.retryId, turn: 3, step: 2, retry: 1 } });
  });

  it('keeps one retry id across the retries of one request', async () => {
    await mount();
    const agent = host.createAgent(A);
    for (let i = 0; i < 2; i++) {
      const pending = host.requestError(agent, { code: 'TIMEOUT' });
      await vi.advanceTimersByTimeAsync(60_000);
      await pending;
    }
    const ids = agent.session.events.filter((e) => e.type === 'llm/retry').map((e) => [e.data.retryId, e.data.retry]);
    expect(ids).toHaveLength(2);
    expect(ids[0][0]).toBe(ids[1][0]);
    expect(ids.map(([, n]) => n)).toEqual([1, 2]);
  });

  it('shows the switch from the failed model to the candidate', async () => {
    await mount();
    const agent = host.createAgent(A);
    host.status(agent, 'running');
    await host.requestError(agent, { code: 'QUOTA' });
    host.status(agent, 'idle');
    // dsh-agent-loop commits the follow-up as user/message when the next turn claims it.
    const [message] = agent.followups;
    expect(message.source).toMatchObject({ kind: 'model-fallback', from: A, to: B });
    host.sessionEvent(agent, 'user/message', message);
    expect(status(agent)).toEqual({ kind: 'switch', from: A, to: B });
    host.sessionEvent(agent, 'turn/end', { turn: 2, reason: { kind: 'completed' } });
    expect(status(agent)).toBeNull();
  });
});
