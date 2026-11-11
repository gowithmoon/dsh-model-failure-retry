/**
 * The in-session status line (#7), as a session projection folded from
 * events the session log already carries — no new event types:
 *
 * - `llm/retry` with our policy key prefix: waiting to retry. The adapter
 *   appends it before each wait, like dsh-llm-retry does, so DSH's own chat
 *   retry row and this status line read the same record.
 * - `llm/retry-started` (same retry id), `step/start`, `turn/end`: the wait
 *   is over; clear it.
 * - `user/message` whose source is our `model-fallback` follow-up: switched
 *   from → to; shown until that turn ends.
 *
 * The view is `null` when there is nothing to show. A session reopened after
 * a crash mid-wait still folds to the last wait; the client hides it once
 * its retry time has passed or the session is not running.
 */

import { randomUUID } from 'node:crypto';

import { STATUS_PROJECTION } from '../status-projection-key.js';

export { STATUS_PROJECTION };
/** `llm/retry` policy keys the adapter writes: `${POLICY_KEY_PREFIX}${category}`. */
export const POLICY_KEY_PREFIX = 'model-failure-retry:';
export const FALLBACK_SOURCE_KIND = 'model-fallback';

const isRecord = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const isRef = (v) => isRecord(v) && typeof v.provider === 'string' && typeof v.model === 'string';
const ref = ({ provider, model }) => ({ provider, model });
const isCount = (v) => Number.isSafeInteger(v) && v >= 0;

/** Validate one state (or view) value: null, a retry wait, or a switch. */
function parseStatus(value) {
  if (value === null) return null;
  if (isRecord(value) && value.kind === 'retry'
    && typeof value.category === 'string' && isCount(value.attempt) && isCount(value.maxAttempts)
    && Number.isFinite(value.retryAt)) return value;
  if (isRecord(value) && value.kind === 'switch' && isRef(value.from) && isRef(value.to)) return value;
  throw new Error(`invalid ${STATUS_PROJECTION} status: ${JSON.stringify(value)}`);
}
const schema = { parse: parseStatus };

/** Fold one committed session event. Pure; returns the same state when unchanged. */
export function applyStatus(state, event) {
  const { type, data } = event;
  if (type === 'llm/retry') {
    if (!isRecord(data) || typeof data.policyKey !== 'string' || !data.policyKey.startsWith(POLICY_KEY_PREFIX)) return state;
    return {
      kind: 'retry',
      retryId: String(data.retryId),
      category: data.policyKey.slice(POLICY_KEY_PREFIX.length),
      attempt: data.retry,
      maxAttempts: data.maxRetries,
      retryAt: event.time + data.delayMs,
    };
  }
  if (type === 'llm/retry-started') {
    return state?.kind === 'retry' && state.retryId === data?.retryId ? null : state;
  }
  if (type === 'step/start') return state?.kind === 'retry' ? null : state;
  if (type === 'turn/end') return state === null ? state : null;
  if (type === 'user/message') {
    const source = data?.source;
    if (source?.kind !== FALLBACK_SOURCE_KIND || !isRef(source.from) || !isRef(source.to)) return state;
    return { kind: 'switch', from: ref(source.from), to: ref(source.to) };
  }
  return state;
}

/** The client-visible value: the state without the internal retry id. */
function view(state) {
  if (state?.kind !== 'retry') return state;
  const { retryId: _id, ...rest } = state;
  return rest;
}

export const statusProjection = Object.freeze({
  key: STATUS_PROJECTION,
  stateVersion: 1,
  stateSchema: schema,
  init: () => null,
  apply: applyStatus,
  wire: { viewSchema: schema, view },
});

/** Register the projection when `sessionProjections` is present (optional service). */
export function installStatusProjection(ctx) {
  ctx.inject(['sessionProjections'], (sub) => {
    const handle = sub.sessionProjections.register(statusProjection);
    // The registry logs a failed registration itself; keep it from going unhandled here.
    handle.catch?.(() => {});
  });
}

/**
 * Append `llm/retry` before one wait, the record dsh-llm-retry writes, under
 * our policy key. One retry id per request (kept on its request state), so
 * DSH's chat groups the attempts into one retry row.
 * @returns the retry handle for {@link recordRetryStarted}, or undefined when the session cannot append.
 */
export function recordRetry(agent, { state, turn, step, provider, failure, decision, category }) {
  const session = agent.session;
  if (typeof session?.append !== 'function') return undefined;
  state.retryId ??= randomUUID();
  const retry = { retryId: state.retryId, turn, step, retry: decision.attempt };
  try {
    session.append('llm/retry', {
      ...retry,
      provider,
      mode: 'normal',
      policyKey: `${POLICY_KEY_PREFIX}${category}`,
      maxRetries: decision.maxAttempts,
      delayMs: decision.delayMs,
      failure,
    });
  } catch {
    return undefined; // A status record must never break recovery.
  }
  return retry;
}

/** Append `llm/retry-started` once the wait elapsed (pairs with {@link recordRetry}). */
export function recordRetryStarted(agent, retry) {
  if (!retry) return;
  try {
    agent.session.append('llm/retry-started', retry);
  } catch {
    // ignore: see recordRetry
  }
}
