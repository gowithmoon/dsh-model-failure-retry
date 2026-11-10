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
