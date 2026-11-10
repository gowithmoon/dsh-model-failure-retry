import { describe, expect, it } from 'vitest';
import { decide, leavesModel } from '../../src/core/decide.js';
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

describe('decide with fallback chains', () => {
  const ref = (provider, model) => ({ provider, model });
  const A = ref('cheap', 'a');
  const B = ref('mid', 'b');
  const C = ref('big', 'c');
  const withChains = (chains, extra = {}) => ({ ...defaultConfig(), chains, ...extra });
  const on = (model, extra = {}) => ({ attempts: 0, model, ...extra });

  it('switches at once on quota exhaustion to the next candidate', () => {
    const config = withChains([{ match: 'cheap/*', candidates: [A, B, C] }]);
    expect(decide(failure('QUOTA'), on(A), config, opts)).toEqual({ kind: 'fallback', to: B, reason: 'quota' });
  });

  it('switches after the retries on the current model are used up', () => {
    const config = withChains([{ match: '*/*', candidates: [B] }]);
    expect(decide(failure('RATE_LIMIT'), on(A, { attempts: 4 }), config, opts)).toMatchObject({ kind: 'retry', attempt: 5 });
    expect(decide(failure('RATE_LIMIT'), on(A, { attempts: 5 }), config, opts))
      .toEqual({ kind: 'fallback', to: B, reason: 'retries-exhausted' });
  });

  it('gives up as before when no chain matches', () => {
    const config = withChains([{ match: 'other/*', candidates: [B] }]);
    expect(decide(failure('QUOTA'), on(A), config, opts)).toEqual({ kind: 'give-up', reason: 'quota' });
  });

  it('uses only the first matching chain', () => {
    const config = withChains([{ match: 'cheap/*', candidates: [B] }, { match: '*/*', candidates: [C] }]);
    expect(decide(failure('QUOTA'), on(A, { episode: { start: A, tried: [A, B] } }), config, opts))
      .toEqual({ kind: 'give-up', reason: 'chain-exhausted' });
  });

  it('continues the chain from where the episode started, skipping models already tried', () => {
    const config = withChains([{ match: '*/*', candidates: [A, B, C] }]);
    // started on B: order is C, A
    const episode = { start: B, tried: [B, C] };
    expect(decide(failure('QUOTA'), on(C, { episode }), config, opts)).toEqual({ kind: 'fallback', to: A, reason: 'quota' });
    expect(decide(failure('QUOTA'), on(A, { episode: { start: B, tried: [B, C, A] } }), config, opts))
      .toEqual({ kind: 'give-up', reason: 'chain-exhausted' });
  });

  it("retries a candidate's rate limit by the candidate's own policy, counting from zero", () => {
    const config = withChains([{ match: 'cheap/*', candidates: [B] }], {
      overrides: [{ match: 'mid/*', policy: { kind: 'fixed', initialDelayMs: 1234, jitterRatio: 0, maxAttempts: 1 } }],
    });
    const episode = { start: A, tried: [A, B] };
    expect(decide(failure('RATE_LIMIT'), on(B, { episode }), config, opts))
      .toEqual({ kind: 'retry', delayMs: 1234, attempt: 1, maxAttempts: 1 });
    expect(decide(failure('RATE_LIMIT'), on(B, { attempts: 1, episode }), config, opts))
      .toEqual({ kind: 'give-up', reason: 'chain-exhausted' });
  });

  it('skips a candidate that hits a fatal error, and moves on', () => {
    const config = withChains([{ match: 'cheap/*', candidates: [B, C] }]);
    const episode = { start: A, tried: [A, B] };
    expect(decide(failure('AUTH'), on(B, { episode }), config, opts)).toEqual({
      kind: 'skip', target: B, reason: 'fatal', then: { kind: 'fallback', to: C, reason: 'fatal' },
    });
  });

  it('skips a candidate whose context window overflows instead of passing it on', () => {
    const config = withChains([{ match: 'cheap/*', candidates: [B] }]);
    const episode = { start: A, tried: [A, B] };
    expect(decide(failure('CONTEXT_WINDOW_EXCEEDED'), on(B, { episode }), config, opts)).toEqual({
      kind: 'skip', target: B, reason: 'context-window', then: { kind: 'give-up', reason: 'chain-exhausted' },
    });
    // on the model the episode started from it still goes to compaction
    expect(decide(failure('CONTEXT_WINDOW_EXCEEDED'), on(A), config, opts)).toEqual({ kind: 'pass' });
  });

  it('still fails a fatal error on the current model without switching', () => {
    const config = withChains([{ match: '*/*', candidates: [B] }]);
    expect(decide(failure('AUTH'), on(A), config, opts)).toEqual({ kind: 'give-up', reason: 'fatal' });
  });

  it('skips candidates that no longer exist', () => {
    const config = withChains([{ match: 'cheap/*', candidates: [B, C] }]);
    const isAvailable = (r) => r.provider !== 'mid';
    expect(decide(failure('QUOTA'), on(A), config, { ...opts, isAvailable })).toEqual({
      kind: 'skip', target: B, reason: 'missing-model', then: { kind: 'fallback', to: C, reason: 'quota' },
    });
    expect(decide(failure('QUOTA'), on(A), config, { ...opts, isAvailable: () => false })).toEqual({
      kind: 'skip', target: B, reason: 'missing-model', then: {
        kind: 'skip', target: C, reason: 'missing-model', then: { kind: 'give-up', reason: 'chain-exhausted' },
      },
    });
  });

  it('does not switch when the plugin is off', () => {
    const config = withChains([{ match: '*/*', candidates: [B] }], { enabled: false });
    expect(decide(failure('QUOTA'), on(A), config, opts)).toEqual({ kind: 'pass' });
  });
});

describe('leavesModel (S8)', () => {
  it('is true for fallback, skip and a chain that ran out, false otherwise', () => {
    expect(leavesModel({ kind: 'fallback' })).toBe(true);
    expect(leavesModel({ kind: 'skip' })).toBe(true);
    expect(leavesModel({ kind: 'give-up', reason: 'chain-exhausted' })).toBe(true);
    expect(leavesModel({ kind: 'give-up', reason: 'fatal' })).toBe(false);
    expect(leavesModel({ kind: 'retry' })).toBe(false);
    expect(leavesModel({ kind: 'pass' })).toBe(false);
  });
});
