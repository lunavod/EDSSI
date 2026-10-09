import { useEffect, useState } from 'react';

import type { UpdateState, WhatsNew } from '../../../shared/updates';
import { formatShortTime } from '../journal/format';
import { WhatsNewDialog } from './WhatsNew';

/** The Settings tab's About page: the version running, updating it, and the release notes. */
export function UpdatesPanel({ state }: { state: UpdateState | undefined }) {
  const [whatsNew, setWhatsNew] = useState<WhatsNew>();
  const [showNotes, setShowNotes] = useState(false);
  useEffect(() => {
    void window.edssi.updates.getWhatsNew().then(setWhatsNew);
  }, []);

  return (
    <div className="settings-panel">
      <p className="settings-help">
        EDSSI {whatsNew?.running ?? ''}. Updates download in the background and install the next
        time EDSSI starts, or straight away with Restart.
      </p>
      <StatusLine state={state} />
      <div className="settings-actions">
        {state?.status === 'ready' ? (
          <button
            type="button"
            className="btn primary sm"
            onClick={() => void window.edssi.updates.install()}
          >
            Restart and update to {state.version}
          </button>
        ) : (
          state?.status !== 'unsupported' && (
            <button
              type="button"
              className="btn ghost sm"
              disabled={state?.status === 'checking' || state?.status === 'downloading'}
              onClick={() => void window.edssi.updates.check()}
            >
              Check for updates
            </button>
          )
        )}
        {whatsNew && whatsNew.all.length > 0 && (
          <button type="button" className="link" onClick={() => setShowNotes(true)}>
            What’s new
          </button>
        )}
      </div>
      {showNotes && whatsNew && (
        <WhatsNewDialog notes={whatsNew.all} onClose={() => setShowNotes(false)} />
      )}
    </div>
  );
}

function StatusLine({ state }: { state: UpdateState | undefined }) {
  if (!state) return null;
  switch (state.status) {
    case 'unsupported':
      return <p className="settings-help">Running from source: only an installed EDSSI updates.</p>;
    case 'checking':
      return <p className="settings-help">Checking for updates…</p>;
    case 'downloading':
      return (
        <p className="settings-help">
          Downloading {state.version}… {state.percent}%
        </p>
      );
    case 'ready':
      return <p className="settings-help">{state.version} is downloaded and ready to install.</p>;
    case 'idle':
      if (state.problem) {
        return <p className="settings-problem">The last check failed: {state.problem}</p>;
      }
      return (
        <p className="settings-help">
          {state.checkedAt
            ? `Up to date (checked ${formatShortTime(state.checkedAt)}).`
            : 'Not checked yet.'}
        </p>
      );
  }
}
