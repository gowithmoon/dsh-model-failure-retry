import { useState } from 'react';
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives';
import { DEFAULT_CUSTOM_CATEGORY, isValidCode, normalizeCode, presetOf } from '../core/rule-presets.js';
import { CategorySelect, card, fill, hint, line, warn } from './rules-shared.jsx';
import { filterCatalog } from './rules-view.js';

const AMBER = 'var(--dsw-alias-state-warn, #c78421)';
const PRIMARY = 'var(--dsw-alias-state-business-primary, #3867d6)';

function chipStyle(selected, useless, disabled) {
  const accent = useless ? AMBER : PRIMARY;
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
    border: `1px solid ${useless ? AMBER : 'var(--dsw-alias-border-default, rgba(127,127,127,.4))'}`,
    background: selected ? accent : 'transparent',
    color: selected ? '#fff' : 'inherit',
    fontWeight: selected ? 600 : 400,
  };
}

function Chip({ t, code, selected, disabled, onClick }) {
  const preset = presetOf(code);
  const useless = preset.retryUseless;
  const desc = t(preset.descKey);
  const title = fill(t('rules.catalog.chipTitle'), { code, category: t(`category.${preset.category}`), desc })
    + (useless ? ` (${t('rules.catalog.retryUseless')})` : '');
  return (
    <button type="button" aria-pressed={selected} title={title} disabled={disabled} style={chipStyle(selected, useless, disabled)} onClick={onClick}>
      {useless && <span aria-hidden="true" style={{ width: 6, height: 6, borderRadius: '50%', background: selected ? '#fff' : AMBER }} />}
      {selected && <span aria-hidden="true">✓</span>}
      <span>{code}</span>
      {useless && <span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>{t('rules.catalog.retryUseless')}</span>}
    </button>
  );
}

function GroupBlock({ t, controller, group, disabled, onChip, onGroup }) {
  const label = t(group.labelKey);
  const selected = group.all.filter((code) => controller.hasCode(code)).length;
  return (
    <div style={{ marginTop: 12 }} role="group" aria-label={label}>
      <div style={line}>
        <strong>{label}</strong>
        <span style={hint}>{t(group.noteKey)}</span>
        <span style={{ ...hint, marginTop: 0 }}>{fill(t('rules.catalog.selected'), { n: selected })}</span>
        <span style={{ flex: 1 }} />
        <Button variant="ghost" size="sm" disabled={disabled} aria-label={fill(t('rules.catalog.addGroupLabel'), { group: label })} onClick={() => onGroup(group.id, true)}>
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
