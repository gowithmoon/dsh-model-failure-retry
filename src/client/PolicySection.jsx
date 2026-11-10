import { useEffect, useState, useSyncExternalStore } from 'react';
import { Button, Input, Switch } from '@deepseek-ai/dsh-client-ui-primitives';
import { formatSequence, parseSequence } from './policy-controller.js';
import { timeline } from './timeline.js';

const KINDS = [['fixed', 'kindFixed'], ['linear', 'kindLinear'], ['exponential', 'kindExponential'], ['custom', 'kindCustom']];
const hint = { opacity: 0.65, fontSize: 12, marginTop: 4 };
const heading = { fontWeight: 600, marginTop: 20 };
const grid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12, marginTop: 8 };
const label = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 };
const warn = { color: 'var(--color-warning, #b7791f)', fontSize: 12 };

const fmt = (text, vars) => text.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ''));

/** "1m 05s" / "12s" / "1.5s" */
export function formatDuration(ms) {
  const s = ms / 1000;
  if (s < 60) return `${Number.isInteger(s) ? s : s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const rest = Math.round(s - m * 60);
  return `${m}m ${String(rest).padStart(2, '0')}s`;
}

/** A text field that keeps a local draft and commits only parsed, valid values. */
function DraftField({ text, parse, onCommit, disabled, invalidText, ...rest }) {
  const [draft, setDraft] = useState(text);
  useEffect(() => setDraft(text), [text]);
  const parsed = parse(draft);
  const invalid = parsed === undefined;
  const commit = () => {
    if (!invalid && draft !== text) onCommit(parsed);
  };
  return (
    <>
      <Input
        type="text"
        value={draft}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') commit(); }}
        {...rest}
      />
      {invalid && invalidText && <span style={warn}>{invalidText}</span>}
    </>
  );
}

const number = ({ min = 0, max = Infinity, integer = false, scale = 1 }) => (text) => {
  if (!/^\s*\d+(\.\d+)?\s*$/.test(text)) return undefined;
  const v = Number(text) * scale;
  const out = integer ? Math.round(v) : v;
  return out >= min && out <= max ? out : undefined;
};

function PolicyFields({ t, policy, disabled, onField, idPrefix }) {
  const field = (key, title, parse, text, extra) => (
    <label style={label} key={key}>
      <span>{title}</span>
      <DraftField
        id={`${idPrefix}-${key}`}
        text={text}
        parse={parse}
        disabled={disabled}
        onCommit={(v) => onField(key, v)}
        {...extra}
      />
    </label>
  );
  const custom = policy.kind === 'custom';
  return (
    <div>
      <div style={grid}>
        <label style={label}>
          <span>{t('kind')}</span>
          <select value={policy.kind} disabled={disabled} onChange={(e) => onField('kind', e.target.value)}>
            {KINDS.map(([value, key]) => <option key={value} value={value}>{t(key)}</option>)}
          </select>
        </label>
        {custom
          ? field('sequenceMs', t('sequence'), parseSequence, formatSequence(policy.sequenceMs), { invalidText: t('sequenceInvalid') })
          : field('initialDelayMs', t('initialDelay'), number({ scale: 1000, integer: true }), String(policy.initialDelayMs / 1000))}
        {policy.kind === 'exponential' && field('multiplier', t('multiplier'), number({ min: 1 }), String(policy.multiplier))}
        {field('maxDelayMs', t('maxDelay'), number({ scale: 1000, integer: true }), String(policy.maxDelayMs / 1000))}
        {field('maxAttempts', t('maxAttempts'), number({ integer: true, max: 100 }), String(policy.maxAttempts))}
        {field('jitterRatio', t('jitter'), number({ max: 1, scale: 0.01 }), String(Math.round(policy.jitterRatio * 100)))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, marginTop: 12 }}>
        <div>
          <div>{t('honorRetryAfter')}</div>
          <div style={hint}>{t('honorRetryAfterHint')}</div>
        </div>
        <Switch
          checked={policy.honorRetryAfter}
          disabled={disabled}
          label={t('honorRetryAfter')}
          onChange={(on) => onField('honorRetryAfter', on)}
        />
      </div>
    </div>
  );
}

/** The retry schedule on a time axis: T0, each retry with its jitter window, then the end. */
export function Timeline({ t, policy }) {
  const plan = timeline(policy);
  if (plan.retries.length === 0) return <p style={hint}>{t('timelineNone')}</p>;
  const span = plan.endMaxMs || 1;
  const pct = (ms) => `${(ms / span) * 100}%`;
  const range = (lo, hi) => (lo === hi ? formatDuration(lo) : `${formatDuration(lo)}–${formatDuration(hi)}`);
  return (
    <div>
      <div style={{ position: 'relative', height: 28, margin: '12px 8px 4px' }} aria-hidden="true">
        <div style={{ position: 'absolute', top: 13, left: 0, right: 0, height: 2, background: 'currentColor', opacity: 0.2 }} />
        <Mark at="0%" text="T0" />
        {plan.retries.map((r) => (
          <div key={r.attempt}>
            <div style={{ position: 'absolute', top: 9, height: 10, left: pct(r.minAtMs), width: pct(r.maxAtMs - r.minAtMs), background: 'currentColor', opacity: 0.15, borderRadius: 3 }} />
            <Mark at={pct(r.atMs)} text={String(r.attempt)} />
          </div>
        ))}
        <Mark at={pct(plan.endMs)} text="■" />
      </div>
      <ol style={{ listStyle: 'none', padding: 0, margin: '8px 0 0', fontSize: 13 }}>
        <li style={{ opacity: 0.65 }}>T0</li>
        {plan.retries.map((r) => (
          <li key={r.attempt}>
            {`T+${range(r.minAtMs, r.maxAtMs)} · ${fmt(t('timelineRetry'), { n: r.attempt })} · ${fmt(t('timelineAfter'), { wait: formatDuration(r.delayMs) })}`}
          </li>
        ))}
        <li style={{ fontWeight: 600 }}>
          {`T+${range(plan.endMinMs, plan.endMaxMs)} · ${t('timelineEnd')} · ${fmt(t('timelineTotal'), { total: formatDuration(plan.endMs) })}`}
        </li>
      </ol>
    </div>
  );
}

function Mark({ at, text }) {
  return (
    <div style={{ position: 'absolute', left: at, top: 0, transform: 'translateX(-50%)', textAlign: 'center', fontSize: 10, lineHeight: '10px' }}>
      <div style={{ width: 8, height: 8, borderRadius: 4, background: 'currentColor', margin: '9px auto 0' }} />
      <div style={{ marginTop: 2 }}>{text}</div>
    </div>
  );
}

function OverrideRow({ t, index, count, override, disabled, controller, write }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ borderTop: '1px solid color-mix(in srgb, currentColor 15%, transparent)', padding: '12px 0' }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <label style={{ ...label, flex: '1 1 220px' }}>
          <span>{t('overrideMatch')}</span>
          <DraftField
            text={override.match}
            parse={(text) => text.trim()}
            placeholder={t('overrideMatchPlaceholder')}
            disabled={disabled}
            onCommit={(v) => write(controller.setOverrideMatch(index, v))}
          />
        </label>
        <Button size="sm" variant="outline" disabled={disabled || index === 0} onClick={() => write(controller.moveOverride(index, -1))}>{t('overrideUp')}</Button>
        <Button size="sm" variant="outline" disabled={disabled || index === count - 1} onClick={() => write(controller.moveOverride(index, 1))}>{t('overrideDown')}</Button>
        <Button size="sm" variant="ghost" disabled={disabled} onClick={() => write(controller.removeOverride(index))}>{t('overrideRemove')}</Button>
      </div>
      {!override.match && <div style={warn}>{t('overrideMatchEmpty')}</div>}
      <PolicyFields
        t={t}
        policy={override.policy}
        disabled={disabled}
        idPrefix={`mfr-override-${index}`}
        onField={(key, value) => write(controller.setOverrideField(index, key, value))}
      />
      <Button size="sm" variant="ghost" onClick={() => setOpen(!open)} aria-expanded={open}>
        {open ? t('overrideHide') : t('overrideShow')}
      </Button>
      {open && <Timeline t={t} policy={override.policy} />}
    </div>
  );
}

/** Retry policy → timeline → per-model overrides. */
export function PolicySection({ t, controller, write, disabled: locked }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const disabled = locked || !state.writable;
  return (
    <div>
      <div style={heading}>{t('policyTitle')}</div>
      <div style={hint}>{t('policyHint')}</div>
      <PolicyFields
        t={t}
        policy={state.policy}
        disabled={disabled}
        idPrefix="mfr-policy"
        onField={(key, value) => write(controller.setPolicyField(key, value))}
      />

      <div style={heading}>{t('timelineTitle')}</div>
      <div style={hint}>{t('timelineHint')}</div>
      <Timeline t={t} policy={state.policy} />

      <div style={heading}>{t('overridesTitle')}</div>
      <div style={hint}>{t('overridesHint')}</div>
      {state.overrides.map((o, i) => (
        <OverrideRow
          key={i}
          t={t}
          index={i}
          count={state.overrides.length}
          override={o}
          disabled={disabled}
          controller={controller}
          write={write}
        />
      ))}
      <div style={{ marginTop: 8 }}>
        <Button size="sm" variant="outline" disabled={disabled} onClick={() => write(controller.addOverride())}>{t('overrideAdd')}</Button>
      </div>
    </div>
  );
}
