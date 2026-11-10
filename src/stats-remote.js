/**
 * Stats (#8) Remote contract shared by Host (typert manifest) and Web client
 * ($mount). No imports, so the client bundle can include it.
 *
 * Call from a client: `ctx.remote.$mount(STATS_CONTRIBUTION)`, then
 * `ctx.remote.modelFailureRetryStats.query(query)` → `{ ok, value | error }`;
 * value is `queryStats` output (src/core/stats.js).
 */
export const STATS_PACKAGE = 'dsh-model-failure-retry';
/** Cordis service key and Remote namespace. */
export const STATS_SERVICE = 'modelFailureRetryStats';

/** Keep only known query fields (Remote input boundary). */
export function parseStatsQuery(x) {
  if (x === undefined) return {};
  if (!x || typeof x !== 'object' || Array.isArray(x)) throw new Error('stats query must be an object');
  const out = {};
  for (const k of ['sessionId', 'model', 'category', 'kind']) if (typeof x[k] === 'string' && x[k]) out[k] = x[k];
  for (const k of ['from', 'to', 'tzOffsetMin', 'page', 'pageSize']) if (Number.isFinite(x[k])) out[k] = x[k];
  if (x.bucket === 'hour' || x.bucket === 'day') out.bucket = x.bucket;
  return out;
}

const codec = (symbol, parse) => ({ mode: 'strict', typeSymbol: `${STATS_PACKAGE}#${symbol}`, create: () => ({ parse }) });

export const STATS_QUERY_DESCRIPTOR = Object.freeze({
  id: `${STATS_PACKAGE}#${STATS_SERVICE}/query`,
  service: STATS_SERVICE,
  namespace: STATS_SERVICE,
  method: 'query',
  invocation: { kind: 'direct' },
  parameters: [{ name: 'query', wire: 'query', source: 'json', acceptsUndefined: true, codec: codec('StatsQuery', parseStatsQuery) }],
  result: codec('StatsResult', (x) => x),
});

/** Client `$mount` contribution. */
export const STATS_CONTRIBUTION = Object.freeze({ package: STATS_PACKAGE, descriptors: [STATS_QUERY_DESCRIPTOR] });
