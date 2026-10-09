import { useDeferredValue, useState } from 'react';

import {
  gradeLabel,
  type MaterialsSnapshot,
  RECIPE_KINDS,
  type RecipeKind,
} from '../../../shared/materials';
import { Glyph } from '../hud/Glyph';
import { formatShortDateTime } from '../journal/format';
import { formatIngredients } from './materials';

/**
 * The Materials module's History page: what was crafted, newest first, runs of the same craft
 * folded into one line, with what each took.
 */
export function HistoryView({ snapshot }: { snapshot: MaterialsSnapshot | undefined }) {
  const [kind, setKind] = useState<RecipeKind>();
  const [query, setQuery] = useState('');
  const needle = useDeferredValue(query).trim().toLowerCase();
  const history = snapshot?.history ?? [];
  const shown = history.filter(
    (craft) =>
      (kind === undefined || craft.kind === kind) &&
      (needle === '' ||
        [craft.name, craft.detail, formatIngredients(craft.ingredients)]
          .join(' ')
          .toLowerCase()
          .includes(needle)),
  );

  if (!snapshot?.ready) return <p className="mat-empty">Reading journals…</p>;
  return (
    <>
      <div className="mat-bar">
        <label className="input">
          <span className="ic-w">
            <Glyph name="search" />
          </span>
          <input
            type="search"
            placeholder="Find…"
            aria-label="Find a craft"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <fieldset className="seg">
          <legend className="visually-hidden">Kinds of craft</legend>
          <button
            type="button"
            aria-pressed={kind === undefined}
            onClick={() => setKind(undefined)}
          >
            All
          </button>
          {RECIPE_KINDS.map(({ id, label }) => (
            <button key={id} type="button" aria-pressed={kind === id} onClick={() => setKind(id)}>
              {label}
            </button>
          ))}
        </fieldset>
        <span className="sp" />
        <span className="sec-meta">
          <span>
            <b>{shown.reduce((sum, craft) => sum + craft.count, 0)}</b> crafts
          </span>
        </span>
      </div>
      <div className="mat-scroll">
        {history.length === 0 ? (
          <p className="mat-empty">Nothing crafted yet.</p>
        ) : shown.length === 0 ? (
          <p className="mat-empty">No crafts match.</p>
        ) : (
          <table className="tbl hist-tbl">
            <thead>
              <tr>
                <th scope="col">When</th>
                <th scope="col">Craft</th>
                <th scope="col" className="v">
                  Times
                </th>
                <th scope="col">Took, each</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((craft) => (
                <tr key={`${craft.timestamp}-${craft.name}`}>
                  <td className="dim">{formatShortDateTime(craft.timestamp)}</td>
                  <td>
                    <div className="hist-name">
                      {craft.name}
                      {craft.grade !== undefined && (
                        <span className="rc-grade">{gradeLabel(craft.kind, craft.grade)}</span>
                      )}
                    </div>
                    <div className="st-meta">
                      {craft.detail ?? RECIPE_KINDS.find((known) => known.id === craft.kind)?.label}
                    </div>
                  </td>
                  <td className="v">×{craft.count}</td>
                  <td className="hist-ing">{formatIngredients(craft.ingredients)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
