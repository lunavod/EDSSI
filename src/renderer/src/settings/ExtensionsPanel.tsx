import { useCallback, useEffect, useState } from 'react';

import { type ExtensionInfo, type ExtensionsView, needsRestart } from '../../../shared/extensions';
import { useEdssi } from '../api/context';
import { Toggle } from './FieldRow';

const DOCS_URL = 'https://github.com/lunavod/EDSSI/blob/main/docs/extensions.md';

/**
 * Every extension (see `src/main/extensions.ts`), built in or installed, each turned on or off
 * from the next start: an extension adds settings, pages and IPC as EDSSI starts, so nothing short
 * of a restart takes one out or puts one in. Written straight through to `extensions.json`, not
 * held as a draft, as the binding panels are.
 */
export function ExtensionsPanel() {
  const edssi = useEdssi();
  const [view, setView] = useState<ExtensionsView>();
  const [problem, setProblem] = useState<string>();

  const run = useCallback(async (action: () => Promise<ExtensionsView | void>) => {
    setProblem(undefined);
    try {
      const next = await action();
      if (next) setView(next);
    } catch (error) {
      // Electron wraps a handler's error as "Error invoking remote method '…': Error: <message>".
      const message = error instanceof Error ? error.message : String(error);
      setProblem(message.replace(/^Error invoking remote method '[^']*': (?:Error: )?/, ''));
    }
  }, []);

  useEffect(() => {
    edssi.extensions.list().then(setView, (error: unknown) => {
      setProblem(error instanceof Error ? error.message : String(error));
    });
  }, [edssi]);

  if (!view) {
    return problem ? (
      <p className="settings-problem">The extensions can’t be listed: {problem}</p>
    ) : (
      <p className="settings-help">Listing the extensions…</p>
    );
  }
  const restart = view.extensions.some(needsRestart);

  return (
    <div className="settings-panel">
      <p className="settings-help">
        Extensions add features from outside EDSSI: settings, Route tab pages, tools for the
        assistant. Built-in ones were compiled into this build; installed ones were built on their
        own and put in the folder below, where any build of EDSSI loads them. Turning one on or off
        takes effect when EDSSI starts again.
      </p>

      {view.extensions.length === 0 ? (
        <p className="settings-help">No extensions are built in or installed.</p>
      ) : (
        view.extensions.map((extension) => (
          <ExtensionRow
            key={`${extension.source}/${extension.name}`}
            extension={extension}
            onToggle={(enabled) =>
              void run(() => edssi.extensions.setEnabled(extension.name, enabled))
            }
          />
        ))
      )}

      {view.problems.map((line) => (
        <p key={line} className="settings-problem">
          Not loaded: {line}
        </p>
      ))}

      {restart && (
        <div className="settings-status" data-tone="busy">
          <span className="settings-status-dot" aria-hidden="true" />
          <span className="grow">Restart EDSSI for the change to take effect.</span>
          <button
            type="button"
            className="btn sm"
            onClick={() => void run(() => edssi.extensions.restart())}
          >
            Restart now
          </button>
        </div>
      )}

      <div className="settings-actions ext-actions">
        <span className="micro">Installed extensions</span>
        <span className="ext-path" title={view.folder}>
          {view.folder}
        </span>
        <button
          type="button"
          className="btn ghost sm"
          onClick={() => void run(() => edssi.extensions.openFolder())}
        >
          Open folder
        </button>
        <a className="link" href={DOCS_URL} target="_blank" rel="noreferrer">
          Writing and installing extensions ›
        </a>
      </div>

      {problem && <p className="settings-problem">{problem}</p>}
    </div>
  );
}

const STATE_NOTES: Record<ExtensionInfo['state'], string | undefined> = {
  running: undefined,
  disabled: 'Turned off.',
  failed: 'Failed to load.',
  shadowed: 'Left out: one of the same name is built in.',
};

function ExtensionRow({
  extension,
  onToggle,
}: {
  extension: ExtensionInfo;
  onToggle: (enabled: boolean) => void;
}) {
  const { name, source, state, enabled, folder, problem } = extension;
  const note = [STATE_NOTES[state], problem].filter(Boolean).join(' ');
  const id = `extension-${source}-${name}`;
  return (
    <div className={state === 'running' ? 'sf' : 'sf inactive'}>
      <div className="sf-l">
        <label className="sf-name ext-name" htmlFor={id}>
          {name}
          <span className={source === 'built-in' ? 'tag' : 'tag ghost'}>
            {source === 'built-in' ? 'Built in' : 'Installed'}
          </span>
        </label>
        {folder !== undefined && (
          <div className="sf-help ext-path" title={folder}>
            {folder}
          </div>
        )}
        {note && <div className={state === 'failed' ? 'sf-problem' : 'sf-note'}>{note}</div>}
      </div>
      <div className="sf-c">
        {state !== 'shadowed' && <Toggle id={id} on={enabled} onChange={onToggle} />}
      </div>
    </div>
  );
}
