import { useSyncExternalStore } from 'react';
import { Switch } from '@deepseek-ai/dsh-client-ui-primitives';
import { DraftField } from './PolicySection.jsx';
import { parseMinutes } from './switch-back-controller.js';

const hint = { opacity: 0.65, fontSize: 12, marginTop: 4 };
const heading = { fontWeight: 600, marginTop: 20 };
const row = { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, padding: '12px 0' };
const label = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, maxWidth: 220 };

/** Switch-back (回切, #9): toggle and interval in minutes. */
export function SwitchBackSection({ t, controller, write, disabled }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const off = disabled || !state.writable;
  return (
    <div>
      <div style={heading}>{t('switchBack.title')}</div>
      <div style={row}>
        <div>
          <div id="mfr-switch-back">{t('switchBack.enabled')}</div>
          <div style={hint}>{t('switchBack.hint')}</div>
        </div>
        <Switch checked={state.enabled} disabled={off} label={t('switchBack.enabled')} onChange={(on) => write(controller.setEnabled(on))} />
      </div>
      <label style={label}>
        <span>{t('switchBack.interval')}</span>
        <DraftField
          id="mfr-switch-back-interval"
          text={String(state.intervalMs / 60_000)}
          parse={parseMinutes}
          disabled={off || !state.enabled}
          invalidText={t('switchBack.intervalInvalid')}
          onCommit={(ms) => write(controller.setIntervalMs(ms))}
        />
      </label>
    </div>
  );
}
