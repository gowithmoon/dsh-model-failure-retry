import { describe, expect, it } from 'vitest';
import { classify } from '../../src/core/classify.js';
import { DEFAULT_RULES, ruleError } from '../../src/core/rules.js';

const rateLimit = (message, extra = {}) => ({ code: 'RATE_LIMIT', status: 429, message, ...extra });

describe('default classification rules', () => {
  it.each([
    'Daily limit reached for this model',
    'You have exceeded 1000 requests per day',
    'weekly token limit exhausted',
    'Monthly quota used up',
    'Your plan does not allow more requests',
    'package capacity reached',
    'Requests limit reached, please upgrade your package',
    '今日套餐用量已达上限',
    '您的额度已用完',
    '账户余额不足',
    'insufficient balance',
    'hourly token limit reached',
  ])('429 + "%s" → quota', (message) => {
    expect(classify(rateLimit(message), DEFAULT_RULES).category).toBe('quota');
  });

  it.each([
    'Rate limit reached for requests',
    'Too Many Requests',
    'Limit 40 requests per min',
    'Please see the explanation in the docs', // "plan" only as part of a word
  ])('429 + "%s" stays a rate limit', (message) => {
    const result = classify(rateLimit(message), DEFAULT_RULES);
    expect(result.category).toBe('rate-limit');
    expect(result.rule).toBeUndefined();
  });

  it('does not reclassify a non-429 failure that mentions a daily limit', () => {
    expect(classify({ code: 'SERVER', status: 503, message: 'daily maintenance' }, DEFAULT_RULES).category).toBe('transient');
  });

  it('reads the status from the message when the adapter gave none (pi-ai style)', () => {
    expect(classify({ code: 'RATE_LIMIT', message: '429 You reached your daily limit' }, DEFAULT_RULES).category).toBe('quota');
  });

  it('reports which rule matched', () => {
    const result = classify(rateLimit('daily limit'), DEFAULT_RULES);
    expect(result.rule).toBe(DEFAULT_RULES[0]);
    expect(result.ruleIndex).toBe(0);
  });
});

describe('context-window default rule', () => {
  it('classifies overflow wording as fatal with the context-window reason', () => {
    const result = classify({ code: 'INVALID_REQUEST', status: 400, message: "This model's maximum context length is 65536 tokens" }, DEFAULT_RULES);
    expect(result).toMatchObject({ category: 'fatal', reason: 'context-window', ruleIndex: 1 });
  });

  it('leaves a per-minute token rate limit alone', () => {
    expect(classify(rateLimit('Rate limit: too many tokens per minute'), DEFAULT_RULES).category).toBe('rate-limit');
  });
});

describe('user classification rules', () => {
  it('a user rule placed before the defaults wins', () => {
    const rules = [{ status: 429, pattern: 'daily', category: 'rate-limit' }, ...DEFAULT_RULES];
    expect(classify(rateLimit('daily limit reached'), rules)).toMatchObject({ category: 'rate-limit', ruleIndex: 0 });
  });

  it('a rule needs both its status and its keywords to match', () => {
    const rules = [{ status: 503, pattern: 'balance', category: 'quota' }];
    expect(classify({ code: 'SERVER', status: 503, message: 'insufficient balance' }, rules).category).toBe('quota');
    expect(classify({ code: 'SERVER', status: 502, message: 'insufficient balance' }, rules).category).toBe('transient');
    expect(classify({ code: 'SERVER', status: 503, message: 'overloaded' }, rules).category).toBe('transient');
  });

  it('keywords are comma separated, any one matches, case-insensitive', () => {
    const rules = [{ pattern: 'foo, BAR，baz', category: 'fatal' }];
    expect(classify({ code: 'SERVER', message: 'got bar back' }, rules).category).toBe('fatal');
    expect(classify({ code: 'SERVER', message: 'got Baz back' }, rules).category).toBe('fatal');
    expect(classify({ code: 'SERVER', message: 'nothing' }, rules).category).toBe('transient');
  });

  it('keywords are literal, not regex', () => {
    const rules = [{ pattern: 'a.b', category: 'fatal' }];
    expect(classify({ code: 'SERVER', message: 'axb' }, rules).category).toBe('transient');
    expect(classify({ code: 'SERVER', message: 'a.b' }, rules).category).toBe('fatal');
  });

  it('a rule can match on the DSH error code', () => {
    const rules = [{ code: 'PI_AI_ERROR', pattern: 'overloaded', category: 'transient' }];
    expect(classify({ code: 'PI_AI_ERROR', message: 'Overloaded' }, rules)).toMatchObject({ category: 'transient', ruleIndex: 0 });
    expect(classify({ code: 'UNKNOWN', message: 'Overloaded' }, rules).category).toBeUndefined();
  });

  it('a rule with only a status matches any message with that status', () => {
    expect(classify({ code: 'HTTP_418', status: 418, message: 'teapot' }, [{ status: 418, category: 'fatal' }]).category).toBe('fatal');
  });

  it('an invalid regex is skipped at runtime and later rules still apply', () => {
    const rules = [{ pattern: '(daily', regex: true, category: 'fatal' }, { pattern: 'daily', category: 'quota' }];
    expect(classify(rateLimit('daily limit'), rules)).toMatchObject({ category: 'quota', ruleIndex: 1 });
    expect(ruleError(rules[0])).toBe('invalid-regex');
    expect(ruleError(rules[1])).toBeUndefined();
  });

  it('ignores a rule with an unknown target category', () => {
    expect(classify(rateLimit('x'), [{ pattern: 'x', category: 'nonsense' }]).category).toBe('rate-limit');
  });

  it('falls back to the error-code mapping when no rule matches', () => {
    const rules = [{ status: 500, pattern: 'never', category: 'fatal' }];
    expect(classify({ code: 'TIMEOUT', message: 'timed out' }, rules)).toEqual({ category: 'transient' });
    expect(classify({ code: 'AUTH', status: 401, message: 'bad key' }, rules)).toEqual({ category: 'fatal' });
  });
});
