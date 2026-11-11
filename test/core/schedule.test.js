import { describe, expect, it } from 'vitest';
import { DEFAULT_POLICY } from '../../src/core/policy.js';
import { nextDelay, retrySchedule } from '../../src/core/schedule.js';

const noJitter = () => 0.5; // random() = 0.5 → jitter factor exactly 1

describe('retrySchedule under the default policy', () => {
  it('is 5s exponential ×2 capped at 60s, five retries', () => {
    expect(retrySchedule(DEFAULT_POLICY).map((s) => s.delayMs)).toEqual([5000, 10000, 20000, 40000, 60000]);
  });

  it('reports the ±10% jitter window of each wait, never above the cap', () => {
    const [first, , , , last] = retrySchedule(DEFAULT_POLICY);
    expect(first).toEqual({ attempt: 1, delayMs: 5000, minMs: 4500, maxMs: 5500 });
    expect(last).toEqual({ attempt: 5, delayMs: 60000, minMs: 54000, maxMs: 60000 });
  });
});

describe('nextDelay', () => {
  it('follows the schedule for the given attempt', () => {
    expect(nextDelay(DEFAULT_POLICY, 3, { random: noJitter })).toBe(20000);
  });

  it('applies jitter within ±10%', () => {
    expect(nextDelay(DEFAULT_POLICY, 1, { random: () => 0 })).toBe(4500);
    expect(nextDelay(DEFAULT_POLICY, 1, { random: () => 0.999999 })).toBeCloseTo(5500, 0);
    for (let i = 0; i < 200; i++) {
      const d = nextDelay(DEFAULT_POLICY, 2, {});
      expect(d).toBeGreaterThanOrEqual(9000);
      expect(d).toBeLessThanOrEqual(11000);
    }
  });

  it('never exceeds the single-wait cap even with jitter', () => {
    expect(nextDelay(DEFAULT_POLICY, 5, { random: () => 0.999 })).toBe(60000);
  });

  it('adopts Retry-After as is, without jitter', () => {
    expect(nextDelay(DEFAULT_POLICY, 1, { retryAfterMs: 12000, random: () => 0 })).toBe(12000);
  });

  it('truncates a Retry-After longer than the cap instead of giving up', () => {
    expect(nextDelay(DEFAULT_POLICY, 1, { retryAfterMs: 3_600_000 })).toBe(60000);
  });

  it('ignores Retry-After when the policy does not honor it, or it is not a positive number', () => {
    const policy = { ...DEFAULT_POLICY, honorRetryAfter: false };
    expect(nextDelay(policy, 1, { retryAfterMs: 12000, random: noJitter })).toBe(5000);
    expect(nextDelay(DEFAULT_POLICY, 1, { retryAfterMs: 0, random: noJitter })).toBe(5000);
    expect(nextDelay(DEFAULT_POLICY, 1, { retryAfterMs: Number.NaN, random: noJitter })).toBe(5000);
  });
});

const policyOf = (overrides) => ({ ...DEFAULT_POLICY, jitterRatio: 0, ...overrides });
const delays = (policy) => retrySchedule(policy).map((s) => s.delayMs);

describe('growth kinds', () => {
  it('fixed waits the first delay every time', () => {
    expect(delays(policyOf({ kind: 'fixed', initialDelayMs: 3000, maxAttempts: 4 }))).toEqual([3000, 3000, 3000, 3000]);
  });

  it('linear adds the first delay each time', () => {
    expect(delays(policyOf({ kind: 'linear', initialDelayMs: 5000, maxAttempts: 4 }))).toEqual([5000, 10000, 15000, 20000]);
  });

  it('exponential multiplies by the multiplier', () => {
    expect(delays(policyOf({ kind: 'exponential', initialDelayMs: 1000, multiplier: 3, maxAttempts: 4 }))).toEqual([1000, 3000, 9000, 27000]);
  });

  it('caps every kind at the single-wait maximum', () => {
    expect(delays(policyOf({ kind: 'linear', initialDelayMs: 20000, maxDelayMs: 50000, maxAttempts: 4 }))).toEqual([20000, 40000, 50000, 50000]);
    expect(delays(policyOf({ kind: 'fixed', initialDelayMs: 90000, maxDelayMs: 60000, maxAttempts: 2 }))).toEqual([60000, 60000]);
  });
});

describe('custom sequence', () => {
  const custom = (sequenceMs, maxAttempts) => policyOf({ kind: 'custom', sequenceMs, maxAttempts });

  it('uses the sequence as written', () => {
    expect(delays(custom([5000, 10000, 30000, 60000], 4))).toEqual([5000, 10000, 30000, 60000]);
  });

  it('repeats the last delay when shorter than the max attempts', () => {
    expect(delays(custom([5000, 10000], 4))).toEqual([5000, 10000, 10000, 10000]);
  });

  it('stops at the max attempts when longer', () => {
    expect(delays(custom([1000, 2000, 3000, 4000], 2))).toEqual([1000, 2000]);
  });

  it('is still capped at the single-wait maximum', () => {
    expect(delays({ ...custom([5000, 120000], 2), maxDelayMs: 60000 })).toEqual([5000, 60000]);
  });

  it('falls back to the first delay when the sequence is empty', () => {
    expect(delays({ ...custom([], 2), initialDelayMs: 7000 })).toEqual([7000, 7000]);
  });

  it('drives the runtime wait too', () => {
    expect(nextDelay(custom([5000, 10000], 4), 3, { random: noJitter })).toBe(10000);
  });
});

describe('jitter boundaries', () => {
  it('no jitter gives a zero-width window and an exact wait', () => {
    const policy = policyOf({ jitterRatio: 0 });
    expect(retrySchedule(policy)[0]).toEqual({ attempt: 1, delayMs: 5000, minMs: 5000, maxMs: 5000 });
    expect(nextDelay(policy, 1, { random: () => 0 })).toBe(5000);
    expect(nextDelay(policy, 1, { random: () => 0.999 })).toBe(5000);
  });

  it('100% jitter spans from zero to double, still capped', () => {
    const policy = policyOf({ jitterRatio: 1 });
    expect(retrySchedule(policy)[0]).toEqual({ attempt: 1, delayMs: 5000, minMs: 0, maxMs: 10000 });
    expect(nextDelay(policy, 1, { random: () => 0 })).toBe(0);
    expect(nextDelay(policy, 5, { random: () => 0.999 })).toBe(60000);
  });
});
