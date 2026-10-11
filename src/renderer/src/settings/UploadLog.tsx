import { useCallback, useEffect, useState } from 'react';

import type { UploadLogEntry } from '../../../shared/uploads';
import { useEdssi } from '../api/context';
import {
  formatDateTime,
  formatShortDateTime,
  formatShortTime,
  formatTime,
} from '../journal/format';

const LIMIT = 200;
const SERVICE: Record<UploadLogEntry['target'], string> = {
  edsm: 'EDSM',
  inara: 'Inara',
  eddn: 'EDDN',
};

/**
 * Every request made to EDSM, Inara and EDDN, newest first: what went, and what the service said. The
 * send-session script writes here too, from its own process, hence the refresh.
 */
export function UploadLog({ logVersion }: { logVersion: number | undefined }) {
  const edssi = useEdssi();
  const [entries, setEntries] = useState<UploadLogEntry[]>();
  const [problem, setProblem] = useState<string>();
  const [onlyProblems, setOnlyProblems] = useState(false);

  const load = useCallback(() => {
    edssi.uploads.getLog(LIMIT).then(
      (next) => {
        setEntries(next);
        setProblem(undefined);
      },
      (error: unknown) => setProblem(error instanceof Error ? error.message : String(error)),
    );
  }, [edssi]);

  // Fetched again whenever the live upload adds a request; before its first snapshot, not at all.
  useEffect(() => {
    if (logVersion !== undefined) load();
  }, [load, logVersion]);

  return (
    <div className="settings-panel">
      <div className="upload-log-bar">
        <fieldset className="seg">
          <legend className="visually-hidden">Which requests</legend>
          <button type="button" aria-pressed={!onlyProblems} onClick={() => setOnlyProblems(false)}>
            All
          </button>
          <button type="button" aria-pressed={onlyProblems} onClick={() => setOnlyProblems(true)}>
            Problems
          </button>
        </fieldset>
        <span className="hint grow">
          Newest first. “Script” rows came from <code>npm run send-session</code>.
        </span>
        <button type="button" className="link" onClick={load}>
          Refresh
        </button>
      </div>
      {problem && <p className="settings-problem">{problem}</p>}
      {entries?.length === 0 && <p className="settings-help">Nothing has been sent yet.</p>}
      {entries && entries.length > 0 && (
        <div className="upload-log">
          <div className="upload-log-head" aria-hidden="true">
            <span>When</span>
            <span>Service</span>
            <span>Outcome</span>
            <span>What</span>
          </div>
          <ol>
            {entries
              .filter((entry) => !onlyProblems || toneOf(entry) !== 'good')
              .map((entry) => (
                <UploadLogRow key={entry.id} entry={entry} />
              ))}
          </ol>
        </div>
      )}
    </div>
  );
}

function UploadLogRow({ entry }: { entry: UploadLogEntry }) {
  const counts = Object.entries(entry.eventCounts)
    .toSorted((a, b) => b[1] - a[1])
    .map(([event, count]) => (count > 1 ? `${event} ×${count}` : event))
    .join(', ');
  const tone = toneOf(entry);
  const today = new Date().toDateString() === new Date(entry.at).toDateString();

  return (
    <li className="upload-log-row" data-tone={tone}>
      <span title={formatDateTime(entry.at)}>
        {today ? formatShortTime(entry.at) : formatShortDateTime(entry.at)}
      </span>
      <span className="upload-log-service">
        {SERVICE[entry.target]}
        {entry.source === 'backfill' && ' · script'}
      </span>
      <span className="upload-log-outcome">{outcomeText(entry)}</span>
      <div className="col" style={{ minWidth: 0 }}>
        <div className="upload-log-what" title={counts}>
          {entry.events} {entry.events === 1 ? 'event' : 'events'}: {counts}
        </div>
        {entry.systems.length > 0 && (
          <div className="upload-log-detail" title={entry.systems.join(', ')}>
            {systemsText(entry.systems)} · played {formatDateTime(entry.firstEvent)}
            {entry.lastEvent !== entry.firstEvent && `–${formatTime(entry.lastEvent)}`}
          </div>
        )}
        {entry.message && entry.outcome !== 'sent' && (
          <div className="upload-log-detail">{entry.message}</div>
        )}
        {entry.refused.length > 0 && (
          <details className="upload-log-refused">
            <summary>{entry.refused.length} not taken</summary>
            <ul>
              {entry.refused.map((refused, index) => (
                // oxlint-disable-next-line react/no-array-index-key -- a fixed list, never reordered
                <li key={index}>
                  {refused.event}
                  {refused.code !== undefined && ` (${refused.code})`}: {refused.message || '—'}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </li>
  );
}

function toneOf(entry: UploadLogEntry): 'good' | 'warning' | 'danger' {
  if (entry.outcome === 'rejected' || entry.outcome === 'retry') return 'danger';
  return entry.refused.length > 0 || entry.accepted === 0 ? 'warning' : 'good';
}

function outcomeText(entry: UploadLogEntry): string {
  if (entry.outcome === 'retry') return 'Failed, will retry';
  if (entry.outcome === 'rejected') return 'Refused';
  const skipped = entry.skipped ? `, ${entry.skipped} not wanted` : '';
  return `${entry.accepted ?? 0} kept${skipped}`;
}

function systemsText(systems: readonly string[]): string {
  if (systems.length <= 2) return systems.join(', ');
  return `${systems[0]} … ${systems.at(-1)} (${systems.length} systems)`;
}
