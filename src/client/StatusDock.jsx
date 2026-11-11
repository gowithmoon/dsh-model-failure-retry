import { useEffect, useState } from 'react';
import { Button } from '@deepseek-ai/dsh-client-ui-primitives';
import { statusLine } from './status-line.js';
import { STATUS_PROJECTION } from '../status-projection-key.js';

const bar = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
  padding: '6px 12px', fontSize: 13, borderRadius: 8, opacity: 0.9,
};

/**
 * The in-session status line (#7) above the composer: the retry countdown or
 * the model switch, with a stop button that cancels the turn the way DSH's own
 * stop does (the Host then selects the original model back).
 */
export function StatusDock({ useProjection, useSession, onStop, t }) {
  const status = useProjection(STATUS_PROJECTION);
  const running = useSession((s) => s.running);
  const [now, setNow] = useState(() => Date.now());
  const line = statusLine(status, { now, running, t });
  const tick = line?.nextTickMs;
  useEffect(() => {
    if (!tick) return undefined;
    const id = setInterval(() => setNow(Date.now()), tick);
    setNow(Date.now());
    return () => clearInterval(id);
  }, [tick, status]);
  if (!line) return null;
  return (
    <div style={bar} role="status" aria-live="polite" data-model-failure-retry-status={line.kind}>
      <span>{line.text}</span>
      <Button variant="ghost" size="sm" title={t('status.stopHint')} onClick={() => { void onStop(); }}>
        {t('status.stop')}
      </Button>
    </div>
  );
}
