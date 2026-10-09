import { useState } from 'react';

import {
  activeRoute,
  distanceLy,
  isScoopableClass,
  type PlottedRoute,
  positionOf,
  type RouteSystem,
  routeLengthLy,
  unknownToEdsm,
} from '../../../shared/nav-routes';
import { formatNumber } from '../journal/format';
import { CopyButton } from './CopyButton';
import { Glyph } from './Glyph';
import { StarClass } from './StarClass';
import { starBadge } from './system-facts';

/** Past this many stops the table shows a window around the commander, the rest folded. */
const LONG_ROUTE = 40;
/** Stops shown before and after the commander on a long route. */
const BEHIND = 5;
const AHEAD = 18;

/** The Route module's first page: the route plotted in the game, and where the commander is on it. */
export function RouteView({
  routes,
  systemAddress,
}: {
  routes: readonly PlottedRoute[];
  systemAddress: number | bigint | undefined;
}) {
  const [openFlown, setOpenFlown] = useState(false);
  const [openAhead, setOpenAhead] = useState(false);
  const route = activeRoute(routes);
  if (!route) {
    return (
      <p className="route-empty">No route plotted. Plot one in the galaxy map to follow it here.</p>
    );
  }
  const { systems } = route;
  if (!systems) {
    return (
      <p className="route-empty">
        A route is plotted, but its systems weren&apos;t recorded: it changed before EDSSI could
        read NavRoute.json.
      </p>
    );
  }

  const position = positionOf(route, systemAddress);
  const at = position ?? 0;
  const jumps = systems.length - 1;
  const ahead = systems.slice(at + 1);
  const final = systems.at(-1)!;
  const unknown = route.edsm?.status === 'checked' ? new Set(route.edsm.unknown) : undefined;
  const newAhead = route.edsm?.status === 'checked' ? unknownToEdsm(route.edsm, ahead) : undefined;
  const scoopable = ahead.filter((system) => isScoopableClass(system.StarClass)).length;
  const run = longestDryRun(systems, at);
  const long = systems.length > LONG_ROUTE;

  // A long route shows a window around the commander; what is flown and what is left fold away.
  const first = long && !openFlown ? Math.max(0, at - BEHIND) : 0;
  const last = long && !openAhead ? Math.min(jumps, at + AHEAD) : jumps;
  const flownLy = first > 0 ? routeLengthLy(systems.slice(0, first + 1), 0) : 0;
  const leftLy = last < jumps ? routeLengthLy(systems, last) : 0;

  return (
    <>
      <section className="sumbar panel" aria-label="Route summary">
        <div className="row" style={{ gap: 14 }}>
          <span className="micro">To</span>
          <span className="sum-dest" title={final.StarSystem}>
            {final.StarSystem}
          </span>
          <CopyButton text={final.StarSystem} />
          <span className="sp" />
          <span className="sum-fig">
            {position === undefined ? (
              <b className="warn">Off the route</b>
            ) : (
              <>
                <b>{position}</b> of {jumps} jumps
              </>
            )}
          </span>
          <span className="sum-fig">
            <b>{formatNumber(routeLengthLy(systems, at), 1)}</b> ly left
          </span>
          {newAhead !== undefined && newAhead > 0 ? (
            <span className="sum-fig" title="Systems ahead that EDSM has never heard of">
              <b>{newAhead}</b> new to EDSM
            </span>
          ) : (
            <span className="sum-fig" title="Stars ahead a fuel scoop works at">
              <b>{scoopable}</b> scoopable
            </span>
          )}
        </div>
        {long ? (
          <div
            className="ticks-flat"
            title="One tick per jump: dim once flown, amber where the star can't be scooped"
          >
            {systems.map((system, index) => (
              <i
                key={String(system.SystemAddress)}
                className={[isScoopableClass(system.StarClass) ? '' : 'no', index < at && 'flown']
                  .filter(Boolean)
                  .join(' ')}
              />
            ))}
            <span className="flat-pos" style={{ left: `${(at / jumps) * 100}%` }} />
          </div>
        ) : (
          <div className="bar" style={{ margin: '8px 0 7px' }}>
            <i style={{ width: `${Math.max(2, (at / Math.max(1, jumps)) * 100)}%` }} />
          </div>
        )}
        <div className="row sum-note">
          <span className="ic-w">
            <Glyph name="fuel" />
          </span>
          <span>
            {run ? (
              <>
                Longest unscoopable run ahead:{' '}
                <b className="warn">
                  {run.length} {run.length === 1 ? 'jump' : 'jumps'}, at {run.from}
                  {run.length > 1 && `–${run.to}`}
                </b>
                .
              </>
            ) : (
              <>
                Every star ahead can be scooped: <b>no need to carry fuel</b>.
              </>
            )}
          </span>
        </div>
      </section>

      <div className="route-scroll">
        <table className="tbl">
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col">Star</th>
              <th scope="col">System</th>
              <th scope="col" className="v">
                Jump
              </th>
            </tr>
          </thead>
          <tbody>
            {first > 0 && (
              <FoldRow
                text={`${first} ${first === 1 ? 'jump' : 'jumps'} flown, from ${systems[0]!.StarSystem}`}
                ly={flownLy}
                open={false}
                onToggle={() => setOpenFlown(true)}
              />
            )}
            {long && openFlown && (
              <FoldRow text="Fold the jumps flown" open onToggle={() => setOpenFlown(false)} />
            )}
            {systems.slice(first, last + 1).map((system, offset) => {
              const index = first + offset;
              return (
                <tr
                  key={String(system.SystemAddress)}
                  className={index === position ? 'sel' : index < at ? 'past' : undefined}
                  aria-current={index === position ? 'step' : undefined}
                >
                  <td className="idxc">{index}</td>
                  <td style={{ width: 44 }}>
                    <StarClass badge={starBadge(system.StarClass, undefined)} />
                  </td>
                  <td>
                    <span className="row" style={{ gap: 8, minWidth: 0 }}>
                      <span className="ellip">{system.StarSystem}</span>
                      <CopyButton text={system.StarSystem} />
                      {unknown?.has(String(system.SystemAddress)) && (
                        <span className="tag ghost new-tag" title="EDSM has never heard of it">
                          New
                        </span>
                      )}
                    </span>
                  </td>
                  <td className="v">
                    {index > 0 && `${formatNumber(distanceLy(systems[index - 1]!, system))} ly`}
                  </td>
                </tr>
              );
            })}
            {long && openAhead && (
              <FoldRow text="Fold the jumps ahead" open onToggle={() => setOpenAhead(false)} />
            )}
            {last < jumps && (
              <FoldRow
                text={`${jumps - last} more to ${final.StarSystem}`}
                ly={leftLy}
                open={false}
                onToggle={() => setOpenAhead(true)}
              />
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

function FoldRow({
  text,
  ly,
  open,
  onToggle,
}: {
  text: string;
  ly?: number;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <tr className="fold">
      <td colSpan={4}>
        <button type="button" className="fold-btn" aria-expanded={open} onClick={onToggle}>
          <span className="fold-ic">
            <Glyph name="chevronDown" />
          </span>
          {text}
          <span className="sp" />
          {ly !== undefined && `${formatNumber(ly, 0)} ly`}
        </button>
      </td>
    </tr>
  );
}

/**
 * The longest stretch ahead of `from` of stars a scoop can't use, by index, if there is one: the
 * jumps the tank has to cover alone.
 */
export function longestDryRun(
  systems: readonly RouteSystem[],
  from: number,
): { from: number; to: number; length: number } | undefined {
  let best: { from: number; to: number; length: number } | undefined;
  let start: number | undefined;
  for (let index = from + 1; index <= systems.length; index++) {
    const system = systems[index];
    const dry = system !== undefined && !isScoopableClass(system.StarClass);
    if (dry && start === undefined) start = index;
    if (!dry && start !== undefined) {
      const length = index - start;
      if (!best || length > best.length) best = { from: start, to: index - 1, length };
      start = undefined;
    }
  }
  return best;
}
