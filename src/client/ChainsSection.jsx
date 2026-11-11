import { useEffect, useState, useSyncExternalStore } from 'react';
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives';

const hint = { opacity: 0.65, fontSize: 12, marginTop: 4 };
const warn = { color: 'var(--dsw-alias-text-warning, #b7791f)', fontSize: 12, marginTop: 4 };
const card = { border: '1px solid var(--dsw-alias-border-default, rgba(127,127,127,.3))', borderRadius: 8, padding: 12, marginTop: 8 };
const line = { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 };
const select = { font: 'inherit', padding: '4px 6px', borderRadius: 6, maxWidth: 220 };

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

/**
 * provider → model dropdowns. A stored value missing from the catalog stays
 * selectable (marked), so a missing entry can still be saved as is.
 */
function ModelPicker({ t, catalog, value, disabled, onChange }) {
  const providers = catalog.providers.map((p) => ({ id: p.id, name: p.name }));
  if (value.provider && !providers.some((p) => p.id === value.provider)) providers.push({ id: value.provider, name: `${value.provider} (${t('chains.missingTag')})` });
  const models = catalog.modelsOf(value.provider);
  if (value.model && !models.some((m) => m.id === value.model)) models.push({ id: value.model, name: `${value.model} (${t('chains.missingTag')})` });
  return (
    <>
      <select
        aria-label={t('chains.provider')}
        style={select}
        value={value.provider}
        disabled={disabled}
        onChange={(e) => {
          const provider = e.target.value;
          onChange({ provider, model: catalog.modelsOf(provider)[0]?.id ?? '' });
        }}
      >
        {!value.provider && <option value="">{t('chains.pickProvider')}</option>}
        {providers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      <select
        aria-label={t('chains.model')}
        style={select}
        value={value.model}
        disabled={disabled || !value.provider}
        onChange={(e) => onChange({ provider: value.provider, model: e.target.value })}
      >
        {!value.model && <option value="">{t('chains.pickModel')}</option>}
        {models.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
      </select>
    </>
  );
}

function CandidateRow({ t, catalog, candidate, chainIndex, index, count, disabled, controller, write }) {
  return (
    <div data-candidate-index={index} style={{ marginTop: 6 }}>
      <div style={line}>
        <span style={{ minWidth: 24 }}>{index + 1}.</span>
        <ModelPicker t={t} catalog={catalog} value={candidate} disabled={disabled} onChange={(next) => write(controller.setCandidate(chainIndex, index, next))} />
        <span style={{ flex: 1 }} />
        <Button variant="ghost" size="sm" disabled={disabled || index === 0} onClick={() => write(controller.moveCandidate(chainIndex, index, -1))}>{t('chains.up')}</Button>
        <Button variant="ghost" size="sm" disabled={disabled || index === count - 1} onClick={() => write(controller.moveCandidate(chainIndex, index, 1))}>{t('chains.down')}</Button>
        <Button variant="ghost" size="sm" disabled={disabled} onClick={() => write(controller.removeCandidate(chainIndex, index))}>{t('chains.remove')}</Button>
      </div>
      {candidate.missing && (
        <div role="alert" style={warn}>
          {t(candidate.missing === 'provider' ? 'chains.missingProvider' : 'chains.missingModel')}
        </div>
      )}
    </div>
  );
}

function ChainCard({ t, catalog, chain, index, count, disabled, controller, write }) {
  const first = catalog.providers[0]?.id ?? '';
  return (
    <div style={card} data-chain-index={index}>
      <div style={line}>
        <span style={{ minWidth: 24 }}>{index + 1}.</span>
        <DraftInput
          aria-label={t('chains.match')}
          placeholder={t('chains.matchPlaceholder')}
          style={{ width: 220, fontFamily: 'monospace' }}
          value={chain.match}
          disabled={disabled}
          onCommit={(v) => write(controller.setMatch(index, v))}
        />
        <span style={{ flex: 1 }} />
        <Button variant="ghost" size="sm" disabled={disabled || index === 0} onClick={() => write(controller.move(index, -1))}>{t('chains.up')}</Button>
        <Button variant="ghost" size="sm" disabled={disabled || index === count - 1} onClick={() => write(controller.move(index, 1))}>{t('chains.down')}</Button>
        <Button variant="ghost" size="sm" disabled={disabled} onClick={() => write(controller.remove(index))}>{t('chains.remove')}</Button>
      </div>
      {chain.error === 'empty-match' && <div role="alert" style={warn}>{t('chains.emptyMatch')}</div>}
      <div style={{ ...hint, marginTop: 8 }}>{t('chains.candidates')}</div>
      {chain.candidates.length === 0 && <div style={hint}>{t('chains.noCandidates')}</div>}
      {chain.candidates.map((candidate, at) => (
        <CandidateRow
          key={at}
          t={t}
          catalog={catalog}
          candidate={candidate}
          chainIndex={index}
          index={at}
          count={chain.candidates.length}
          disabled={disabled}
          controller={controller}
          write={write}
        />
      ))}
      <div style={{ marginTop: 8 }}>
        <Button
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={() => write(controller.addCandidate(index, { provider: first, model: catalog.modelsOf(first)[0]?.id ?? '' }))}
        >
          {t('chains.addCandidate')}
        </Button>
      </div>
    </div>
  );
}

/** Fallback chains: ordered list (first matching chain wins), each with ordered candidates. */
export function ChainsSection({ t, controller, disabled: off }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  useEffect(() => { controller.refreshCatalog(); }, [controller]);
  const [failed, setFailed] = useState(false);
  const write = (promise) => {
    setFailed(false);
    promise.then((ok) => setFailed(!ok), () => setFailed(true));
  };
  const disabled = off || !state.writable;
  const { catalog } = state;
  return (
    <div style={{ padding: '12px 0' }}>
      <div style={{ ...line, justifyContent: 'space-between' }}>
        <div>
          <div>{t('chains.title')}</div>
          <div style={hint}>{t('chains.hint')}</div>
        </div>
        <Button variant="outline" size="sm" disabled={disabled} onClick={() => write(controller.add())}>{t('chains.add')}</Button>
      </div>
      {failed && <p role="alert" style={hint}>{t('saveFailed')}</p>}
      {catalog.status === 'error' && <p style={warn}>{t('chains.catalogFailed')}</p>}
      {state.chains.length === 0 && <p style={hint}>{t('chains.empty')}</p>}
      {state.chains.map((chain, index) => (
        <ChainCard key={index} t={t} catalog={catalog} chain={chain} index={index} count={state.chains.length} disabled={disabled} controller={controller} write={write} />
      ))}
    </div>
  );
}
