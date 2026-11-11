/**
 * Failure categories (see GLOSSARY.md "失败分类").
 * `rate-limit` and `transient` are retried; `quota` and `fatal` are owned by
 * the plugin but not retried yet (fallback chains arrive in #6).
 */
export const CATEGORIES = Object.freeze(['rate-limit', 'transient', 'quota', 'fatal']);

/** Categories whose retry behaviour the user can switch on/off. */
export const RETRYABLE_CATEGORIES = Object.freeze(['rate-limit', 'transient']);
