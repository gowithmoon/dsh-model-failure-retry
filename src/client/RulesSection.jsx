import { useEffect, useState, useSyncExternalStore } from 'react';
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives';
import { RULE_TARGETS } from '../core/rules.js';

const hint = { opacity: 0.65, fontSize: 12, marginTop: 4 };
const warn = { color: 'var(--dsw-alias-text-warning, #b7791f)', fontSize: 12, marginTop: 4 };
const card = { border: '1px solid var(--dsw-alias-border-default, rgba(127,127,127,.3))', borderRadius: 8, padding: 12, marginTop: 8 };
const line = { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 };
const select = { font: 'inherit', padding: '4px 6px', borderRadius: 6 };

/** A text field that edits a local draft and commits on blur / Enter. */
function DraftInput({ value, onCommit, disabled, ...rest }) {
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

function CategorySelect({ t, value, onChange, disabled, label }) {
  return (
    <select aria-label={label} style={select} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
      {RULE_TARGETS.map((c) => <option key={c} value={c}>{t(`category.${c}`)}</option>)}
    </select>
  );
}

function RuleRow({ t, rule, index, count, disabled, controller, write }) {
  const update = (patch) => write(controller.update(index, patch));
  return (
    <div style={card} data-rule-index={index}>
      <div style={line}>
        <span style={{ minWidth: 24 }}>{index + 1}.</span>
        <DraftInput
          aria-label={t('rules.status')}
          placeholder={t('rules.statusAny')}
          style={{ width: 90 }}
          value={rule.status ? String(rule.status) : ''}
          disabled={disabled}
          onCommit={(v) => { const n = Number.parseInt(v, 10); update({ status: Number.isInteger(n) && n > 0 ? n : 0 }); }}
        />
        <DraftInput
          aria-label={t('rules.code')}
          placeholder={t('rules.codeAny')}
          style={{ width: 150 }}
          value={rule.code}
          disabled={disabled}
          onCommit={(v) => update({ code: v.trim().toUpperCase() })}
        />
        <span>→</span>
        <CategorySelect t={t} label={t('rules.category')} value={rule.category} disabled={disabled} onChange={(category) => update({ category })} />
        <span style={{ flex: 1 }} />
        <Button variant="ghost" size="sm" disabled={disabled || index === 0} onClick={() => write(controller.move(index, -1))}>{t('rules.up')}</Button>
        <Button variant="ghost" size="sm" disabled={disabled || index === count - 1} onClick={() => write(controller.move(index, 1))}>{t('rules.down')}</Button>
        <Button variant="ghost" size="sm" disabled={disabled} onClick={() => write(controller.remove(index))}>{t('rules.remove')}</Button>
      </div>
      <div style={{ ...line, marginTop: 8 }}>
        <DraftInput
          aria-label={t('rules.pattern')}
          placeholder={rule.regex ? t('rules.regexPlaceholder') : t('rules.keywordsPlaceholder')}
          style={{ flex: 1, minWidth: 200, fontFamily: rule.regex ? 'monospace' : undefined }}
          value={rule.pattern}
          disabled={disabled}
          onCommit={(pattern) => update({ pattern })}
        />
        <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <input type="checkbox" checked={rule.regex} disabled={disabled} onChange={(e) => update({ regex: e.target.checked })} />
          {t('rules.regex')}
        </label>
      </div>
      {rule.error === 'invalid-regex' && <div role="alert" style={warn}>{t('rules.invalidRegex')}</div>}
    </div>
  );
}

function TestBox({ t, controller }) {
  const [status, setStatus] = useState('429');
  const [message, setMessage] = useState('');
  const result = controller.test({ status, message });
  let text;
  if (result.category === undefined) text = t('rules.testNone');
  else {
    const category = t(`category.${result.reason ?? result.category}`);
    text = result.ruleIndex === undefined
      ? t('rules.testByCode').replace('{category}', category)
      : t('rules.testByRule').replace('{category}', category).replace('{rule}', String(result.ruleIndex + 1));
  }
  return (
    <div style={card}>
      <div>{t('rules.test')}</div>
      <div style={{ ...line, marginTop: 8 }}>
        <Input aria-label={t('rules.status')} placeholder={t('rules.status')} style={{ width: 90 }} value={status} onChange={(e) => setStatus(e.target.value)} />
        <Input aria-label={t('rules.testMessage')} placeholder={t('rules.testMessage')} style={{ flex: 1, minWidth: 200 }} value={message} onChange={(e) => setMessage(e.target.value)} />
      </div>
      <div aria-live="polite" style={{ marginTop: 8 }}>{text}</div>
    </div>
  );
}

/** Classification rules: ordered list (first hit wins), restore defaults, test box. */
export function RulesSection({ t, controller }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const [failed, setFailed] = useState(false);
  const write = (promise) => {
    setFailed(false);
    promise.then((ok) => setFailed(!ok), () => setFailed(true));
  };
  const disabled = !state.writable;
  return (
    <div style={{ padding: '12px 0' }}>
      <div style={{ ...line, justifyContent: 'space-between' }}>
        <div>
          <div>{t('rules.title')}</div>
          <div style={hint}>{t('rules.hint')}</div>
        </div>
        <div style={line}>
          <Button variant="outline" size="sm" disabled={disabled} onClick={() => write(controller.add())}>{t('rules.add')}</Button>
          <Button variant="outline" size="sm" disabled={disabled} onClick={() => write(controller.restoreDefaults())}>{t('rules.restore')}</Button>
        </div>
      </div>
      {failed && <p role="alert" style={hint}>{t('saveFailed')}</p>}
      {state.rules.length === 0 && <p style={hint}>{t('rules.empty')}</p>}
      {state.rules.map((rule, index) => (
        <RuleRow key={index} t={t} rule={rule} index={index} count={state.rules.length} disabled={disabled} controller={controller} write={write} />
      ))}
      <TestBox t={t} controller={controller} />
    </div>
  );
}
