import { describe, expect, it } from 'vitest';
import { DEFAULT_POLICY } from '../../src/core/policy.js';
import { timeline } from '../../src/client/timeline.js';

describe('timeline', () => {
  it('places each retry at its cumulative time after T0 under the default policy', () => {
    const t = timeline(DEFAULT_POLICY);
    expect(t.retries.map((r) => [r.attempt, r.delayMs, r.atMs])).toEqual([
      [1, 5000, 5000],
      [2, 10000, 15000],
      [3, 20000, 35000],
      [4, 40000, 75000],
      [5, 60000, 135000],
    ]);
    expect(t.endMs).toBe(135000);
  });

  it('shows jitter as a window that widens with the accumulated waits', () => {
    const [first, second] = timeline(DEFAULT_POLICY).retries;
    expect([first.minAtMs, first.maxAtMs]).toEqual([4500, 5500]);
    expect([second.minAtMs, second.maxAtMs]).toEqual([13500, 16500]);
    // 4.5+9+18+36+54 s and 5.5+11+22+44+60 s (the last wait cannot exceed the 60s cap)
    expect([timeline(DEFAULT_POLICY).endMinMs, timeline(DEFAULT_POLICY).endMaxMs]).toEqual([121500, 142500]);
  });

  it('ends right at T0 when no retry is allowed', () => {
    expect(timeline({ ...DEFAULT_POLICY, maxAttempts: 0 })).toEqual({ retries: [], endMs: 0, endMinMs: 0, endMaxMs: 0 });
  });

  it('follows a custom sequence', () => {
    const t = timeline({ ...DEFAULT_POLICY, kind: 'custom', sequenceMs: [5000, 10000, 30000, 60000], maxAttempts: 4, jitterRatio: 0 });
    expect(t.retries.map((r) => r.atMs)).toEqual([5000, 15000, 45000, 105000]);
    expect([t.endMinMs, t.endMs, t.endMaxMs]).toEqual([105000, 105000, 105000]);
  });
});
