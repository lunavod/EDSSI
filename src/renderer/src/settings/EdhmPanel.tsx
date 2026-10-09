import { useCallback, useEffect, useState } from 'react';

import type { FssOverlayInstallResult, FssOverlayStatus, HudColor } from '../../../shared/edhm';

interface EdhmPanelProps {
  hud: HudColor | null | undefined;
  /** `display.match_hud_color` as saved. */
  matching: boolean;
}

/**
 * EDHM: the theme colour EDSSI is wearing, and the FSS Exobio Overlay, an EDHM mod marking the FSS
 * bands where bodies that can have life show up. One button installs it, with whatever it takes
 * (see `src/main/edhm/fss-overlay.ts`).
 */
export function EdhmPanel({ hud, matching }: EdhmPanelProps) {
  const [status, setStatus] = useState<FssOverlayStatus>();
  const [installing, setInstalling] = useState(false);
  const [result, setResult] = useState<FssOverlayInstallResult>();
  const [problem, setProblem] = useState<string>();

  const refresh = useCallback(() => {
    window.edssi.edhm.getFssOverlay().then(setStatus, (error: unknown) => {
      setProblem(error instanceof Error ? error.message : String(error));
    });
  }, []);

  useEffect(refresh, [refresh]);

  const install = useCallback(async () => {
    setInstalling(true);
    setProblem(undefined);
    setResult(undefined);
    try {
      const next = await window.edssi.edhm.installFssOverlay();
      setResult(next);
      setStatus(next.status);
    } catch (error) {
      // Electron wraps a handler's error as "Error invoking remote method '…': Error: <message>".
      const message = error instanceof Error ? error.message : String(error);
      setProblem(message.replace(/^Error invoking remote method '[^']*': (?:Error: )?/, ''));
      refresh();
    } finally {
      setInstalling(false);
    }
  }, [refresh]);

  return (
    <div className="settings-panel">
      <HudColorLine hud={hud} matching={matching} status={status} />

      <h3 className="settings-subtitle">FSS exobiology overlay</h3>
      <p className="settings-help">
        An EDHM mod that marks the bands of the Full Spectrum Scanner where bodies that can have
        life show up: metal rich, high metal content, rocky, icy and rocky ice. It draws through the
        shaders of EDHM’s FSS-Overlay mod, which is downloaded from EDHM if it isn’t there, and
        takes that mod’s place.
      </p>

      <StatusLine status={status} />

      {status?.state === 'ready' && (
        <div className="settings-actions">
          <button
            type="button"
            className="btn ghost sm"
            disabled={installing}
            onClick={() => void install()}
          >
            {installing ? 'Installing…' : status.installed ? 'Reinstall' : 'Install'}
          </button>
          <button type="button" className="link" disabled={installing} onClick={refresh}>
            Check again
          </button>
        </div>
      )}
      {status?.state === 'no-edhm' && (
        <div className="settings-actions">
          <button type="button" className="link" onClick={refresh}>
            Check again
          </button>
        </div>
      )}

      {result && <ResultLine result={result} />}
      {problem && <p className="settings-problem">Installing failed: {problem}</p>}
    </div>
  );
}

function HudColorLine({ hud, matching, status }: EdhmPanelProps & { status?: FssOverlayStatus }) {
  if (hud) {
    return (
      <p className="settings-help hud-color-line">
        <span className="hud-color-swatch" style={{ background: hud.color }} aria-hidden="true" />
        EDSSI is drawn in {hud.theme ? `the ${hud.theme} theme’s` : 'the EDHM theme’s'} colour,{' '}
        {hud.color}.
      </p>
    );
  }
  if (!matching)
    return <p className="settings-help">Not matching the HUD colour (see Display above).</p>;
  if (status?.state === 'ready') {
    return <p className="settings-help">No EDHM theme with a colour of its own is applied.</p>;
  }
  return null;
}

function StatusLine({ status }: { status: FssOverlayStatus | undefined }) {
  if (!status) return <p className="settings-help">Looking for EDHM…</p>;
  if (status.state === 'no-edhm') return <p className="settings-problem">{status.message}</p>;

  const parts = [`EDHM found in ${status.gameDir}.`];
  if (status.installed && status.shaders && status.conflicts.length === 0) {
    parts.push('The overlay is installed.');
  } else {
    parts.push(status.installed ? 'The overlay is installed, but' : 'The overlay isn’t installed.');
    if (!status.shaders) parts.push('FSS-Overlay’s shaders are missing and will be downloaded.');
    if (status.conflicts.length > 0) {
      parts.push(`Installing switches off: ${status.conflicts.join(', ')}.`);
    }
  }
  const trouble = status.installed && (!status.shaders || status.conflicts.length > 0);
  return <p className={trouble ? 'settings-problem' : 'settings-help'}>{parts.join(' ')}</p>;
}

function ResultLine({ result }: { result: FssOverlayInstallResult }) {
  const parts = ['Installed.'];
  if (result.downloaded) parts.push('FSS-Overlay was downloaded for its shaders.');
  if (result.parked.length > 0) {
    parts.push(`Moved to 3rdPartyMods-disabled: ${result.parked.join(', ')}.`);
  }
  parts.push('It shows next time the game starts, or after F11 in game.');
  return <p className="settings-help">{parts.join(' ')}</p>;
}
