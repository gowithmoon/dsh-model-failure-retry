/**
 * Stats (#8) part of the settings section: queries the Host's stats service
 * through a loader (the Remote call, set in index.jsx) and edits the
 * retention days (`stats.retentionDays`) over the ConfigForm.
 */
import { DEFAULT_RETENTION_DAYS } from '../core/stats.js';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
export const RANGES = Object.freeze(['24h', '7d', '30d', 'all']);
const RANGE_MS = { '24h': DAY, '7d': 7 * DAY, '30d': 30 * DAY };

/** Milliseconds a range option spans; undefined for "all". */
export function rangeOf(range) {
  return RANGE_MS[range];
}

/**
 * @param {import('./types.js').ConfigFormLike} form
 * @param {{ now?: () => number, tzOffsetMin?: () => number }} [env]
 */
export function createStatsController(form, { now = Date.now, tzOffsetMin = () => new Date().getTimezoneOffset() } = {}) {
  const listeners = new Set();
  let loader;
  let filter = { range: '24h', sessionId: '', model: '', category: '' };
  let page = 1;
  let query = { status: 'unavailable', result: undefined };
  let seq = 0;

  let source;
  let config;
  function deriveConfig() {
    const snap = form.getSnapshot();
    if (snap === source) return config;
    source = snap;
    const next = {
      writable: snap.status === 'ready' && !!snap.writable,
      retentionDays: snap.value?.stats?.retentionDays ?? DEFAULT_RETENTION_DAYS,
    };
    if (!config || next.writable !== config.writable || next.retentionDays !== config.retentionDays) config = next;
    return config;
  }

  let view;
  let viewOf;
  function getSnapshot() {
    const c = deriveConfig();
    if (!view || viewOf.c !== c || viewOf.query !== query || viewOf.filter !== filter || viewOf.page !== page) {
      view = Object.freeze({ ...query, ...c, filter, page });
      viewOf = { c, query, filter, page };
    }
    return view;
  }

  const emit = () => { for (const l of listeners) l(); };

  function request() {
    const span = rangeOf(filter.range);
    const q = { bucket: span && span > DAY ? 'day' : 'hour', tzOffsetMin: tzOffsetMin(), page };
    if (span) q.from = now() - span;
    for (const k of ['sessionId', 'model', 'category']) if (filter[k]) q[k] = filter[k];
    return q;
  }

  async function refresh() {
    if (!loader) return;
    const mine = ++seq;
    query = { ...query, status: query.result ? 'ready' : 'loading', busy: true };
    emit();
    try {
      const result = await loader(request());
      if (mine === seq) query = { status: 'ready', result, busy: false };
    } catch (error) {
      if (mine === seq) query = { status: 'error', result: query.result, error: String(error?.message ?? error), busy: false };
    }
    if (mine === seq) emit();
  }

  return {
    getSnapshot,
    subscribe(listener) {
      listeners.add(listener);
      const off = form.subscribe(() => {
        const before = config;
        if (deriveConfig() !== before) listener();
      });
      return () => { listeners.delete(listener); off(); };
    },
    /** Set the Remote query function, or undefined when the Remote is gone. */
    setLoader(fn) {
      loader = fn;
      seq++;
      query = fn ? { status: 'loading', result: undefined } : { status: 'unavailable', result: undefined };
      emit();
    },
    refresh,
    setFilter(patch) {
      filter = { ...filter, ...patch };
      page = 1;
      return refresh();
    },
    setPage(n) {
      page = Math.max(1, n);
      return refresh();
    },
    setRetentionDays: (days) => form.mutate([{ op: 'set', path: ['stats', 'retentionDays'], value: days }], form.getSnapshot().revision),
  };
}
