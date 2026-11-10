/**
 * Stats (#8), pure part: turning a decision into a stored record, retention,
 * and the query (filter, summary, time buckets, paged events). No DSH, no I/O.
 *
 * Record kinds: retry, fallback, skip, switch-back (#9) come from decision
 * events; `failure` is a give-up decision; `rescued` (the turn completed after
 * the plugin stepped in) and `stop` (the user stopped the turn while the
 * plugin was handling it) come from the turn end, see src/host/stats.js.
 * `pass` and `origin-reset` are not recorded.
 */
import { label as refLabel } from './chain.js';
import { classify } from './classify.js';
import { defaultRules, failureStatus } from './rules.js';

/** Default retention of stored records, in days. */
export const DEFAULT_RETENTION_DAYS = 30;
export const RECORD_KINDS = Object.freeze(['retry', 'fallback', 'skip', 'switch-back', 'failure', 'rescued', 'stop']);
const ERROR_MAX = 300;
const DAY = 86_400_000;
const HOUR = 3_600_000;
const MAX_BUCKETS = 400;

const label = (ref) => (ref ? refLabel(ref) : undefined);

/**
 * @typedef {object} StatsRecord
 * @property {number} time            Epoch ms.
 * @property {string} [sessionId]
 * @property {boolean} subagent       Whether the session is a subagent's.
 * @property {string} kind            One of RECORD_KINDS.
 * @property {string} provider        The model the record is about (skip: the skipped model).
 * @property {string} model
 * @property {string} [category]      rate-limit | transient | quota | fatal
 * @property {number} [status]        HTTP status, when known.
 * @property {string} [code]          LlmFailure code.
 * @property {string} [error]         Error summary (truncated).
 * @property {string} [reason]        skip / fallback / failure reason.
 * @property {number} [attempt]       retry only.
 * @property {number} [maxAttempts]   retry only.
 * @property {number} [delayMs]       retry only.
 * @property {string} [from]          fallback / switch-back: provider/model.
 * @property {string} [to]
 */

/**
 * The record of one decision event, or undefined when it is not recorded.
 * @param {{ model?: object, failure?: object, decision: object }} event
 * @param {{ time: number, sessionId?: string, subagent: boolean }} at
 * @param {{ rules?: readonly object[] }} [options] classification rules (for the category)
 * @returns {StatsRecord | undefined}
 */
export function recordOf(event, at, { rules = defaultRules() } = {}) {
  const { model, failure, decision } = event;
  const base = (ref) => ({ ...at, provider: ref?.provider ?? '', model: ref?.model ?? '' });
  const failed = () => (failure ? failureFields(failure, rules) : {});
  switch (decision?.kind) {
    case 'retry':
      return { ...base(model), kind: 'retry', ...failed(), attempt: decision.attempt, maxAttempts: decision.maxAttempts, delayMs: decision.delayMs };
    case 'fallback':
      return { ...base(model), kind: 'fallback', ...failed(), reason: decision.reason, from: label(model), to: label(decision.selection ?? decision.to) };
    case 'skip':
      return { ...base(decision.target), kind: 'skip', ...failed(), reason: decision.reason };
    case 'give-up':
      return { ...base(model), kind: 'failure', ...failed(), reason: decision.reason };
    case 'switch-back':
      return { ...base(decision.from ?? model), kind: 'switch-back', from: label(decision.from ?? model), to: label(decision.to) };
    default:
      return undefined;
  }
}

function failureFields(failure, rules) {
  const fields = {};
  const { category } = classify(failure, rules);
  if (category) fields.category = category;
  const status = failureStatus(failure);
  if (status !== undefined) fields.status = status;
  if (failure.code) fields.code = failure.code;
  if (failure.message) fields.error = String(failure.message).slice(0, ERROR_MAX);
  return fields;
}

/** Whether a record is past the retention (days) at `now`. */
export function isExpired(record, now, retentionDays) {
  return record.time < now - retentionDays * DAY;
}

/**
 * @typedef {object} StatsQuery
 * @property {string} [sessionId]
 * @property {string} [model]        provider/model
 * @property {string} [category]
 * @property {string} [kind]
 * @property {number} [from]         Epoch ms, inclusive.
 * @property {number} [to]           Epoch ms, exclusive.
 * @property {'hour' | 'day'} [bucket]
 * @property {number} [tzOffsetMin]  Like Date#getTimezoneOffset (UTC+8 → -480); for day buckets.
 * @property {number} [page]         1-based.
 * @property {number} [pageSize]
 */

/**
 * Filter, summarise, bucket and page records.
 * @param {Iterable<StatsRecord>} records
 * @param {StatsQuery} [query]
 */
export function queryStats(records, query = {}) {
  const all = [...records];
  const pageSize = clampInt(query.pageSize, 1, 200, 20);
  const page = clampInt(query.page, 1, Number.MAX_SAFE_INTEGER, 1);
  const hits = all.filter((r) => matches(r, query)).sort((a, b) => b.time - a.time);

  const summary = emptyCounts();
  for (const r of hits) count(summary, r.kind);

  return {
    summary,
    buckets: bucketize(hits, query.bucket === 'day' ? DAY : HOUR, query.bucket === 'day' ? (query.tzOffsetMin ?? 0) * 60_000 : 0),
    bucket: query.bucket === 'day' ? 'day' : 'hour',
    events: hits.slice((page - 1) * pageSize, page * pageSize),
    total: hits.length,
    page,
    pageSize,
    facets: {
      sessions: unique(all.map((r) => r.sessionId)),
      models: unique(all.map(refLabel)),
    },
  };
}

function matches(r, q) {
  if (q.sessionId && r.sessionId !== q.sessionId) return false;
  if (q.model && refLabel(r) !== q.model) return false;
  if (q.category && r.category !== q.category) return false;
  if (q.kind && r.kind !== q.kind) return false;
  if (Number.isFinite(q.from) && r.time < q.from) return false;
  if (Number.isFinite(q.to) && r.time >= q.to) return false;
  return true;
}

const COUNT_KEY = {
  retry: 'retries', fallback: 'fallbacks', skip: 'skips', 'switch-back': 'switchBacks',
  failure: 'failures', rescued: 'rescued', stop: 'stops',
};

function emptyCounts() {
  return Object.fromEntries(Object.values(COUNT_KEY).map((k) => [k, 0]));
}

function count(counts, kind) {
  const key = COUNT_KEY[kind];
  if (key) counts[key] += 1;
}

/** Consecutive buckets from the oldest to the newest hit (empty ones included), at most MAX_BUCKETS newest. */
function bucketize(hits, size, shift) {
  if (hits.length === 0) return [];
  const startOf = (t) => Math.floor((t - shift) / size) * size + shift;
  const newest = startOf(hits[0].time);
  const oldest = Math.max(startOf(hits[hits.length - 1].time), newest - (MAX_BUCKETS - 1) * size);
  const buckets = [];
  const index = new Map();
  for (let s = oldest; s <= newest; s += size) {
    const b = { start: s, ...emptyCounts() };
    index.set(s, b);
    buckets.push(b);
  }
  for (const r of hits) {
    const b = index.get(startOf(r.time));
    if (b) count(b, r.kind);
  }
  return buckets;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function clampInt(value, min, max, fallback) {
  return Number.isInteger(value) ? Math.min(max, Math.max(min, value)) : fallback;
}
