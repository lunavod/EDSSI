import { type DragEvent, useEffect, useRef, useState } from 'react';

import {
  columnValue,
  type CsvRoute,
  type CsvRouteState,
  hasStarColumn,
  nextSystem,
  scoopableAt,
  starClassAt,
} from '../../../shared/csv-route';
import { useEdssi } from '../api/context';
import { formatNumber } from '../journal/format';
import { CopyButton } from './CopyButton';
import { Glyph } from './Glyph';
import { SavedRoutes } from './SavedRoutes';
import { scrollNearest } from './scroll-within';
import { StarClass } from './StarClass';
import { starBadge } from './system-facts';

/** The file's name, and the buttons that load another or clear it, for the row of pages. */
export function CsvRouteActions({
  route,
  onProblem,
}: {
  route: CsvRoute | undefined;
  onProblem: (problem: string | undefined) => void;
}) {
  const edssi = useEdssi();
  return (
    <>
      {route && (
        <span className="micro ellip file-name" title={route.fileName}>
          <span className="micro-ic">
            <Glyph name="file" />
          </span>
          {route.fileName}
        </span>
      )}
      <button
        type="button"
        className="btn ghost sm"
        onClick={() => void edssi.csvRoute.open().then(onProblem)}
      >
        <span className="ic-w">
          <Glyph name="upload" />
        </span>
        {route ? 'Load another' : 'Load CSV'}
      </button>
      {route && (
        <button
          type="button"
          className="link"
          onClick={() => void edssi.csvRoute.clear().then(() => onProblem(undefined))}
        >
          Clear
        </button>
      )}
    </>
  );
}

/**
 * A route loaded from a CSV file (Spansh's plotters export them): where the commander is on it,
 * and every system with the file's own columns. Arriving in one of its systems puts the next one
 * on the clipboard; that is done by the main process, so it works while the game has focus.
 */
export function CsvRouteView({
  state,
  problem,
  onProblem,
}: {
  state: CsvRouteState | undefined;
  problem: string | undefined;
  onProblem: (problem: string | undefined) => void;
}) {
  const edssi = useEdssi();
  const [dragging, setDragging] = useState(false);
  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files[0];
    if (!file) return;
    void file
      .text()
      .then((text) => edssi.csvRoute.load(text, file.name))
      .then(onProblem);
  };

  const route = state?.route;
  return (
    // A file can also be dropped here; the Load button is the way in for the keyboard.
    // oxlint-disable-next-line jsx-a11y/no-static-element-interactions
    <div
      className="route-page"
      data-dragging={dragging || undefined}
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      <SavedRoutes state={state} />
      {problem && (
        <p className="note danger" role="alert">
          <span className="ic-w">
            <Glyph name="warning" />
          </span>
          Couldn&apos;t load that file: {problem}
        </p>
      )}
      {route && state ? (
        <LoadedRoute route={route} state={state} />
      ) : (
        <p className="route-empty">
          Load a route exported as CSV, from Spansh&apos;s plotters for one, or drop the file here.
          Each time you arrive in one of its systems, the next is copied to paste into the galaxy
          map.
        </p>
      )}
    </div>
  );
}

function LoadedRoute({ route, state }: { route: CsvRoute; state: CsvRouteState }) {
  const edssi = useEdssi();
  const { position, here, copied } = state;
  const next = nextSystem(route.systems, position);
  const nextIndex = position === undefined ? 0 : position + 1;
  const jumps = route.systems.length - 1;
  const at = position === undefined ? undefined : route.systems[position];
  const left =
    position === undefined ? undefined : columnValue(route, position, /distance.*remain/i);
  return (
    <>
      <div className="csv-now">
        <div className={here || at === undefined ? 'csv-cell' : 'csv-cell off'}>
          <span className="micro">
            {at === undefined
              ? 'Not on it yet'
              : `${here ? 'Here' : 'Last reached'} · ${position} of ${jumps}`}
          </span>
          {at && (
            <span className="row" style={{ gap: 8, minWidth: 0 }}>
              <StopStar route={route} index={position!} />
              <span className="csv-sys" title={at.name}>
                {at.name}
              </span>
            </span>
          )}
        </div>
        <span className="csv-arrow">
          <Glyph name="forward" />
        </span>
        <div className="csv-cell next">
          <span className="micro">
            {next ? (position === undefined ? 'Start' : 'Next') : 'Route complete'}
            {next && copied === next.name && (
              <>
                {' · copied '}
                <span className="micro-ic">
                  <Glyph name="check" />
                </span>
              </>
            )}
          </span>
          {next && (
            <span className="row" style={{ gap: 8, minWidth: 0 }}>
              <StopStar route={route} index={nextIndex} />
              <span className="csv-sys hi" title={next.name}>
                {next.name}
              </span>
              <CopyButton text={next.name} />
            </span>
          )}
        </div>
        <div className="csv-cell right">
          <span className="micro">Left</span>
          <span className="csv-sys">
            {left !== undefined && Number.isFinite(Number(left)) ? (
              <>
                {formatNumber(Number(left), 1)} <small>ly</small>
              </>
            ) : (
              '—'
            )}
          </span>
        </div>
        <div className="csv-cell right">
          <span className="micro">Jumps</span>
          <span className="csv-sys">{jumps - (position ?? 0)}</span>
        </div>
        <div className="bar csv-bar">
          <i style={{ width: `${((position ?? 0) / Math.max(1, jumps)) * 100}%` }} />
        </div>
      </div>
      <RouteTable
        route={route}
        position={position}
        here={here}
        onPick={(index) => void edssi.csvRoute.setPosition(index === position ? null : index)}
      />
    </>
  );
}

/** A stop's star, when the file or a lookup says what it is. */
function StopStar({ route, index }: { route: CsvRoute; index: number }) {
  if (starClassAt(route, index) === undefined && !scoopableAt(route, index)) return null;
  return <StarClass badge={stopBadge(route, index)} />;
}

function stopBadge(route: CsvRoute, index: number) {
  return starBadge(starClassAt(route, index), undefined, scoopableAt(route, index));
}

/** Columns that name the star or the system are drawn already; these say yes or no. */
const STAR_COLUMN = /^(star|star ?class|star ?type|primary ?star)$/i;
const NEUTRON_COLUMN = /neutron/i;
/** Spansh's `Inject`: synthesize an FSD injection here for the next jump. Yes, or the grade. */
const INJECT_COLUMN = /^inject(ion)?$/i;
/** A carrier route's `Mine Tritium`: the tritium runs out here, and this many tonnes go on. */
const MINE_COLUMN = /^mine tritium$/i;
const YES = /^(yes|true|1)$/i;

/**
 * Every system of a route with the file's own columns; the ones behind `position` dimmed and the
 * next marked. `onPick` makes each row's number a button that sets the position.
 */
export function RouteTable({
  route,
  position,
  here = false,
  onPick,
  compact = false,
}: {
  route: CsvRoute;
  position?: number;
  here?: boolean;
  onPick?: (index: number) => void;
  compact?: boolean;
}) {
  // Only the followed route has a next stop; a plot waiting to be followed has none yet.
  const next = onPick ? nextSystem(route.systems, position) : undefined;
  // Columns that say the same on every row ("Inject: No") say nothing, and the star has its own.
  const shown = route.columns.flatMap((heading, column) =>
    !STAR_COLUMN.test(heading) &&
    new Set(route.systems.map((system) => system.values[column])).size > 1
      ? [{ heading, column }]
      : [],
  );
  // A star column when the file names the stars, or a lookup did.
  const stars = hasStarColumn(route) || route.systems.some((system) => system.starClass);

  const current = useRef<HTMLTableRowElement>(null);
  // Brings the commander's row into view each time they move along, or load another route.
  useEffect(() => {
    if (current.current) scrollNearest(current.current, 'center');
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- run on each move, on purpose
  }, [position, route]);

  return (
    <div className="route-scroll">
      <table className={compact ? 'tbl compact' : 'tbl'}>
        <thead>
          <tr>
            <th scope="col">#</th>
            {stars && <th scope="col">Star</th>}
            <th scope="col">System</th>
            {shown.map(({ heading }) => (
              <th key={heading} scope="col" className="v">
                {heading}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {route.systems.map((system, index) => {
            const past = position !== undefined && index < position;
            return (
              <tr
                // Names can repeat on a route; their place on it can't.
                // oxlint-disable-next-line react/no-array-index-key
                key={index}
                ref={index === position ? current : undefined}
                aria-current={index === position ? (here ? 'location' : 'step') : undefined}
                className={
                  index === position ? 'sel' : past ? 'past' : next === system ? 'next' : undefined
                }
              >
                <td style={{ width: 48 }}>
                  {onPick ? (
                    <button
                      type="button"
                      className={index === position ? 'idx cur' : 'idx'}
                      title={
                        index === position
                          ? 'Forget where you are on the route'
                          : 'Set as the last system reached'
                      }
                      onClick={() => onPick(index)}
                    >
                      {index}
                    </button>
                  ) : (
                    <span className="dim">{index}</span>
                  )}
                </td>
                {stars && (
                  <td style={{ width: 44 }}>
                    {starClassAt(route, index) !== undefined && (
                      <StarClass badge={stopBadge(route, index)} />
                    )}
                  </td>
                )}
                <td>
                  <span className="row" style={{ gap: 8 }}>
                    {system.name}
                    <CopyButton text={system.name} />
                    {next === system && (
                      <span className="good" title="Next">
                        <span className="micro-ic">
                          <Glyph name="check" />
                        </span>
                      </span>
                    )}
                  </span>
                </td>
                {shown.map(({ heading, column }) => (
                  <td key={heading} className="v">
                    <Cell heading={heading} value={system.values[column] ?? ''} />
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Cell({ heading, value }: { heading: string; value: string }) {
  if (NEUTRON_COLUMN.test(heading)) {
    return YES.test(value.trim()) ? (
      <span className="star n" title="Neutron star: supercharge here">
        N
      </span>
    ) : null;
  }
  if (INJECT_COLUMN.test(heading)) {
    const grade = value.trim();
    if (grade === '' || /^(no|false|0)$/i.test(grade)) return null;
    const yes = YES.test(grade);
    const named = yes ? 'an FSD injection' : `a ${grade.toLowerCase()} FSD injection`;
    return (
      <span className="tag warn" title={`Synthesize ${named} here, for the next jump`}>
        {yes ? 'Inject' : grade}
      </span>
    );
  }
  if (MINE_COLUMN.test(heading)) {
    const tonnes = Number(value);
    if (value.trim() === '' || !(tonnes > 0)) return null;
    const amount = `${formatNumber(tonnes, 0)} t`;
    return (
      <span
        className="tag danger"
        title={`The tritium runs out here: mine ${amount} before the next jump`}
      >
        Mine {amount}
      </span>
    );
  }
  if (/^known$/i.test(heading)) {
    return YES.test(value.trim()) ? (
      <span className="good" title="Somebody has logged it">
        <span className="micro-ic" style={{ marginRight: 0 }}>
          <Glyph name="check" />
        </span>
      </span>
    ) : (
      <span className="dim">—</span>
    );
  }
  return <>{formatCell(value, heading)}</>;
}

/**
 * Decimals cut to two places: Spansh writes distances to thirteen, and tiny fuel figures in
 * exponent notation (`1.47e-05`), which round to 0. Distances and fuel get their units.
 */
function formatCell(value: string, heading: string): string {
  if (!/^-?\d+(\.\d+)?(e[-+]?\d+)?$/i.test(value)) return value;
  const unit = /distance/i.test(heading) ? ' ly' : /fuel/i.test(heading) ? ' t' : '';
  const text = /[.e]/i.test(value) || unit ? formatNumber(Number(value), 1) : value;
  return `${text}${unit}`;
}
