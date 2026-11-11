/**
 * Durable per-session state (P2): the 原模型 (`origin`), the model the plugin
 * last selected (`selected`) and when the origin last failed
 * (`lastFailureAt`, the switch-back timer). Kept in DSH's `storageDomain`
 * keyed by session id, so a session reopened after a DSH restart picks up
 * where it left: the chain running out still selects the origin back, and
 * switch-back is due at the same time as without the restart.
 *
 * A record is deleted once it holds nothing (the episode ended); records not
 * touched for RETENTION_MS are purged on open (sessions deleted meanwhile).
 *
 * Reads and merges go against an in-memory copy (writes are queued, so the
 * table may lag behind); it is filled from the table on open. Before it opened
 * (or without `storageDomain`) the plugin works from memory only, as before.
 */
const RETENTION_MS = 30 * 24 * 3_600_000;

export const SESSIONS_DOMAIN = Object.freeze({
  name: 'model_failure_retry_sessions',
  version: 1,
  layout: 'per-record',
  invalidRecords: 'backup-and-skip',
  tables: { sessions: { valueSchema: { parse: parseRecord } } },
});

const FIELDS = ['origin', 'selected', 'lastFailureAt'];

function parseRef(ref) {
  if (ref === undefined) return undefined;
  if (!ref || typeof ref.provider !== 'string' || typeof ref.model !== 'string') throw new Error('invalid model ref');
  return {
    provider: ref.provider,
    model: ref.model,
    ...(typeof ref.reasoningEffort === 'string' ? { reasoningEffort: ref.reasoningEffort } : {}),
  };
}

function parseRecord(raw) {
  if (!raw || typeof raw !== 'object' || !Number.isFinite(raw.updatedAt)) throw new Error('invalid session record');
  if (raw.lastFailureAt !== undefined && !Number.isFinite(raw.lastFailureAt)) throw new Error('invalid session record');
  return {
    updatedAt: raw.updatedAt,
    ...(raw.origin ? { origin: parseRef(raw.origin) } : {}),
    ...(raw.selected ? { selected: parseRef(raw.selected) } : {}),
    ...(raw.lastFailureAt !== undefined ? { lastFailureAt: raw.lastFailureAt } : {}),
  };
}

/** Storage keys must be path-safe (`[a-zA-Z0-9_-]+`); session ids may not be. */
const keyOf = (sessionId) => Buffer.from(String(sessionId), 'utf8').toString('base64url');

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @returns {{
 *   load(agent: object): { origin?: object, selected?: object, lastFailureAt?: number } | undefined,
 *   save(agent: object, fields: { origin?: object, selected?: object, lastFailureAt?: number }): void,
 * }}
 */
export function installSessionStore(ctx) {
  const warn = (error) => ctx.logger?.warn?.(`session storage failed: ${error}`);
  let table;
  /** @type {Map<string, object>} key → record, ahead of the queued writes */
  const cache = new Map();
  let chain = Promise.resolve();
  const enqueue = (job) => {
    chain = chain.then(job).catch(warn);
    return chain;
  };

  ctx.inject(['storageDomain'], (sub) => {
    const opening = sub.storageDomain.open(SESSIONS_DOMAIN);
    enqueue(async () => {
      const domain = await opening;
      table = domain.table('sessions');
      const now = Date.now();
      const stale = [];
      for (const [k, r] of table.entries()) {
        if (now - r.updatedAt > RETENTION_MS) stale.push(k);
        else if (!cache.has(k)) cache.set(k, r);
      }
      if (stale.length) await table.deleteMany(stale);
    });
    sub.effect(() => async () => {
      await chain;
      table = undefined;
      cache.clear();
      const domain = await opening.catch(() => undefined);
      await domain?.close().catch(warn);
    }, 'model-failure-retry: session storage');
  });

  const sessionKey = (agent) => {
    const id = agent?.session?.id;
    return id === undefined || id === null || id === '' ? undefined : keyOf(id);
  };

  return {
    load(agent) {
      const key = sessionKey(agent);
      return key && table ? cache.get(key) : undefined;
    },
    save(agent, fields) {
      const key = sessionKey(agent);
      if (!key || !table) return;
      const next = { ...(cache.get(key) ?? {}) };
      for (const f of FIELDS) {
        if (!(f in fields)) continue;
        if (fields[f] === undefined) delete next[f];
        else next[f] = fields[f];
      }
      const empty = FIELDS.every((f) => next[f] === undefined);
      const current = table;
      if (empty) {
        cache.delete(key);
        enqueue(() => current.delete(key));
      } else {
        const record = { ...next, updatedAt: Date.now() };
        cache.set(key, record);
        enqueue(() => current.put(key, record));
      }
    },
  };
}
