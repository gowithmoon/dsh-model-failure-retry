import { useState, useSyncExternalStore } from 'react';
import { Switch } from '@deepseek-ai/dsh-client-ui-primitives';

const row = { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, padding: '12px 0' };
const hint = { opacity: 0.65, fontSize: 12, marginTop: 4 };

function ToggleRow({ id, label, hintText, checked, disabled, onChange }) {
  return (
    <div style={row}>
      <div>
        <div id={id}>{label}</div>
        <div style={hint}>{hintText}</div>
      </div>
      <Switch checked={checked} disabled={disabled} label={label} onChange={onChange} />
    </div>
  );
}

/**
 * The plugin's settings section. Sub-sections from later tickets go below the
 * switches in spec order: policy → timeline → chains → rules → switch-back → stats.
 */
export function Section({ t, controller }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const [failed, setFailed] = useState(false);
  const write = (promise) => {
    setFailed(false);
    promise.then((ok) => setFailed(!ok), () => setFailed(true));
  };

  if (state.status === 'unavailable') return <p>{t('unavailable')}</p>;
  const disabled = !state.writable;
  return (
    <div>
      <p style={hint}>{t('description')}</p>
      {state.status === 'loading' && <p style={hint}>{t('loading')}</p>}
      {state.status === 'ready' && !state.writable && <p style={hint}>{t('readOnly')}</p>}
      {failed && <p role="alert" style={hint}>{t('saveFailed')}</p>}
      <ToggleRow
        id="mfr-enabled"
        label={t('enabled')}
        hintText={t('enabledHint')}
        checked={state.enabled}
        disabled={disabled}
        onChange={(on) => write(controller.setEnabled(on))}
      />
      <ToggleRow
        id="mfr-rate-limit"
        label={t('rateLimit')}
        hintText={t('rateLimitHint')}
        checked={state.categories['rate-limit']}
        disabled={disabled || !state.enabled}
        onChange={(on) => write(controller.setCategory('rate-limit', on))}
      />
      <ToggleRow
        id="mfr-transient"
        label={t('transient')}
        hintText={t('transientHint')}
        checked={state.categories.transient}
        disabled={disabled || !state.enabled}
        onChange={(on) => write(controller.setCategory('transient', on))}
      />
    </div>
  );
}
