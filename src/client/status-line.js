/**
 * The text of the in-session status line (#7) from the `modelFailureRetry`
 * projection view. Pure, so the countdown is testable without React.
 */

/** How long after its retry time a wait still shows "retrying now". */
export const RETRY_GRACE_MS = 5000;

/**
 * @param {null | undefined | { kind: 'retry', category: string, attempt: number, maxAttempts: number, retryAt: number }
 *   | { kind: 'switch', from: { provider: string, model: string }, to: { provider: string, model: string } }} status
 * @param {{ now: number, running: boolean, t: (key: string, params?: object) => string }} options
 * @returns {null | { kind: 'retry' | 'switch', text: string, nextTickMs?: number }} null when nothing should show:
 *   no status, the session is not running (a reopened session keeps its last folded status), or the wait is long over.
 */
export function statusLine(status, { now, running, t }) {
  if (!status || !running) return null;
  if (status.kind === 'switch') {
    return { kind: 'switch', text: t('status.switched', { from: label(status.from), to: label(status.to) }) };
  }
  if (status.kind !== 'retry' || now > status.retryAt + RETRY_GRACE_MS) return null;
  const key = `category.${status.category}`;
  const name = t(key);
  const seconds = Math.ceil((status.retryAt - now) / 1000);
  const when = seconds > 0 ? t('status.in', { seconds }) : t('status.now');
  const text = t('status.retry', {
    category: name === key ? status.category : name,
    attempt: status.attempt,
    max: status.maxAttempts,
    when,
  });
  return { kind: 'retry', text, nextTickMs: 1000 };
}

const label = (ref) => `${ref.provider}/${ref.model}`;
