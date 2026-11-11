import { Button } from '@deepseek-ai/dsh-client-ui-primitives';
import { CategorySelect, DraftInput, card, line, warn } from './rules-shared.jsx';
import { describeRule, fill } from './rules-view.js';

export const STATUS_LIST_ID = 'mfr-rule-status-options';
export const COMMON_STATUSES = [429, 400, 401, 402, 403, 404, 408, 409, 413, 422, 500, 502, 503, 504];

function Editor({ t, rule, disabled, update }) {
  return (
    <div style={{ marginTop: 8 }}>
      <div style={line}>
        <DraftInput
          aria-label={t('rules.status')}
          placeholder={t('rules.statusAny')}
          list={STATUS_LIST_ID}
          style={{ width: 110 }}
          value={rule.status ? String(rule.status) : ''}
          disabled={disabled}
          onCommit={(v) => { const n = Number.parseInt(v, 10); update({ status: Number.isInteger(n) && n > 0 ? n : 0 }); }}
        />
        <DraftInput
          aria-label={t('rules.code')}
          placeholder={t('rules.codeAny')}
          style={{ width: 170 }}
          value={rule.code}
          disabled={disabled}
          onCommit={(v) => update({ code: v.trim().toUpperCase() })}
        />
        <span aria-hidden="true">→</span>
        <CategorySelect t={t} label={t('rules.category')} value={rule.category} disabled={disabled} onChange={(category) => update({ category })} />
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
    </div>
  );
}

/** One rule: a summary line, with the advanced fields behind an Edit toggle. */
export function RuleRow({ t, rule, index, count, disabled, open, onToggle, actions }) {
  const update = (patch) => actions.update(index, patch);
  const panelId = `mfr-rule-${index}-editor`;
  return (
    <div style={card} data-rule-index={index}>
      <div style={line}>
        <span style={{ minWidth: 24 }}>{index + 1}.</span>
        <span style={{ flex: 1, minWidth: 160, fontFamily: rule.regex ? 'monospace' : undefined }}>{describeRule(t, rule)}</span>
        <Button
          variant="ghost"
          size="sm"
          aria-expanded={open}
          aria-controls={panelId}
          aria-label={fill(t('rules.editRule'), { n: index + 1 })}
          onClick={onToggle}
        >
          {open ? t('rules.collapse') : t('rules.edit')}
        </Button>
        <Button variant="ghost" size="sm" disabled={disabled || index === 0} onClick={() => actions.move(index, -1)}>{t('rules.up')}</Button>
        <Button variant="ghost" size="sm" disabled={disabled || index === count - 1} onClick={() => actions.move(index, 1)}>{t('rules.down')}</Button>
        <Button variant="ghost" size="sm" disabled={disabled} onClick={() => actions.duplicate(index)}>{t('rules.duplicate')}</Button>
        <Button variant="ghost" size="sm" disabled={disabled} onClick={() => actions.remove(index)}>{t('rules.remove')}</Button>
      </div>
      {rule.error === 'invalid-regex' && <div role="alert" style={warn}>{t('rules.invalidRegex')}</div>}
      <div id={panelId} hidden={!open}>
        {open && <Editor t={t} rule={rule} disabled={disabled} update={update} />}
      </div>
    </div>
  );
}
