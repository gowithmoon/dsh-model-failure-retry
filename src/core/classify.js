/**
 * Map an LLM failure to a failure category.
 *
 * Built-in mapping goes by DSH error code. Codes not listed here (EMPTY_RESPONSE,
 * CONTEXT_WINDOW_EXCEEDED, IMAGE_OFFLOAD_REQUIRED, ...) are not owned by the
 * plugin and yield `category: undefined`, so other listeners keep handling them.
 *
 * Extension point (#5): `rules` will hold user/default classification rules
 * (status + keyword/regex → category), evaluated in order before the code map;
 * the first hit wins and is reported as `rule`.
 *
 * @param {{ code: string, message?: string, status?: number }} failure
 * @param {readonly unknown[]} [rules]
 * @returns {{ category: import('./types.js').Category | undefined, rule?: unknown }}
 */
export function classify(failure, rules = []) {
  void rules;
  return { category: CODE_CATEGORY[failure.code] };
}

/** @type {Readonly<Record<string, import('./types.js').Category>>} */
const CODE_CATEGORY = Object.freeze({
  RATE_LIMIT: 'rate-limit',
  SERVER: 'transient',
  TIMEOUT: 'transient',
  TRANSPORT: 'transient',
  QUOTA: 'quota',
  ACCOUNT_QUOTA: 'quota',
  AUTH: 'fatal',
  INVALID_REQUEST: 'fatal',
  INVALID_CREDENTIAL: 'fatal',
});
