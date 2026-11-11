import { useState } from 'react';
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives';
import { builtinCategory } from '../core/classify.js';
import { DEFAULT_CUSTOM_CATEGORY, isValidCode, normalizeCode, presetEffect, presetOf } from '../core/rule-presets.js';
import { CategorySelect, card, fill, hint, line, warn } from './rules-shared.jsx';
import { filterCatalog } from './rules-view.js';

const AMBER = 'var(--dsw-alias-state-warn, #c78421)';
const PRIMARY = 'var(--dsw-alias-state-business-primary, #3867d6)';
const GREY = 'var(--dsw-alias-text-secondary, #8a8f98)';
const BORDER = 'var(--dsw-alias-border-default, rgba(127,127,127,.4))';

/** Accent colour of each preset effect: built-in grey, new blue, override amber. */
const EFFECT_COLOR = { builtin: GREY, add: PRIMARY, override: AMBER };
/** Categories the policy may retry; an override into one of them is worth flagging. */
const RETRIED = new Set(['transient', 'rate-limit']);

const srOnly = { position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' };

function chipStyle(effect, selected, disabled) {
  const accent = EFFECT_COLOR[effect];
  return {
    font: 'inherit',
    position: 'relative',
    fontSize: 12,
    padding: '3px 10px',
    borderRadius: 999,
    cursor: disabled ? 'default' : 'pointer',
    opacity: disabled ? 0.5 : 1,
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    border: `1px solid ${effect === 'add' ? BORDER : accent}`,
    background: selected ? accent : 'transparent',
    color: selected ? '#fff' : 'inherit',
    fontWeight: selected ? 600 : 400,
  };
}

const badgeStyle = (effect, selected) => ({
  fontSize: 10,
  lineHeight: 1,
  padding: '2px 4px',
  borderRadius: 4,
  border: `1px solid ${selected ? '#fff' : EFFECT_COLOR[effect]}`,
  color: selected ? '#fff' : EFFECT_COLOR[effect],
});

function effectTitle(t, code, effect, category) {
  const name = (c) => t(`category.${c}`);
  if (effect === 'builtin') return t('rules.catalog.effect.builtinTitle');
  if (effect === 'add') return fill(t('rules.catalog.effect.addTitle'), { category: name(category) });
  return fill(t('rules.catalog.effect.overrideTitle'), { builtin: name(builtinCategory(code)), category: name(category) })
    + (RETRIED.has(category) ? t('rules.catalog.effect.overrideRetry') : '');
}

function Chip({ t, code, selected, disabled, onClick }) {
  const preset = presetOf(code);
  const useless = preset.retryUseless;
  const effect = presetEffect(code);
  // A built-in code is not worth adding; once a rule has it, the chip still removes it.
  // aria-disabled rather than disabled so the explaining tooltip still shows on hover.
  const inert = effect === 'builtin' && !selected;
  const title = [
    fill(t('rules.catalog.chipTitle'), { code, category: t(`category.${preset.category}`), desc: t(preset.descKey) }),
    effectTitle(t, code, effect, preset.category),
    useless ? `⚠ ${t('rules.catalog.retryUseless')}` : '',
  ].filter(Boolean).join('\n');
  return (
    <button
      type="button"
      aria-pressed={selected}
      title={title}
      disabled={disabled}
      aria-disabled={inert || undefined}
      style={chipStyle(effect, selected, disabled || inert)}
      onClick={() => { if (!inert) onClick(); }}
    >
      {selected && <span aria-hidden="true">✓</span>}
      <span>{code}</span>
      <span style={badgeStyle(effect, selected)}>{t(`rules.catalog.effect.${effect}`)}</span>
      {useless && <span aria-hidden="true" style={{ opacity: 0.9 }}>⚠</span>}
      {useless && <span style={srOnly}>{t('rules.catalog.retryUseless')}</span>}
    </button>
  );
}

function GroupBlock({ t, controller, group, disabled, onChip, onGroup }) {
  const label = t(group.labelKey);
  const selected = group.all.filter((code) => controller.hasCode(code)).length;
  const builtin = group.all.filter((code) => presetEffect(code) === 'builtin').length;
  const addable = group.all.some((code) => presetEffect(code) === 'add' && !controller.hasCode(code));
  return (
    <div style={{ marginTop: 12 }} role="group" aria-label={label}>
      <div style={line}>
        <strong>{label}</strong>
        <span style={hint}>{t(group.noteKey)}</span>
        <span style={{ ...hint, marginTop: 0 }}>{fill(t('rules.catalog.selected'), { n: selected })}</span>
        {builtin > 0 && <span style={{ ...hint, marginTop: 0 }}>{fill(t('rules.catalog.builtinCount'), { n: builtin })}</span>}
        <span style={{ flex: 1 }} />
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled || !addable}
          title={addable ? undefined : t('rules.catalog.groupAllBuiltin')}
          aria-label={fill(t('rules.catalog.addGroupLabel'), { group: label })}
          onClick={() => onGroup(group.id, true)}
        >
          {t('rules.catalog.addGroup')}
        </Button>
        <Button variant="ghost" size="sm" disabled={disabled} aria-label={fill(t('rules.catalog.removeGroupLabel'), { group: label })} onClick={() => onGroup(group.id, false)}>
          {t('rules.catalog.removeGroup')}
        </Button>
      </div>
      <div style={{ ...line, gap: 6, marginTop: 6 }}>
        {group.codes.map((code) => (
          <Chip key={code} t={t} code={code} selected={controller.hasCode(code)} disabled={disabled} onClick={() => onChip(code)} />
        ))}
      </div>
    </div>
  );
}

function Legend({ t }) {
  const swatch = (effect) => (
    <span style={badgeStyle(effect, false)}>{t(`rules.catalog.effect.${effect}`)}</span>
  );
  return (
    <div style={{ ...hint, ...line, gap: 6 }}>
      {swatch('builtin')}{swatch('add')}{swatch('override')}
      <span>{t('rules.catalog.legend')}</span>
      <span>{t('rules.catalog.legendRetryUseless')}</span>
    </div>
  );
}

function CustomCode({ t, controller, disabled, write }) {
  const [text, setText] = useState('');
  const [category, setCategory] = useState(DEFAULT_CUSTOM_CATEGORY);
  const [error, setError] = useState('');
  const submit = () => {
    const code = normalizeCode(text);
    if (code === '') return;
    if (!isValidCode(code)) return setError('rules.catalog.invalidCode');
    if (presetOf(code)) return setError('rules.catalog.useChip');
    if (controller.hasCode(code)) return setError('rules.catalog.duplicateCode');
    setError('');
    setText('');
    write(controller.addPreset(code, category));
  };
  return (
    <div style={{ marginTop: 12 }}>
      <div style={line}>
        <Input
          aria-label={t('rules.catalog.customLabel')}
          aria-invalid={error !== ''}
          placeholder={t('rules.catalog.customPlaceholder')}
          style={{ width: 220 }}
          value={text}
          disabled={disabled}
          onChange={(e) => { setText(e.target.value.toUpperCase()); setError(''); }}
          onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
        />
        <CategorySelect t={t} label={t('rules.catalog.customCategory')} value={category} disabled={disabled} onChange={(value) => { setCategory(value); setError(''); }} />
        <Button variant="outline" size="sm" disabled={disabled || text.trim() === ''} onClick={submit}>{t('rules.catalog.customAdd')}</Button>
      </div>
      {error !== '' && <div role="alert" style={warn}>{t(error)}</div>}
    </div>
  );
}

/** Searchable, grouped chip catalog of known error codes; one click adds or removes a bare rule. */
export function RuleCatalog({ t, controller, disabled, write }) {
  const [query, setQuery] = useState('');
  const [notice, setNotice] = useState('');
  const groups = filterCatalog(t, query);
  const onChip = (code) => {
    setNotice('');
    if (!controller.hasCode(code)) return write(controller.addPreset(code));
    if (controller.hasBareRule(code)) return write(controller.removePreset(code));
    setNotice(code);
  };
  const onGroup = (id, add) => {
    setNotice('');
    write(add ? controller.addPresetGroup(id) : controller.removePresetGroup(id));
  };
  return (
    <div style={card}>
      <div>{t('rules.catalog.title')}</div>
      <div style={hint}>{t('rules.catalog.note')}</div>
      <Legend t={t} />
      <div style={hint}>{t('rules.catalog.hint')}</div>
      <Input
        aria-label={t('rules.catalog.search')}
        placeholder={t('rules.catalog.searchPlaceholder')}
        style={{ marginTop: 8, width: '100%', maxWidth: 360 }}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {notice !== '' && <div role="status" style={warn}>{t('rules.catalog.customOnly')}</div>}
      {groups.length === 0 && <p role="status" style={hint}>{t('rules.catalog.noResults')}</p>}
      {groups.map((group) => (
        <GroupBlock key={group.id} t={t} controller={controller} group={group} disabled={disabled} onChip={onChip} onGroup={onGroup} />
      ))}
      <CustomCode t={t} controller={controller} disabled={disabled} write={write} />
    </div>
  );
}
