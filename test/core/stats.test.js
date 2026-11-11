import { describe, expect, it } from 'vitest';
import { recordOf, queryStats, isExpired } from '../../src/core/stats.js';

const A = { provider: 'mock', model: 'a' };
const B = { provider: 'mock', model: 'b' };
const at = { time: 1000, sessionId: 's1', subagent: false };
const RL = { code: 'RATE_LIMIT', message: '429 Too Many Requests' };

describe('recordOf: one stored record per plugin decision', () => {
  it('retry keeps attempt, delay, category, status and error summary', () => {
    const r = recordOf({ model: A, failure: RL, decision: { kind: 'retry', delayMs: 5000, attempt: 2, maxAttempts: 5 } }, at);
    expect(r).toEqual({
      time: 1000, sessionId: 's1', subagent: false, kind: 'retry', provider: 'mock', model: 'a',
      category: 'rate-limit', status: 429, code: 'RATE_LIMIT', error: '429 Too Many Requests',
      attempt: 2, maxAttempts: 5, delayMs: 5000,
    });
  });

  it('fallback records from and to models', () => {
    const r = recordOf({ model: A, failure: { code: 'QUOTA', message: 'daily limit' }, decision: { kind: 'fallback', to: B, reason: 'quota', selection: { ...B, reasoningEffort: 'high' } } }, at);
    expect(r).toMatchObject({ kind: 'fallback', provider: 'mock', model: 'a', category: 'quota', reason: 'quota', from: 'mock/a', to: 'mock/b' });
  });

  it('skip records the skipped model and why', () => {
    for (const reason of ['fatal', 'context-window', 'missing-model']) {
      const r = recordOf({ model: A, failure: { code: 'QUOTA' }, decision: { kind: 'skip', target: B, reason } }, at);
      expect(r).toMatchObject({ kind: 'skip', provider: 'mock', model: 'b', reason });
    }
  });

  it('give-up is a final failure', () => {
    const r = recordOf({ model: A, failure: { code: 'AUTH', message: '401 bad key' }, decision: { kind: 'give-up', reason: 'fatal' } }, at);
    expect(r).toMatchObject({ kind: 'failure', reason: 'fatal', category: 'fatal', status: 401 });
  });

  it('switch-back (#9) has no failure', () => {
    const r = recordOf({ model: B, decision: { kind: 'switch-back', from: B, to: A } }, at);
    expect(r).toEqual({ time: 1000, sessionId: 's1', subagent: false, kind: 'switch-back', provider: 'mock', model: 'b', from: 'mock/b', to: 'mock/a' });
  });

  it('pass and origin-reset are not recorded', () => {
    expect(recordOf({ model: A, failure: { code: 'UNKNOWN' }, decision: { kind: 'pass' } }, at)).toBeUndefined();
    expect(recordOf({ model: A, decision: { kind: 'origin-reset' } }, at)).toBeUndefined();
  });

  it('truncates long error messages', () => {
    const r = recordOf({ model: A, failure: { code: 'SERVER', message: 'x'.repeat(1000) }, decision: { kind: 'retry', delayMs: 1, attempt: 1, maxAttempts: 1 } }, at);
    expect(r.error.length).toBeLessThanOrEqual(300);
  });
});

describe('isExpired', () => {
  it('purges records older than the retention', () => {
    const day = 86_400_000;
    expect(isExpired({ time: 0 }, 30 * day + 1, 30)).toBe(true);
    expect(isExpired({ time: 0 }, 30 * day - 1, 30)).toBe(false);
  });
});

describe('queryStats', () => {
  const H = 3_600_000;
  const rec = (time, kind, extra = {}) => ({ time, kind, sessionId: 's1', subagent: false, provider: 'mock', model: 'a', ...extra });
  const records = [
    rec(0, 'retry', { category: 'rate-limit' }),
    rec(10, 'retry', { category: 'rate-limit' }),
    rec(20, 'rescued'),
    rec(2 * H, 'fallback', { category: 'quota', sessionId: 's2', from: 'mock/a', to: 'mock/b' }),
    rec(2 * H + 5, 'failure', { category: 'quota', sessionId: 's2', model: 'b' }),
    rec(3 * H, 'stop', { sessionId: 's3' }),
  ];

  it('summarises and buckets all records by hour, newest event first', () => {
    const q = queryStats(records, { bucket: 'hour' });
    expect(q.summary).toMatchObject({ retries: 2, fallbacks: 1, rescued: 1, failures: 1, stops: 1, skips: 0, switchBacks: 0 });
    expect(q.buckets.map((b) => b.start)).toEqual([0, H, 2 * H, 3 * H]);
    expect(q.buckets[0]).toMatchObject({ retries: 2, rescued: 1 });
    expect(q.buckets[1]).toMatchObject({ retries: 0, fallbacks: 0 });
    expect(q.buckets[2]).toMatchObject({ fallbacks: 1, failures: 1 });
    expect(q.total).toBe(6);
    expect(q.events[0].kind).toBe('stop');
    expect(q.facets.sessions.sort()).toEqual(['s1', 's2', 's3']);
    expect(q.facets.models.sort()).toEqual(['mock/a', 'mock/b']);
  });

  it('filters by session, model, category and time range', () => {
    expect(queryStats(records, { sessionId: 's2' }).total).toBe(2);
    expect(queryStats(records, { model: 'mock/b' }).total).toBe(1);
    expect(queryStats(records, { category: 'rate-limit' }).summary.retries).toBe(2);
    expect(queryStats(records, { from: 2 * H, to: 3 * H }).total).toBe(2);
    // facets ignore the filter so the dropdowns keep their options
    expect(queryStats(records, { sessionId: 's2' }).facets.sessions).toHaveLength(3);
  });

  it('buckets by local day with a timezone offset', () => {
    const D = 24 * H;
    const q = queryStats([rec(D - H, 'retry'), rec(D + H, 'retry')], { bucket: 'day', tzOffsetMin: -120 });
    // UTC+2: 23:00Z on day 0 is already day 1 locally, so both fall into one bucket
    expect(q.buckets).toHaveLength(1);
    expect(q.buckets[0]).toMatchObject({ start: D - 2 * H, retries: 2 });
  });

  it('pages the event list', () => {
    const q = queryStats(records, { page: 2, pageSize: 4 });
    expect(q.events).toHaveLength(2);
    expect(q.events.map((e) => e.time)).toEqual([10, 0]);
    expect(q).toMatchObject({ page: 2, pageSize: 4, total: 6 });
  });
});
