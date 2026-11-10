/**
 * Stats (#8), Host part: listens to the decision event, stores one record per
 * plugin decision in DSH's `storageDomain` (survives restarts), purges records
 * past the retention, and serves queries to the settings page via @Remote.
 *
 * - Decisions: retry, fallback, skip, give-up (→ `failure`), switch-back (#9).
 *   `pass` / `origin-reset` are not recorded (src/core/stats.js recordOf).
 * - Turn end (`session/event` turn/end) of a turn the plugin stepped in:
 *   `completed` → `rescued`; `aborted` by the user → `stop`. A turn that ends
 *   with the error after a fallback is the switch itself, not a failure: the
 *   follow-up turn decides.
 * - Other plugins (or a later ticket) record by emitting the decision event;
 *   any `{ agent, model, failure?, decision }` with a kind recordOf knows is stored.
 *
 * Storage and typert are optional: without `storageDomain` nothing is stored
 * and queries are empty; without `typert` there is no Remote endpoint.
 */
import { Service } from '@deepseek-ai/cordis';
import { DEFAULT_RETENTION_DAYS, isExpired, queryStats, recordOf } from '../core/stats.js';
import { STATS_PACKAGE, STATS_QUERY_DESCRIPTOR, STATS_SERVICE } from '../stats-remote.js';

export { STATS_SERVICE };

const HOUR = 3_600_000;

/** storageDomain spec (shape of dsh-storage-domain `defineDomain`; validation is ours). */
export const STATS_DOMAIN = Object.freeze({
  name: 'model_failure_retry_stats',
  version: 1,
  layout: 'per-record',
  invalidRecords: 'backup-and-skip',
  tables: { events: { valueSchema: { parse: parseRecord } } },
});

function parseRecord(raw) {
  if (!raw || typeof raw !== 'object' || !Number.isFinite(raw.time) || typeof raw.kind !== 'string') {
    throw new Error('invalid stats record');
  }
  return raw;
}

const MANIFEST = {
  package: STATS_PACKAGE,
  face: 'host',
  schemas: [],
  invocations: [STATS_QUERY_DESCRIPTOR],
  model: { services: [], events: [], objects: [] },
};

class StatsService extends Service {
  constructor(ctx, store) {
    super(ctx, STATS_SERVICE);
    this.store = store;
    // Gateway source-mode binding (what dsh-typert-protocol's bindTypertRemote returns).
    this.typertRemote = Object.freeze({ service: this, serviceKey: STATS_SERVICE, namespace: STATS_SERVICE });
  }

  /** @param {import('../core/stats.js').StatsQuery} [query] */
  async query(query = {}) {
    return this.store.query(query);
  }
}

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {{ decisionEvent: string, retentionDays: () => number, rules: () => readonly object[] }} options
 */
export function installStats(ctx, { decisionEvent, retentionDays, rules }) {
  const store = createStore(retentionDays, (error) => ctx.logger?.warn?.(`stats storage failed: ${error}`));

  ctx.inject(['storageDomain'], (sub) => {
    store.open(sub.storageDomain.open(STATS_DOMAIN));
    sub.effect(() => () => store.close(), 'model-failure-retry: stats storage');
    sub.effect(() => {
      const timer = setInterval(() => store.purge(), HOUR);
      return () => clearInterval(timer);
    }, 'model-failure-retry: stats retention');
  });
  // Kept on purpose (S12): the same root accessor dsh-typert-protocol's
  // `provideInvocationAccessor` installs for every RemoteService, which this
  // Service stands in for (we do not depend on that package). The Remote
  // gateway reads `ctx.invocation`; without it, reading it outside a call
  // throws reflect's "cannot get property" instead of `undefined`. Idempotent
  // and identical to DSH's own, so it changes nothing when typert set it first.
  if (!Object.hasOwn(ctx.root.reflect.props, 'invocation')) ctx.root.accessor('invocation', { get: () => undefined });
  new StatsService(ctx, store);
  ctx.inject(['typert'], (sub) => {
    sub.effect(() => sub.typert.register(MANIFEST), 'model-failure-retry: stats remote');
  });

  /** Sessions whose current turn the plugin stepped in: session → { model, fallback, at }. */
  const touched = new WeakMap();

  ctx.on(decisionEvent, (payload) => {
    const session = payload.agent?.session;
    const at = { time: Date.now(), sessionId: sessionIdOf(session), subagent: session?.header?.origin === 'subagent' };
    const record = recordOf(payload, at, { rules: rules() });
    if (!record) return;
    store.add(record);
    if (!session || record.kind === 'switch-back') return;
    if (record.kind === 'failure') touched.delete(session);
    else {
      const to = payload.decision.kind === 'fallback' ? (payload.decision.selection ?? payload.decision.to) : payload.model;
      touched.set(session, { model: to ?? payload.model, fallback: payload.decision.kind === 'fallback', at });
    }
  });

  ctx.on('session/event', (session, event) => {
    if (event?.type !== 'turn/end') return;
    const state = touched.get(session);
    if (!state) return;
    const reason = event.data?.reason;
    if (reason?.kind === 'error' && state.fallback) {
      state.fallback = false; // the switch turn; the follow-up turn decides
      return;
    }
    touched.delete(session);
    const kind = reason?.kind === 'completed' ? 'rescued'
      : reason?.kind === 'aborted' && reason.reason?.kind === 'user' ? 'stop'
        : undefined;
    if (!kind) return;
    store.add({
      time: Date.now(),
      sessionId: sessionIdOf(session) ?? state.at.sessionId,
      subagent: session?.header?.origin === 'subagent' || state.at.subagent,
      kind,
      provider: state.model?.provider ?? '',
      model: state.model?.model ?? '',
    });
  });
}

function sessionIdOf(session) {
  const id = session?.id ?? session?.header?.id;
  return typeof id === 'string' ? id : undefined;
}

/**
 * Records in a storageDomain table; writes are serialised, queries wait for them.
 * A storage error is reported through `warn` and never breaks recovery or unload.
 */
function createStore(retentionDays, warn) {
  let opening;
  let table;
  let chain = Promise.resolve();
  let seq = 0;

  const enqueue = (job) => {
    chain = chain.then(job).catch(warn);
    return chain;
  };
  const days = () => {
    const d = retentionDays();
    return Number.isFinite(d) && d > 0 ? d : DEFAULT_RETENTION_DAYS;
  };

  async function purge() {
    if (!table) return;
    const now = Date.now();
    const expired = [];
    for (const [key, record] of table.entries()) if (isExpired(record, now, days())) expired.push(key);
    if (expired.length) await table.deleteMany(expired);
  }

  return {
    open(promise) {
      opening = promise;
      enqueue(async () => {
        const domain = await promise;
        table = domain.table('events');
        await purge();
      });
    },
    async close() {
      const pending = opening;
      opening = undefined;
      await chain;
      table = undefined;
      // A domain that failed to open has nothing to close (its error was reported by enqueue).
      const domain = await pending?.catch(() => undefined);
      await domain?.close().catch(warn);
    },
    add(record) {
      if (!opening) return;
      const key = `${record.time.toString(36)}-${(seq++).toString(36)}`;
      enqueue(() => table?.put(key, record));
    },
    purge: () => enqueue(purge),
    async query(query) {
      await enqueue(purge);
      return queryStats(table ? [...table.entries()].map(([, r]) => r) : [], query);
    },
  };
}
