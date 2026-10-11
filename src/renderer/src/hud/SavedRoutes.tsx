import { useState } from 'react';

import {
  type CsvRoute,
  type CsvRouteState,
  SAVED_ROUTE_NAME_LENGTH,
  type SavedRouteSummary,
} from '../../../shared/csv-route';
import { useEdssi } from '../api/context';
import { Glyph } from './Glyph';

/** What is waiting for the commander's yes. */
type Confirm = { kind: 'load' | 'delete'; route: SavedRouteSummary };

/**
 * Routes saved under a name, one button each, to switch the followed route between them: a
 * carrier's long trip put aside for a survey of one stop, and taken up again where it was left.
 * The route loaded is saved as it goes, so its place along it is never lost.
 */
export function SavedRoutes({ state }: { state: CsvRouteState | undefined }) {
  const edssi = useEdssi();
  const saved = state?.saved ?? [];
  const route = state?.route;
  const current = saved.find((entry) => entry.id === route?.savedId);
  const [naming, setNaming] = useState<'save' | 'rename'>();
  const [confirm, setConfirm] = useState<Confirm>();
  const [problem, setProblem] = useState<string>();

  if (!route && saved.length === 0) return null;

  const load = (entry: SavedRouteSummary) => {
    setConfirm(undefined);
    void edssi.csvRoute.loadSaved(entry.id).then(setProblem);
  };
  const pick = (entry: SavedRouteSummary) => {
    if (entry.id === current?.id) return;
    // Loading another loses a route that isn't saved; one that is keeps its place.
    if (route && !current) setConfirm({ kind: 'load', route: entry });
    else load(entry);
  };

  return (
    <div className="saved-routes">
      <div className="saved-bar">
        <span className="micro">Saved routes</span>
        {saved.length === 0 ? (
          <span className="hint">None yet. Save this one to come back to it later.</span>
        ) : (
          <div className="chips">
            {saved.map((entry) => (
              <span key={entry.id} className="saved-chip">
                <button
                  type="button"
                  className="chip"
                  aria-pressed={entry.id === current?.id}
                  title={`${entry.fileName}: ${entry.systems} systems${entry.id === current?.id ? ', following it' : ', load it and carry on'}`}
                  onClick={() => pick(entry)}
                >
                  {entry.name}
                  <span className="n">
                    {entry.position ?? 0} / {Math.max(0, entry.systems - 1)}
                  </span>
                </button>
                <button
                  type="button"
                  className="saved-x"
                  title={`Delete ${entry.name}`}
                  aria-label={`Delete ${entry.name}`}
                  onClick={() => setConfirm({ kind: 'delete', route: entry })}
                >
                  <span className="ic-w">
                    <Glyph name="close" />
                  </span>
                </button>
              </span>
            ))}
          </div>
        )}
        <span className="saved-actions">
          {route && !naming && (
            <>
              {current && (
                <button type="button" className="link" onClick={() => setNaming('rename')}>
                  Rename
                </button>
              )}
              <button
                type="button"
                className={current ? 'btn ghost sm' : 'btn sm'}
                title={
                  current
                    ? 'Save this route under another name as well'
                    : 'Save this route under a name, to switch back to it later'
                }
                onClick={() => setNaming('save')}
              >
                <span className="ic-w">
                  <Glyph name="pin" />
                </span>
                {current ? 'Save as' : 'Save'}
              </button>
            </>
          )}
        </span>
      </div>
      {route && naming && (
        <RouteNameForm
          key={naming}
          initial={naming === 'rename' && current ? current.name : defaultName(route)}
          saved={saved}
          renaming={naming === 'rename' ? current : undefined}
          onSubmit={(name) =>
            naming === 'rename' && current
              ? edssi.csvRoute.renameSaved(current.id, name)
              : edssi.csvRoute.save(name)
          }
          onDone={(result) => {
            setProblem(result);
            if (result === undefined) setNaming(undefined);
          }}
          onCancel={() => {
            setProblem(undefined);
            setNaming(undefined);
          }}
        />
      )}
      {confirm && (
        <p className="note" role="alert">
          <span className="ic-w">
            <Glyph name="warning" />
          </span>
          <span className="grow">
            {confirm.kind === 'load'
              ? `The route loaded now isn't saved; loading ${confirm.route.name} loses it.`
              : `Delete the saved route ${confirm.route.name}?${confirm.route.id === current?.id ? ' It stays loaded, unsaved.' : ''}`}
          </span>
          {confirm.kind === 'load' && (
            <button
              type="button"
              className="link"
              onClick={() => {
                setConfirm(undefined);
                setNaming('save');
              }}
            >
              Save it first
            </button>
          )}
          <button
            type="button"
            className="link"
            onClick={() => {
              if (confirm.kind === 'load') load(confirm.route);
              else {
                setConfirm(undefined);
                void edssi.csvRoute.deleteSaved(confirm.route.id);
              }
            }}
          >
            {confirm.kind === 'load' ? 'Load anyway' : 'Delete'}
          </button>
          <button type="button" className="link" onClick={() => setConfirm(undefined)}>
            Cancel
          </button>
        </p>
      )}
      {problem && (
        <p className="note danger" role="alert">
          <span className="ic-w">
            <Glyph name="warning" />
          </span>
          {problem}
        </p>
      )}
    </div>
  );
}

/** The name a route is offered to be saved under: its file's, without the extension. */
function defaultName(route: CsvRoute): string {
  return route.fileName.replace(/\.csv$/i, '').slice(0, SAVED_ROUTE_NAME_LENGTH);
}

/**
 * The name to save a route under, or a saved one's new name. Also for a route made elsewhere (an
 * extension's), saved without being loaded.
 */
export function RouteNameForm({
  initial,
  saved,
  renaming,
  onSubmit,
  onDone,
  onCancel,
}: {
  initial: string;
  saved: readonly SavedRouteSummary[];
  /** The saved route being renamed; unset to save a route. */
  renaming?: SavedRouteSummary | undefined;
  /** Saves or renames under the name; resolves with why it couldn't. */
  onSubmit: (name: string) => Promise<string | undefined>;
  onDone: (problem: string | undefined) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial);
  const trimmed = name.trim().toLowerCase();
  const taken = saved.find(
    (entry) => entry.name.toLowerCase() === trimmed && entry.id !== renaming?.id,
  );
  return (
    <form
      className="saved-form"
      onSubmit={(event) => {
        event.preventDefault();
        void onSubmit(name).then(onDone);
      }}
    >
      <label className="input sm grow">
        <input
          // It opens because the commander asked to name the route; the name is what's next.
          // oxlint-disable-next-line jsx-a11y/no-autofocus
          autoFocus
          aria-label="Route name"
          placeholder="Name the route"
          maxLength={SAVED_ROUTE_NAME_LENGTH}
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') onCancel();
          }}
        />
      </label>
      {taken && !renaming && <span className="hint">Replaces the saved {taken.name}</span>}
      <button
        type="submit"
        className="btn sm"
        disabled={trimmed === '' || (renaming !== undefined && taken !== undefined)}
      >
        {renaming ? 'Rename' : taken ? 'Replace' : 'Save'}
      </button>
      <button type="button" className="link" onClick={onCancel}>
        Cancel
      </button>
    </form>
  );
}
