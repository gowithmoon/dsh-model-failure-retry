import { describe, expect, it } from 'vitest';
import { en, zh } from '../../src/client/locales.js';
import { statusLine } from '../../src/client/status-line.js';

const tOf = (dict) => (key, params = {}) => (dict[key] ?? key).replace(/\{(\w+)\}/g, (_, k) => String(params[k]));
const retry = { kind: 'retry', category: 'rate-limit', attempt: 2, maxAttempts: 5, retryAt: 100_000 };
const sw = { kind: 'switch', from: { provider: 'deepseek', model: 'deepseek-chat' }, to: { provider: 'zhipu', model: 'glm-4.6' } };

describe('status line', () => {
  it('counts down to the retry in Chinese and English', () => {
    expect(statusLine(retry, { now: 88_000, running: true, t: tOf(zh) })).toEqual({
      kind: 'retry', text: '限流 · 第 2/5 次重试 · 12 秒后', nextTickMs: 1000,
    });
    expect(statusLine(retry, { now: 88_400, running: true, t: tOf(en) }).text).toBe('Rate limit · retry 2/5 · in 12 s');
  });

  it('says the switch from one model to the other', () => {
    expect(statusLine(sw, { now: 0, running: true, t: tOf(zh) }).text).toBe('已从 deepseek/deepseek-chat 切换到 zhipu/glm-4.6');
    expect(statusLine(sw, { now: 0, running: true, t: tOf(en) }).text).toBe('Switched from deepseek/deepseek-chat to zhipu/glm-4.6');
  });

  it('shows "retrying now" at zero, and nothing once the retry time is long past', () => {
    expect(statusLine(retry, { now: 100_000, running: true, t: tOf(en) }).text).toBe('Rate limit · retry 2/5 · retrying now');
    expect(statusLine(retry, { now: 106_000, running: true, t: tOf(en) })).toBeNull();
  });

  it('shows nothing while the session is not running (a reopened session) or without a status', () => {
    expect(statusLine(retry, { now: 88_000, running: false, t: tOf(en) })).toBeNull();
    expect(statusLine(sw, { now: 0, running: false, t: tOf(en) })).toBeNull();
    expect(statusLine(null, { now: 0, running: true, t: tOf(en) })).toBeNull();
    expect(statusLine(undefined, { now: 0, running: true, t: tOf(en) })).toBeNull();
  });

  it('falls back to the raw category name for a category without copy', () => {
    expect(statusLine({ ...retry, category: 'custom' }, { now: 88_000, running: true, t: tOf(en) }).text).toBe('custom · retry 2/5 · in 12 s');
  });
});
