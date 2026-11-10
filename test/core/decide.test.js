import { describe, expect, it } from 'vitest';
import { decide } from '../../src/core/decide.js';
import { defaultConfig } from '../../src/core/config.js';

const failure = (code, extra = {}) => ({ message: code, code, ...extra });
const fresh = { attempts: 0 };
const opts = { random: () => 0.5 };

describe('decide', () => {
  it('retries a rate limit with the first scheduled wait', () => {
    expect(decide(failure('RATE_LIMIT'), fresh, defaultConfig(), opts)).toEqual({
      kind: 'retry',
      delayMs: 5000,
      attempt: 1,
      maxAttempts: 5,
    });
  });

  it('retries a transient failure, counting from the request state', () => {
    expect(decide(failure('SERVER'), { attempts: 2 }, defaultConfig(), opts)).toMatchObject({
      kind: 'retry',
      delayMs: 20000,
      attempt: 3,
    });
  });

  it('uses Retry-After for the wait', () => {
    expect(decide(failure('RATE_LIMIT', { providerRetryAfterMs: 7000 }), fresh, defaultConfig(), opts)).toMatchObject({
      kind: 'retry',
      delayMs: 7000,
    });
  });

  it('gives up after the 5th retry', () => {
    expect(decide(failure('RATE_LIMIT'), { attempts: 4 }, defaultConfig(), opts)).toMatchObject({ attempt: 5 });
    expect(decide(failure('RATE_LIMIT'), { attempts: 5 }, defaultConfig(), opts)).toEqual({
      kind: 'give-up',
      reason: 'retries-exhausted',
    });
  });

  it('passes a category whose retry switch is off', () => {
    const config = defaultConfig();
    config.categories['rate-limit'].enabled = false;
    expect(decide(failure('RATE_LIMIT'), fresh, config, opts)).toEqual({ kind: 'pass' });
    expect(decide(failure('TIMEOUT'), fresh, config, opts)).toMatchObject({ kind: 'retry' });
  });

  it('passes everything when the master switch is off', () => {
    const config = { ...defaultConfig(), enabled: false };
    expect(decide(failure('RATE_LIMIT'), fresh, config, opts)).toEqual({ kind: 'pass' });
    expect(decide(failure('QUOTA'), fresh, config, opts)).toEqual({ kind: 'pass' });
  });

  it('passes failures the plugin does not own', () => {
    expect(decide(failure('EMPTY_RESPONSE'), fresh, defaultConfig(), opts)).toEqual({ kind: 'pass' });
    expect(decide(failure('CONTEXT_WINDOW_EXCEEDED'), fresh, defaultConfig(), opts)).toEqual({ kind: 'pass' });
  });

  it('fails quota exhaustion and fatal errors directly for now', () => {
    expect(decide(failure('QUOTA'), fresh, defaultConfig(), opts)).toEqual({ kind: 'give-up', reason: 'quota' });
    expect(decide(failure('AUTH'), fresh, defaultConfig(), opts)).toEqual({ kind: 'give-up', reason: 'fatal' });
  });
});

describe('decide with classification rules', () => {
  it('does not retry a 429 that the default rules classify as quota', () => {
    expect(decide(failure('RATE_LIMIT', { status: 429, message: 'daily limit reached' }), fresh, defaultConfig(), opts))
      .toEqual({ kind: 'give-up', reason: 'quota' });
  });

  it('applies user rules from config.rules', () => {
    const config = { ...defaultConfig(), rules: [{ code: 'PI_AI_ERROR', pattern: 'overloaded', category: 'transient' }] };
    expect(decide(failure('PI_AI_ERROR', { message: 'upstream overloaded' }), fresh, config, opts)).toMatchObject({ kind: 'retry' });
  });

  it('passes a context-window overflow found by a rule on to compaction', () => {
    const f = failure('INVALID_REQUEST', { status: 400, message: 'maximum context length is 8192 tokens' });
    expect(decide(f, fresh, defaultConfig(), opts)).toEqual({ kind: 'pass' });
  });
});
