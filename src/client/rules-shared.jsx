import { useEffect, useState } from 'react';
import { Input } from '@deepseek-ai/dsh-client-ui-primitives';
import { RULE_TARGETS } from '../core/rules.js';

export { fill } from './rules-view.js';

export const hint = { opacity: 0.65, fontSize: 12, marginTop: 4 };
export const warn = { color: 'var(--dsw-alias-text-warning, #b7791f)', fontSize: 12, marginTop: 4 };
export const card = { border: '1px solid var(--dsw-alias-border-default, rgba(127,127,127,.3))', borderRadius: 8, padding: 12, marginTop: 8 };
export const line = { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 };
export const select = { font: 'inherit', padding: '4px 6px', borderRadius: 6 };

/** A text field that edits a local draft and commits on blur / Enter. */
export function DraftInput({ value, onCommit, disabled, ...rest }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => { if (draft !== value) onCommit(draft); };
  return (
    <Input
      {...rest}
      value={draft}
      disabled={disabled}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') commit(); }}
    />
  );
}

export function CategorySelect({ t, value, onChange, disabled, label }) {
  return (
    <select aria-label={label} style={select} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
      {RULE_TARGETS.map((c) => <option key={c} value={c}>{t(`category.${c}`)}</option>)}
    </select>
  );
}
