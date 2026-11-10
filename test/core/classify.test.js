import { describe, expect, it } from 'vitest';
import { classify } from '../../src/core/classify.js';

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

  it.each(['EMPTY_RESPONSE', 'CONTEXT_WINDOW_EXCEEDED', 'IMAGE_OFFLOAD_REQUIRED', 'ABORTED', 'PI_AI_ERROR', 'SOMETHING_NEW'])(
    '%s is not a category the plugin owns',
    (code) => {
      expect(classify(failure(code)).category).toBeUndefined();
    },
  );
});
