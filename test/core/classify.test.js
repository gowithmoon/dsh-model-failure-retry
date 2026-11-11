import { describe, expect, it } from 'vitest';
import { builtinCategory, classify } from '../../src/core/classify.js';

const failure = (code, extra = {}) => ({ message: `${code} failure`, code, ...extra });

describe('classify by DSH error code', () => {
  it.each([
    ['RATE_LIMIT', 'rate-limit'],
    ['SERVER', 'transient'],
    ['TIMEOUT', 'transient'],
    ['TRANSPORT', 'transient'],
    ['QUOTA', 'quota'],
    ['ACCOUNT_QUOTA', 'quota'],
    ['AUTH', 'fatal'],
    ['INVALID_REQUEST', 'fatal'],
    ['INVALID_CREDENTIAL', 'fatal'],
  ])('%s → %s', (code, category) => {
    expect(classify(failure(code)).category).toBe(category);
  });

  it.each(['EMPTY_RESPONSE', 'IMAGE_OFFLOAD_REQUIRED', 'ABORTED', 'PI_AI_ERROR', 'SOMETHING_NEW'])(
    '%s is not a category the plugin owns',
    (code) => {
      expect(classify(failure(code)).category).toBeUndefined();
    },
  );

  it('CONTEXT_WINDOW_EXCEEDED is fatal with its own reason', () => {
    expect(classify(failure('CONTEXT_WINDOW_EXCEEDED'))).toEqual({ category: 'fatal', reason: 'context-window' });
  });
});

describe('builtinCategory', () => {
  it('gives the built-in category of a code, context-window for CONTEXT_WINDOW_EXCEEDED', () => {
    expect(builtinCategory('RATE_LIMIT')).toBe('rate-limit');
    expect(builtinCategory('INVALID_REQUEST')).toBe('fatal');
    expect(builtinCategory('ACCOUNT_QUOTA')).toBe('quota');
    expect(builtinCategory('CONTEXT_WINDOW_EXCEEDED')).toBe('context-window');
    expect(builtinCategory('EMPTY_RESPONSE')).toBeUndefined();
    expect(builtinCategory('toString')).toBeUndefined();
    expect(builtinCategory(undefined)).toBeUndefined();
  });
});
