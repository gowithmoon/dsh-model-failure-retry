import { describe, expect, it } from 'vitest';
import { switchBackDue } from '../../src/core/switch-back.js';

const A = { provider: 'p', model: 'a' };
const B = { provider: 'p', model: 'b' };
const MIN = 60_000;
const on = { enabled: true, intervalMs: 10 * MIN };

describe('switchBackDue', () => {
  it('is due once the interval since the origin last failed has passed', () => {
    expect(switchBackDue({ settings: on, origin: A, current: B, lastFailureAt: 0, now: 10 * MIN })).toBe(true);
    expect(switchBackDue({ settings: on, origin: A, current: B, lastFailureAt: 0, now: 10 * MIN - 1 })).toBe(false);
  });

  it('is never due when switched off', () => {
    expect(switchBackDue({ settings: { ...on, enabled: false }, origin: A, current: B, lastFailureAt: 0, now: 99 * MIN })).toBe(false);
  });

  it('is not due without a switch, or when already on the origin', () => {
    expect(switchBackDue({ settings: on, origin: undefined, current: B, lastFailureAt: 0, now: 99 * MIN })).toBe(false);
    expect(switchBackDue({ settings: on, origin: { ...A, reasoningEffort: 'high' }, current: A, lastFailureAt: 0, now: 99 * MIN })).toBe(false);
  });

  it('is not due when no failure of the origin was recorded', () => {
    expect(switchBackDue({ settings: on, origin: A, current: B, lastFailureAt: undefined, now: 99 * MIN })).toBe(false);
  });

  it('an interval of 0 switches back on the next turn', () => {
    expect(switchBackDue({ settings: { enabled: true, intervalMs: 0 }, origin: A, current: B, lastFailureAt: 5, now: 5 })).toBe(true);
  });
});
