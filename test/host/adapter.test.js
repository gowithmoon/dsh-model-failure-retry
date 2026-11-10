import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as plugin from '../../src/host/index.js';
import { createFakeHost } from '../support/fake-host.js';

/** Run an async dispatch to completion while fake timers drive the waits. */
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
afterEach(() => {
  vi.useRealTimers();
});

async function mount(config = {}) {
  const fiber = host.ctx.plugin(plugin, config);
  await fiber;
  return fiber;
}

describe('agent/request-error adapter', () => {
  it('waits and retries a rate limit, and the builtin retry never sees it', async () => {
    await mount();
    const agent = host.createAgent();
    const pending = host.requestError(agent, { code: 'RATE_LIMIT' });
    await vi.advanceTimersByTimeAsync(4000);
    let settled = false;
    pending.then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false); // still waiting: first wait is 5s ± 10%
    await expect(settle(pending)).resolves.toEqual({ kind: 'retry' });
    expect(host.builtinRetry.calls).toEqual([]);
  });

  it('retries a transient failure', async () => {
    await mount();
    const agent = host.createAgent();
    await expect(settle(host.requestError(agent, { code: 'TIMEOUT' }))).resolves.toEqual({ kind: 'retry' });
  });

  it('fails the request after the 5th retry without handing it to the builtin retry', async () => {
    await mount();
    const agent = host.createAgent();
    for (let i = 0; i < 5; i++) {
      await expect(settle(host.requestError(agent, { code: 'RATE_LIMIT' }))).resolves.toEqual({ kind: 'retry' });
    }
    await expect(settle(host.requestError(agent, { code: 'RATE_LIMIT' }))).resolves.toBeUndefined();
    expect(host.builtinRetry.calls).toEqual([]);
  });

  it('counts retries per request × model: a new step or another model starts again', async () => {
    await mount();
    const agent = host.createAgent();
    for (let i = 0; i < 5; i++) await settle(host.requestError(agent, { code: 'RATE_LIMIT' }, { step: 1 }));
    await expect(settle(host.requestError(agent, { code: 'RATE_LIMIT' }, { step: 2 }))).resolves.toEqual({ kind: 'retry' });
    for (let i = 0; i < 4; i++) await settle(host.requestError(agent, { code: 'RATE_LIMIT' }, { step: 2 }));
    agent.model.select({ provider: 'mock', model: 'm2' });
    await expect(settle(host.requestError(agent, { code: 'RATE_LIMIT' }, { step: 2 }))).resolves.toEqual({ kind: 'retry' });
  });

  it('keeps separate counts for separate agents (e.g. a subagent session)', async () => {
    await mount();
    const parent = host.createAgent();
    const child = host.createAgent();
    for (let i = 0; i < 5; i++) await settle(host.requestError(parent, { code: 'RATE_LIMIT' }));
    await expect(settle(host.requestError(child, { code: 'RATE_LIMIT' }))).resolves.toEqual({ kind: 'retry' });
  });

  it('honors Retry-After, truncated to the 60s cap', async () => {
    await mount();
    const agent = host.createAgent();
    const pending = host.requestError(agent, { code: 'RATE_LIMIT', providerRetryAfterMs: 3_600_000 });
    let settled = false;
    pending.then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(59_999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toEqual({ kind: 'retry' });
  });

  it('hands unowned failures to the next listener', async () => {
    await mount();
    const agent = host.createAgent();
    await host.requestError(agent, { code: 'EMPTY_RESPONSE' });
    await host.requestError(agent, { code: 'CONTEXT_WINDOW_EXCEEDED' });
    expect(host.builtinRetry.calls).toEqual(['EMPTY_RESPONSE', 'CONTEXT_WINDOW_EXCEEDED']);
  });

  it('fails quota exhaustion and fatal errors directly', async () => {
    await mount();
    const agent = host.createAgent();
    await expect(host.requestError(agent, { code: 'QUOTA' })).resolves.toBeUndefined();
    await expect(host.requestError(agent, { code: 'AUTH' })).resolves.toBeUndefined();
    expect(host.builtinRetry.calls).toEqual([]);
  });

  it('ends the wait immediately when the turn signal aborts', async () => {
    await mount();
    const agent = host.createAgent();
    const pending = host.requestError(agent, { code: 'RATE_LIMIT' });
    await vi.advanceTimersByTimeAsync(100);
    agent.controller.abort(new Error('user stop'));
    await expect(pending).resolves.toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not intervene when the master switch is off', async () => {
    await mount({ enabled: false });
    const agent = host.createAgent();
    await host.requestError(agent, { code: 'RATE_LIMIT' });
    await host.requestError(agent, { code: 'QUOTA' });
    expect(host.builtinRetry.calls).toEqual(['RATE_LIMIT', 'QUOTA']);
  });

  it('passes a category whose switch is off to the builtin retry', async () => {
    await mount({ categories: { 'rate-limit': { enabled: false } } });
    const agent = host.createAgent();
    await host.requestError(agent, { code: 'RATE_LIMIT' });
    expect(host.builtinRetry.calls).toEqual(['RATE_LIMIT']);
    await expect(settle(host.requestError(agent, { code: 'SERVER' }))).resolves.toEqual({ kind: 'retry' });
  });

  it('restores the original behavior once the plugin is unloaded', async () => {
    const fiber = await mount();
    const agent = host.createAgent();
    const waiting = host.requestError(agent, { code: 'RATE_LIMIT' });
    await vi.advanceTimersByTimeAsync(100);
    await fiber.dispose();
    await expect(waiting).resolves.toBeUndefined();
    await host.requestError(agent, { code: 'RATE_LIMIT' });
    expect(host.builtinRetry.calls).toEqual(['RATE_LIMIT']);
  });
});

/** Resolve to the ms a dispatch waited before settling (fake timers, 100ms resolution). */
async function waitedMs(promise) {
  let done = false;
  promise.finally(() => { done = true; });
  let waited = 0;
  while (!done) { await vi.advanceTimersByTimeAsync(100); waited += 100; }
  await promise;
  return waited;
}

describe('retry policy overrides', () => {
  const config = {
    policy: { kind: 'fixed', initialDelayMs: 2000, jitterRatio: 0 },
    overrides: [
      { match: 'relay/*', policy: { kind: 'fixed', initialDelayMs: 30000, jitterRatio: 0, maxAttempts: 1 } },
    ],
  };

  it('waits by the override policy on a matching model', async () => {
    await mount(config);
    const agent = host.createAgent({ provider: 'relay', model: 'gpt-4o' });
    expect(await waitedMs(host.requestError(agent, { code: 'RATE_LIMIT' }))).toBe(30000);
    await expect(host.requestError(agent, { code: 'RATE_LIMIT' })).resolves.toBeUndefined(); // override allows 1 retry
  });

  it('waits by the global policy on a model no override matches', async () => {
    await mount(config);
    const agent = host.createAgent({ provider: 'deepseek', model: 'deepseek-chat' });
    expect(await waitedMs(host.requestError(agent, { code: 'RATE_LIMIT' }))).toBe(2000);
  });

  it('applies a config change to the next failure', async () => {
    const fiber = await mount(config);
    const agent = host.createAgent({ provider: 'deepseek', model: 'deepseek-chat' });
    expect(await waitedMs(host.requestError(agent, { code: 'RATE_LIMIT' }, { step: 1 }))).toBe(2000);
    await fiber.update({ ...config, overrides: [{ match: 'deepseek/*', policy: { kind: 'fixed', initialDelayMs: 9000, jitterRatio: 0 } }] });
    expect(await waitedMs(host.requestError(agent, { code: 'RATE_LIMIT' }, { step: 2 }))).toBe(9000);
  });
});

describe('package wiring', () => {
  it('exposes the Host plugin from the package root under the patch entry', async () => {
    const root = await import('../../index.js');
    expect(root.name).toBe('dsh-model-failure-retry');
    expect(typeof root.apply).toBe('function');
    const { readFileSync } = await import('node:fs');
    const patch = readFileSync(new URL('../../cordis.patch.yml', import.meta.url), 'utf8');
    const { ENTRY_ID } = await import('../../src/entry.js');
    expect(patch).toContain(`id: ${ENTRY_ID}`);
  });
});
