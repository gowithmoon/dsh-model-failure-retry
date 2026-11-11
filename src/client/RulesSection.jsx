import { useState, useSyncExternalStore } from 'react';
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives';
import { RuleCatalog } from './RuleCatalog.jsx';
import { COMMON_STATUSES, RuleRow, STATUS_LIST_ID } from './RuleRow.jsx';
import { card, fill, hint, line } from './rules-shared.jsx';

const EXAMPLES = [
  { id: 'daily', status: '429' },
  { id: 'rate', status: '429' },
  { id: 'context', status: '400' },
  { id: 'auth', status: '401' },
];

function resultText(t, result) {
  if (result.category === undefined) return t('rules.testNone');
  const category = t(`category.${result.reason ?? result.category}`);
  return result.ruleIndex === undefined
    ? fill(t('rules.testByCode'), { category })
    : fill(t('rules.testByRule'), { category, rule: result.ruleIndex + 1 });
}

function TestBox({ t, controller }) {
  const [status, setStatus] = useState('429');
  const [message, setMessage] = useState('');
  const result = controller.test({ status, message });
  const fillExample = ({ id, status: s }) => { setStatus(s); setMessage(t(`rules.example.${id}Message`)); };
  return (
    <div style={card}>
      <div>{t('rules.test')}</div>
      <div style={{ ...line, marginTop: 8 }}>
        <span style={hint}>{t('rules.examples')}</span>
        {EXAMPLES.map((example) => (
          <Button key={example.id} variant="outline" size="sm" onClick={() => fillExample(example)}>{t(`rules.example.${example.id}`)}</Button>
        ))}
      </div>
      <div style={{ ...line, marginTop: 8 }}>
        <Input aria-label={t('rules.status')} placeholder={t('rules.status')} style={{ width: 90 }} value={status} onChange={(e) => setStatus(e.target.value)} />
        <Input aria-label={t('rules.testMessage')} placeholder={t('rules.testMessage')} style={{ flex: 1, minWidth: 200 }} value={message} onChange={(e) => setMessage(e.target.value)} />
      </div>
      <div aria-live="polite" style={{ marginTop: 8 }}>{resultText(t, result)}</div>
    </div>
  );
}

/** Classification rules: error-code catalog, ordered rule list (first hit wins), restore defaults, test box. */
export function RulesSection({ t, controller }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(null);
  const write = (promise) => {
    setFailed(false);
    promise.then((ok) => setFailed(!ok), () => setFailed(true));
  };
  // Row indexes shift on structural edits, so those close the open editor.
  const structural = (promise) => { setOpen(null); write(promise); };
  const actions = {
    update: (index, patch) => write(controller.update(index, patch)),
    move: (index, delta) => { setOpen(null); write(controller.move(index, delta)); },
    remove: (index) => structural(controller.remove(index)),
    duplicate: (index) => structural(controller.duplicate(index)),
  };
  const disabled = !state.writable;
  return (
    <div style={{ padding: '12px 0' }}>
      <div style={{ ...line, justifyContent: 'space-between' }}>
        <div>
          <div>{t('rules.title')}</div>
          <div style={hint}>{t('rules.hint')}</div>
        </div>
        <Button variant="outline" size="sm" disabled={disabled} onClick={() => structural(controller.restoreDefaults())}>{t('rules.restore')}</Button>
      </div>
      {failed && <p role="alert" style={hint}>{t('saveFailed')}</p>}
      <datalist id={STATUS_LIST_ID}>
        {COMMON_STATUSES.map((s) => <option key={s} value={s} />)}
      </datalist>
      <RuleCatalog t={t} controller={controller} disabled={disabled} write={structural} />
      <div style={{ ...line, justifyContent: 'space-between', marginTop: 16 }}>
        <div>
          <div>{t('rules.list.title')}</div>
          <div style={hint}>{t('rules.addHint')}</div>
        </div>
        <Button variant="outline" size="sm" disabled={disabled} onClick={() => structural(controller.add())}>{t('rules.add')}</Button>
      </div>
      {state.rules.length === 0 && <p style={hint}>{t('rules.empty')}</p>}
      {state.rules.map((rule, index) => (
        <RuleRow
          key={index}
          t={t}
          rule={rule}
          index={index}
          count={state.rules.length}
          disabled={disabled}
          open={open === index}
          onToggle={() => setOpen(open === index ? null : index)}
          actions={actions}
        />
      ))}
      <TestBox t={t} controller={controller} />
    </div>
  );
}
