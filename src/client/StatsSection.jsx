import { useEffect, useSyncExternalStore } from 'react';
import { Button } from '@deepseek-ai/dsh-client-ui-primitives';
import { DraftField } from './PolicySection.jsx';
import { RANGES } from './stats-controller.js';

const hint = { opacity: 0.65, fontSize: 12, marginTop: 4 };
const heading = { fontWeight: 600, marginTop: 20 };
const select = { font: 'inherit', padding: '4px 6px', borderRadius: 6, maxWidth: 220 };
const label = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, maxWidth: 220 };
const cards = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 8, margin: '12px 0' };
const card = { border: '1px solid rgba(127,127,127,.3)', borderRadius: 8, padding: '8px 10px' };
const filters = { display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end', margin: '12px 0' };
const table = { width: '100%', borderCollapse: 'collapse', fontSize: 12 };
const cell = { textAlign: 'left', padding: '4px 6px', borderBottom: '1px solid rgba(127,127,127,.2)', verticalAlign: 'top' };

const CARD_KEYS = [['retries', 'stats.retries'], ['fallbacks', 'stats.fallbacks'], ['rescued', 'stats.rescued'], ['failures', 'stats.failures']];
const BAR_COLORS = { retries: '#4c8bf5', fallbacks: '#f5a623', rescued: '#3bb273', failures: '#e5534b' };
const CATEGORIES = ['rate-limit', 'transient', 'quota', 'fatal'];
const fmt = (text, vars) => text.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ''));

const parseDays = (text) => (/^\s*\d+\s*$/.test(text) && Number(text) >= 1 ? Number(text) : undefined);

/** Stats (#8): retention, summary cards, bar chart, filterable paged event list. */
export function StatsSection({ t, controller, write, disabled }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  useEffect(() => { controller.refresh(); }, [controller]);
  const result = state.result;
  return (
    <div>
      <div style={heading}>{t('stats.title')}</div>
      <p style={hint}>{t('stats.hint')}</p>
      <label style={label}>
        <span>{t('stats.retention')}</span>
        <DraftField
          id="mfr-stats-retention"
          text={String(state.retentionDays)}
          parse={parseDays}
          disabled={disabled || !state.writable}
          invalidText={t('stats.retentionInvalid')}
          onCommit={(days) => write(controller.setRetentionDays(days))}
        />
      </label>
      {state.status === 'unavailable' && <p style={hint}>{t('stats.unavailable')}</p>}
      {state.status === 'loading' && <p style={hint}>{t('stats.loading')}</p>}
      {state.status === 'error' && <p role="alert" style={hint}>{t('stats.error')}</p>}
      {state.status !== 'unavailable' && (
        <Filters t={t} controller={controller} filter={state.filter} facets={result?.facets} busy={state.busy} />
      )}
      {result && (
        <>
          <div style={cards}>
            {CARD_KEYS.map(([key, text]) => (
              <div key={key} style={card}>
                <div style={hint}>{t(text)}</div>
                <div style={{ fontSize: 20, fontWeight: 600, color: BAR_COLORS[key] }}>{result.summary[key] ?? 0}</div>
              </div>
            ))}
          </div>
          <Chart t={t} result={result} />
          <Events t={t} controller={controller} result={result} />
        </>
      )}
    </div>
  );
}

function Filters({ t, controller, filter, facets, busy }) {
  const pick = (key, text, options, render = (v) => v) => (
    <label style={label}>
      <span>{t(text)}</span>
      <select style={select} value={filter[key]} onChange={(e) => controller.setFilter({ [key]: e.target.value })}>
        {key !== 'range' && <option value="">{t('stats.any')}</option>}
        {options.map((v) => <option key={v} value={v}>{render(v)}</option>)}
      </select>
    </label>
  );
  return (
    <div style={filters}>
      {pick('range', 'stats.range', RANGES, (r) => t(`stats.range.${r}`))}
      {pick('sessionId', 'stats.session', facets?.sessions ?? [], (s) => s.slice(0, 12))}
      {pick('model', 'stats.model', facets?.models ?? [])}
      {pick('category', 'stats.category', CATEGORIES, (c) => t(`category.${c}`))}
      <Button variant="ghost" size="sm" disabled={busy} onClick={() => controller.refresh()}>{t('stats.refresh')}</Button>
    </div>
  );
}

function Chart({ t, result }) {
  const buckets = result.buckets ?? [];
  if (buckets.length === 0) return <p style={hint}>{t('stats.empty')}</p>;
  const keys = ['retries', 'fallbacks', 'rescued', 'failures'];
  const max = Math.max(1, ...buckets.map((b) => keys.reduce((n, k) => n + (b[k] ?? 0), 0)));
  const day = result.bucket === 'day';
  const W = 600;
  const H = 120;
  const bw = W / buckets.length;
  const tick = (s) => {
    const d = new Date(s);
    return day ? `${d.getMonth() + 1}/${d.getDate()}` : `${d.getHours()}:00`;
  };
  return (
    <div>
      <div style={hint}>{t(day ? 'stats.chartDay' : 'stats.chartHour')}</div>
      <svg viewBox={`0 0 ${W} ${H + 16}`} style={{ width: '100%', height: 140 }} role="img" aria-label={t('stats.title')}>
        {buckets.map((b, i) => {
          let y = H;
          return (
            <g key={b.start}>
              <title>{`${new Date(b.start).toLocaleString()} · ${keys.map((k) => `${t(`stats.${k}`)} ${b[k] ?? 0}`).join(' · ')}`}</title>
              {keys.map((k) => {
                const h = ((b[k] ?? 0) / max) * H;
                y -= h;
                return h > 0 ? <rect key={k} x={i * bw + 1} y={y} width={Math.max(1, bw - 2)} height={h} fill={BAR_COLORS[k]} /> : null;
              })}
              {(i === 0 || i === buckets.length - 1 || i % Math.ceil(buckets.length / 6) === 0) && (
                <text x={i * bw + bw / 2} y={H + 12} fontSize="9" textAnchor="middle" fill="currentColor" opacity="0.6">{tick(b.start)}</text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function detail(t, e) {
  const parts = [];
  if (e.kind === 'retry') parts.push(fmt(t('stats.attempt'), { attempt: e.attempt, max: e.maxAttempts, seconds: Math.round((e.delayMs ?? 0) / 100) / 10 }));
  if (e.from || e.to) parts.push(`${e.from ?? ''} → ${e.to ?? ''}`);
  if (e.reason) parts.push(e.reason);
  if (e.category) parts.push(t(`category.${e.category}`));
  if (e.status) parts.push(String(e.status));
  if (e.error) parts.push(e.error);
  return parts.join(' · ');
}

function Events({ t, controller, result }) {
  if (result.total === 0) return null;
  const pages = Math.max(1, Math.ceil(result.total / result.pageSize));
  return (
    <div>
      <table style={table}>
        <thead>
          <tr>
            <th style={cell}>{t('stats.time')}</th>
            <th style={cell}>{t('stats.kindCol')}</th>
            <th style={cell}>{t('stats.model')}</th>
            <th style={cell}>{t('stats.session')}</th>
            <th style={cell}>{t('stats.detail')}</th>
          </tr>
        </thead>
        <tbody>
          {result.events.map((e, i) => (
            <tr key={`${e.time}-${i}`}>
              <td style={cell}>{new Date(e.time).toLocaleString()}</td>
              <td style={cell}>{t(`stats.kind.${e.kind}`)}</td>
              <td style={cell}>{`${e.provider}/${e.model}`}</td>
              <td style={cell}>{(e.sessionId ?? '').slice(0, 12)}{e.subagent ? ` (${t('stats.subagent')})` : ''}</td>
              <td style={cell}>{detail(t, e)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ ...filters, justifyContent: 'flex-end' }}>
        <Button variant="ghost" size="sm" disabled={result.page <= 1} onClick={() => controller.setPage(result.page - 1)}>{t('stats.prev')}</Button>
        <span style={hint}>{fmt(t('stats.pageOf'), { page: result.page, pages, total: result.total })}</span>
        <Button variant="ghost" size="sm" disabled={result.page >= pages} onClick={() => controller.setPage(result.page + 1)}>{t('stats.next')}</Button>
      </div>
    </div>
  );
}
