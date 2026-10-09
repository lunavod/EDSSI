import { type ReactNode, useState } from 'react';

import type { ActivityTallies } from '../../../shared/activity';
import type { CsvRouteState } from '../../../shared/csv-route';
import { sameDay } from '../../../shared/days';
import { type FollowedSystem, followedRoute } from '../../../shared/followed-route';
import type { ExobiologyEntry, HistorySnapshot, SystemSurvey } from '../../../shared/history';
import { isScoopableClass, type PlottedRoute } from '../../../shared/nav-routes';
import type { Overview } from '../../../shared/overview';
import { DEFAULT_SETTINGS, type Settings } from '../../../shared/settings';
import { shortBodyName, typeLabel } from '../hud/BodyPanel';
import { CopyButton } from '../hud/CopyButton';
import { Glyph } from '../hud/Glyph';
import { Icon } from '../hud/Icon';
import { ICONS } from '../hud/icons';
import { Pips } from '../hud/Pips';
import { StarClass } from '../hud/StarClass';
import { type StarBadge, starBadge } from '../hud/system-facts';
import { useViewOption } from '../hud/useViewOption';
import {
  formatCompact,
  formatCompactParts,
  formatDateTime,
  formatNumber,
  formatShortDateTime,
  formatShortTime,
} from '../journal/format';
import { join } from '../journal/summaries';
import {
  BIO_SORTS,
  type BioBody,
  type BioLine,
  bioBodies,
  exobiologyStops,
  type ExobiologyStop,
  formatProbeEarnings,
  formatShortCredits,
  jumpsSinceLastStop,
  probeTargets,
  sortBioBodies,
} from './mission';
import { SessionStrip } from './SessionStrip';

interface MissionViewProps {
  overview: Overview;
  settings: Settings | undefined;
  routes: readonly PlottedRoute[];
  csvRoute: CsvRouteState | undefined;
  history: HistorySnapshot | undefined;
  activity: ActivityTallies | undefined;
  /** The body the commander is on or near, if any: its card is marked and kept open. */
  bodyName?: string;
  /**
   * The VR cockpit gives the route and the session's takings panels of their own, so the Mission
   * panel leaves them out rather than showing them twice.
   */
  hideRoute?: boolean;
  hideSession?: boolean;
}

/** Past this many jumps a diamond per system is noise; the rail becomes a strip of ticks. */
const LONG_ROUTE = 30;

/** Past this many bodies with life, the finished ones fold into a chip each. */
const FOLD_DONE_OVER = 3;

/** How many stops of the log stay open; the rest fold into one row. */
const OPEN_STOPS = 3;

/**
 * The Mission module: where the trip is headed, life in this system, and samples since the last
 * sale, scrolling as one page, with what the session has made pinned along the bottom.
 */
export function MissionView({
  overview,
  settings,
  routes,
  csvRoute,
  history,
  activity,
  bodyName,
  hideRoute = false,
  hideSession = false,
}: MissionViewProps) {
  // The survey belongs to whichever system the history reader is in; it may still be catching up.
  const survey =
    history?.survey && String(history.survey.systemAddress) === String(overview.systemAddress)
      ? history.survey
      : undefined;
  const minValue = settings?.mission.min_probe_value ?? DEFAULT_SETTINGS.mission.min_probe_value;
  return (
    <div className="mission-page">
      <div className="mscroll">
        {!hideRoute && <RouteSection overview={overview} routes={routes} csvRoute={csvRoute} />}
        <BiologySection survey={survey} minValue={minValue} bodyName={bodyName} />
        <ProbeSection survey={survey} minValue={minValue} />
        <ExobiologySection history={history} here={overview.systemAddress} />
      </div>
      {!hideSession && <SessionStrip tallies={activity} />}
    </div>
  );
}

function Section({
  title,
  meta,
  controls,
  children,
}: {
  title: string;
  /** The figures on the right of the heading, divided by rules. */
  meta?: ReactNode[];
  /** Buttons that change how the section is shown, next to its title. */
  controls?: ReactNode;
  children?: ReactNode;
}) {
  const parts = meta?.filter((part) => part !== undefined && part !== false && part !== null);
  return (
    <section className="sec" aria-label={title}>
      <div className="sec-head" style={children ? undefined : { marginBottom: 0 }}>
        <h2 className="sec-title">{title}</h2>
        {controls}
        {parts && parts.length > 0 && (
          <div className="sec-meta">
            {parts.map((part, index) => (
              // oxlint-disable-next-line react/no-array-index-key -- the parts are in a fixed order.
              <Meta key={index} first={index === 0}>
                {part}
              </Meta>
            ))}
          </div>
        )}
      </div>
      {children}
    </section>
  );
}

function Meta({ first, children }: { first: boolean; children: ReactNode }) {
  return (
    <>
      {!first && <span className="sep" />}
      {typeof children === 'string' ? <span>{children}</span> : children}
    </>
  );
}

/** A quiet line in a section's heading, when there is nothing to show under it. */
function None({ children }: { children: ReactNode }) {
  return <span className="sec-none">{children}</span>;
}

/**
 * The route being followed: the one plotted in the game, or a CSV route the commander is flying
 * without one. Exported for the VR cockpit, which gives the route a panel of its own.
 */
export function RouteSection({
  overview,
  routes,
  csvRoute,
}: {
  overview: Overview;
  routes: readonly PlottedRoute[];
  csvRoute: CsvRouteState | undefined;
}) {
  const route = followedRoute(routes, csvRoute, overview.systemAddress);
  const systems = route?.systems;
  const position = route?.position;
  if (!route || !systems || position === undefined) {
    return (
      <Section
        title="Route"
        meta={[
          <None key="none">
            {!route ? 'None plotted' : !systems ? 'Systems not recorded' : 'Off the route'}
          </None>,
        ]}
      />
    );
  }
  const jumps = systems.length - 1;
  const ahead = systems.slice(position + 1);
  const unscoopable = ahead.filter(
    (system) => system.starClass !== undefined && !isScoopableClass(system.starClass),
  ).length;
  const here = systems[position]!;
  const next = systems[position + 1];
  const final = systems.at(-1)!;
  const hereBadge = starBadge(overview.starClass ?? here.starClass, undefined, here.scoopable);
  const nextBadge = next && systemBadge(next);
  return (
    <Section
      title="Route"
      meta={[
        route.source === 'csv' && 'CSV route',
        <span key="jump">
          Jump <b>{position}</b> of <b>{jumps}</b>
        </span>,
        route.lyLeft !== undefined && (
          <span key="left">
            <b>{formatNumber(route.lyLeft, 1)}</b> ly left
          </span>
        ),
        unscoopable > 0 && (
          <span key="dry" className="warn">
            {unscoopable} unscoopable ahead
          </span>
        ),
        route.unknownAhead !== undefined &&
          (route.unknownAhead === 0 ? 'all in EDSM' : `${route.unknownAhead} not in EDSM`),
      ]}
    >
      <RouteRail systems={systems} position={position} />
      <div className="rr-labels">
        <RouteStop label="Here" system={here} badge={hereBadge}>
          {hereBadge.scoopable === false && <span className="rr-detail warn">Not scoopable</span>}
        </RouteStop>
        {next && nextBadge ? (
          <RouteStop label="Next" className="mid" system={next} badge={nextBadge}>
            <span className={nextBadge.scoopable === false ? 'rr-detail warn' : 'rr-detail'}>
              {join(
                next.legLy !== undefined && `${formatNumber(next.legLy, 2)} ly`,
                nextBadge.scoopable === false && 'not scoopable',
              )}
            </span>
          </RouteStop>
        ) : (
          <div className="rr-stop mid">
            <span className="micro">Next</span>
            <span className="rr-detail">Arrived</span>
          </div>
        )}
        <RouteStop label="Final" className="end" system={final} badge={systemBadge(final)}>
          <span className="rr-detail">
            {jumps - position === 0
              ? 'Here'
              : `${jumps - position} ${jumps - position === 1 ? 'jump' : 'jumps'}`}
          </span>
        </RouteStop>
      </div>
    </Section>
  );
}

/** Every stop of the route along a line, coloured by whether its star can be scooped. */
function RouteRail({ systems, position }: { systems: FollowedSystem[]; position: number }) {
  const jumps = systems.length - 1;
  const at = (index: number) => `${jumps === 0 ? 0 : (index / jumps) * 100}%`;
  const kind = (system: FollowedSystem, index: number) =>
    [scoopClass(system), index < position && 'flown'].filter(Boolean).join(' ');
  if (jumps > LONG_ROUTE) {
    return (
      <div className="rr long">
        <div className="rr-ticks">
          {systems.map((system, index) => (
            // oxlint-disable-next-line react/no-array-index-key -- a route's stops are fixed.
            <i key={index} className={kind(system, index)} title={tickTitle(system)} />
          ))}
        </div>
        <span className="rr-node cur" style={{ left: at(position) }} />
        <span className="rr-pos" style={{ left: at(position) }}>
          {position}
        </span>
      </div>
    );
  }
  return (
    <div className="rr">
      <div className="rr-line" />
      {systems.map((system, index) => (
        <span
          // oxlint-disable-next-line react/no-array-index-key -- a route's stops are fixed.
          key={index}
          className={`rr-node ${index === position ? 'cur' : kind(system, index)}`}
          style={{ left: at(index) }}
          title={tickTitle(system)}
        />
      ))}
    </div>
  );
}

function scoopClass(system: FollowedSystem): string {
  if (system.starClass !== undefined) return isScoopableClass(system.starClass) ? '' : 'no';
  return system.scoopable ? '' : 'unknown';
}

function tickTitle(system: FollowedSystem): string {
  return system.starClass === undefined ? system.name : `${system.name} · ${system.starClass}`;
}

function systemBadge(system: FollowedSystem): StarBadge {
  return starBadge(system.starClass, undefined, system.scoopable);
}

function RouteStop({
  label,
  className = 'left',
  system,
  badge,
  children,
}: {
  label: string;
  className?: string;
  system: FollowedSystem;
  badge: StarBadge;
  children: ReactNode;
}) {
  return (
    <div className={`rr-stop ${className}`}>
      <span className="micro">{label}</span>
      <span className="row" style={className === 'end' ? { justifyContent: 'flex-end' } : {}}>
        <StarClass badge={badge} />
        <span className="rr-name ellip" title={system.name}>
          {system.name}
        </span>
        <CopyButton text={system.name} />
      </span>
      {children}
    </div>
  );
}

function BiologySection({
  survey,
  minValue,
  bodyName,
}: {
  survey: SystemSurvey | undefined;
  minValue: number;
  bodyName: string | undefined;
}) {
  // Shared, so the assistant can change it and the VR panel follows the window.
  const [sort, setSort] = useViewOption('mission.bio_sort');
  const bodies = sortBioBodies(bioBodies(survey, minValue), sort);
  if (!survey || bodies.length === 0) {
    const scanned = survey?.bodies.filter((body) => body.kind !== undefined).length ?? 0;
    return (
      <Section
        title="Biology here"
        meta={[
          <None key="none">
            {!survey
              ? 'Waiting for the scans'
              : survey.bodyCount === undefined
                ? 'None found yet · honk and scan the system to find them'
                : `None · ${scanned} ${scanned === 1 ? 'body' : 'bodies'} scanned`}
          </None>,
        ]}
      />
    );
  }
  const signals = bodies.reduce((sum, bio) => sum + bio.body.bioSignals, 0);
  const collected = bodies.reduce((sum, bio) => sum + bio.collected, 0);
  const min = bodies.reduce((sum, bio) => sum + bio.potentialMin, 0);
  const max = bodies.reduce((sum, bio) => sum + bio.potentialMax, 0);
  // Many bodies: the one underfoot first, finished ones folded, so the list stays a screen long.
  const fold = bodies.length > FOLD_DONE_OVER;
  const current = bodies.find((bio) => bio.body.name === bodyName);
  const open = fold
    ? [...(current ? [current] : []), ...bodies.filter((bio) => bio !== current && !isDone(bio))]
    : bodies;
  const done = fold ? bodies.filter((bio) => bio !== current && isDone(bio)) : [];
  return (
    <Section
      title="Biology here"
      controls={
        bodies.length > 1 && (
          <fieldset className="seg">
            <legend className="visually-hidden">Sort bodies</legend>
            {BIO_SORTS.map(({ id, label, title }) => (
              <button
                key={id}
                type="button"
                aria-pressed={sort === id}
                title={title}
                onClick={() => setSort(id)}
              >
                {label}
              </button>
            ))}
          </fieldset>
        )
      }
      meta={[
        <span key="bodies">
          <b>{bodies.length}</b> {bodies.length === 1 ? 'body' : 'bodies'}
        </span>,
        <span key="signals">
          <b>{signals}</b> {signals === 1 ? 'signal' : 'signals'}
        </span>,
        collected > 0 && (
          <span key="collected">
            <b>{formatCompact(collected)}</b> collected
          </span>
        ),
        max > 0 && (
          <span key="left">
            <b>{formatRange(min, max)}</b> to go
          </span>
        ),
      ]}
    >
      <div className="bio-bodies">
        {open.map((bio) => (
          <BioBodyCard
            key={bio.body.bodyId}
            bio={bio}
            systemName={survey.systemName}
            current={bio.body.name === bodyName}
          />
        ))}
        {done.length > 0 && (
          <div className="done-row">
            <span className="micro">Done</span>
            {done.map((bio) => (
              <span
                key={bio.body.bodyId}
                className="done-chip"
                title={`${bio.lines.length} of ${bio.lines.length} analysed`}
              >
                <b>{shortBodyName(bio.body.name, survey.systemName)}</b>
                <span>{formatCompact(bio.collected)}</span>
              </span>
            ))}
          </div>
        )}
      </div>
    </Section>
  );
}

/** Every species on it analysed (or sold), and none of its signals still unnamed. */
function isDone(bio: BioBody): boolean {
  return (
    bio.unnamed === 0 &&
    bio.lines.length > 0 &&
    bio.lines.every(
      (line) => line.progress === 'analysed' || line.status === 'sold' || line.status === 'lost',
    )
  );
}

function BioBodyCard({
  bio,
  systemName,
  current,
}: {
  bio: BioBody;
  systemName: string;
  current: boolean;
}) {
  const { body } = bio;
  const unmapped = bio.unnamed > 0 && body.genuses.length === 0 && bio.lines.length <= 1;
  const gravity = body.gravity === undefined ? undefined : body.gravity / 9.80665;
  const tags = join(
    unmapped && `${body.bioSignals} ${body.bioSignals === 1 ? 'signal' : 'signals'}`,
    body.distanceLs !== undefined && `${formatNumber(body.distanceLs, 0)} ls`,
    typeLabel(body),
    gravity !== undefined && `${formatNumber(gravity, 2)} g`,
  );
  const total = bio.collected + bio.potentialMax;
  const lines = unmapped ? [] : bio.lines.filter((line) => line.status !== 'predicted');
  const predicted = bio.lines.find((line) => line.status === 'predicted');
  const className = ['bio-body', current && 'current', unmapped && 'unmapped']
    .filter(Boolean)
    .join(' ');
  return (
    <div className={className}>
      <div className="bio-body-head">
        <span className="bio-body-name">{shortBodyName(body.name, systemName)}</span>
        {current && <Icon src={ICONS.marker} className="icon here-mk" />}
        <span className="bio-body-tags" title={tags}>
          {tags}
          {body.firstFootfall === true && (
            <>
              {' · '}
              <span className="hi">first footfall ×5</span>
            </>
          )}
        </span>
        <span className="sp" />
        {unmapped && <span className="tag warn">Not mapped</span>}
        {bio.mapping && (
          <span className="tag" title="What mapping it with probes would add">
            {bio.mapping.earns === undefined
              ? 'Worth mapping'
              : `+${formatCompact(bio.mapping.earns)} to map`}
          </span>
        )}
        {total > 0 && (
          <span className="bio-body-value">
            {bio.collected > 0 ? (
              <>
                <b>{formatCompact(bio.collected)}</b>{' '}
                <span className="dim">
                  / {formatRange(bio.collected + bio.potentialMin, total)}
                </span>
              </>
            ) : (
              <b>{formatRange(bio.potentialMin, bio.potentialMax)}</b>
            )}
          </span>
        )}
      </div>
      {lines.length > 0 && (
        <div className="bio-rows">
          {lines.map((line) => (
            <BioRowLine key={line.key} line={line} />
          ))}
          {predicted && bio.unnamed > 0 && (
            <div className="bio-row predicted" title={candidatesTitle(predicted)}>
              <Icon src={ICONS.bio} className="icon bio-ic" />
              <span className="bio-name muted">
                {predicted.name}
                <span className="dim"> · map the body to name them</span>
              </span>
              <span />
              <span />
              <span className="bio-val">
                <span className="dim">~{formatRange(predicted.minValue, predicted.maxValue)}</span>
              </span>
            </div>
          )}
        </div>
      )}
      {unmapped && predicted?.candidates && (
        <div className="cands" title={candidatesTitle(predicted)}>
          {predicted.candidates.length === 0 ? (
            <span className="cand">No known genus fits this body</span>
          ) : (
            predicted.candidates.map((candidate) => (
              <span key={candidate.name} className={candidate.isNew ? 'cand new' : 'cand'}>
                {candidate.name}
                <b>{formatRange(candidate.minValue, candidate.maxValue)}</b>
              </span>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function BioRowLine({ line }: { line: BioLine }) {
  const analysed = line.progress === 'analysed';
  const guess = line.status === 'unsampled';
  const others = guess && line.candidates && line.candidates.length > 1 ? line.candidates : [];
  const likely = others[0];
  const className = [
    'bio-row',
    analysed
      ? 'analysed'
      : guess
        ? 'unsampled'
        : line.status === 'pending'
          ? 'sampling'
          : line.status,
  ].join(' ');
  return (
    <div className={className} title={others.length > 0 ? candidatesTitle(line) : undefined}>
      <Icon src={ICONS.bio} className="icon bio-ic" />
      <span className="bio-name">
        {likely ? (
          <>
            <span className="muted">{line.name}</span>
            <span className="dim"> · likely {likely.name.replace(/^\S+ /, '')}</span>
          </>
        ) : (
          line.name
        )}
        {line.variant && (
          <span className="bio-var"> · {variantColour(line.name, line.variant)}</span>
        )}
        {line.isNew && line.status !== 'sold' && <span className="bio-new">New</span>}
      </span>
      <span className="bio-colony" title="Minimum distance between samples">
        {line.colonyDistance !== undefined && `${formatNumber(line.colonyDistance, 0)} m`}
      </span>
      <span className="bio-pips">
        <Pips progress={line.progress} />
      </span>
      <span className="bio-val">
        {guess ? (
          <span className="dim">~{formatRange(line.minValue, line.maxValue)}</span>
        ) : line.minValue === undefined ? (
          <span className="dim">?</span>
        ) : (
          formatCompact(line.minValue)
        )}
      </span>
    </div>
  );
}

/** "5.0M", or "11.8–22.9M" for a range; "?" when it isn't known. */
function formatRange(min: number | undefined, max: number | undefined): string {
  if (min === undefined || max === undefined) return '?';
  if (min === max) return formatCompact(min);
  const low = formatCompactParts(min);
  const high = formatCompactParts(max);
  // One unit for both ends when they share it, or the range outgrows its column.
  if (low.unit !== undefined && low.unit === high.unit) {
    return `${low.value}–${high.value}${formatCompact(max).slice(high.value.length)}`;
  }
  return `${formatCompact(min)}–${formatCompact(max)}`;
}

/** Every candidate in full, colours and all, and a reminder that it's a prediction. */
function candidatesTitle(line: BioLine): string {
  const candidates = (line.candidates ?? []).map((candidate) =>
    join(
      candidate.name,
      formatRange(candidate.minValue, candidate.maxValue),
      candidate.colours.length > 0 && candidate.colours.join('/'),
      candidate.isNew && 'new',
    ),
  );
  return [...candidates, 'Predicted from the community spawn rules; can be wrong.'].join('\n');
}

/**
 * Bodies worth the surface scanner before leaving: the few that pay millions for it, best return
 * on the detour first. Only there when there is one.
 */
function ProbeSection({
  survey,
  minValue,
}: {
  survey: SystemSurvey | undefined;
  minValue: number;
}) {
  const targets = probeTargets(survey, minValue);
  if (!survey || targets.length === 0) return null;
  const earns = targets.reduce((sum, target) => sum + (target.earns ?? 0), 0);
  return (
    <Section
      title="Worth a probe"
      meta={[
        <span key="bodies">
          <b>{targets.length}</b> {targets.length === 1 ? 'body' : 'bodies'}
        </span>,
        earns > 0 && (
          <span key="earns">
            <b>+{formatCompact(earns)}</b> to map
          </span>
        ),
      ]}
    >
      <table className="tbl compact probe-tbl">
        <tbody>
          {targets.map((target) => (
            <tr key={target.body.bodyId}>
              <td>{shortBodyName(target.body.name, survey.systemName)}</td>
              <td className="dim" style={{ width: '100%' }}>
                {join(
                  typeLabel(target.body),
                  target.body.terraformable && 'terraformable',
                  target.body.bioSignals > 0 && 'life',
                )}
              </td>
              <td className="dim">
                {target.body.distanceLs !== undefined &&
                  `${formatNumber(target.body.distanceLs, 0)} ls`}
              </td>
              <td
                className="v"
                title={`Worth ${formatShortCredits(target.body.value)} now, ${formatShortCredits(target.worth)} once mapped`}
              >
                {formatCompact(target.worth)}
              </td>
              <td className="v">{formatProbeEarnings(target)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Section>
  );
}

function ExobiologySection({
  history,
  here,
}: {
  history: HistorySnapshot | undefined;
  here: number | bigint | undefined;
}) {
  const [showOlder, setShowOlder] = useState(false);
  if (!history?.ready) {
    return <Section title="Since last sale" meta={[<None key="none">Reading journals…</None>]} />;
  }
  const { lastSale, entries, jumps } = history.exobiology;
  const pending = entries.filter((entry) => entry.status === 'pending');
  const value = pending.reduce((sum, entry) => sum + (entry.value ?? 0), 0);
  // Newest first: each stop is followed by the jumps it took to get there from the one below.
  const stops = exobiologyStops(entries).toReversed();
  const since = jumpsSinceLastStop(entries, jumps);
  const shown = showOlder ? stops : stops.slice(0, OPEN_STOPS);
  const older = stops.slice(OPEN_STOPS);
  const meta = [
    lastSale ? `Sold ${formatShortDateTime(lastSale.timestamp)}` : 'Never sold',
    <span key="species">
      <b>{pending.length}</b> species
    </span>,
    <span key="value">
      <b>{formatCompact(value)}</b>
    </span>,
  ];
  if (stops.length === 0) {
    return (
      <Section
        title="Since last sale"
        meta={[...meta.slice(0, 1), <None key="none">nothing analysed since</None>]}
      />
    );
  }
  return (
    <Section title="Since last sale" meta={meta}>
      <ol className="tl">
        {since !== undefined && since > 0 && (
          <li className="tl-stop older">
            <div className="tl-gap" style={{ margin: 0, lineHeight: '32px' }}>
              {since} {since === 1 ? 'jump' : 'jumps'} since the last sample
            </div>
          </li>
        )}
        {shown.map((stop, index) => (
          <StopItem
            key={`${String(stop.systemAddress)}-${stop.entries[0]!.timestamp}`}
            stop={stop}
            here={index === 0 && String(stop.systemAddress) === String(here)}
          />
        ))}
        {older.length > 0 && (
          <li className="tl-stop older">
            <button
              type="button"
              className="tl-head tl-more"
              aria-expanded={showOlder}
              onClick={() => setShowOlder(!showOlder)}
            >
              <span className="tl-dot" />
              <span className="tl-sys">
                {showOlder
                  ? 'Fold the earlier systems'
                  : `${older.length} earlier ${older.length === 1 ? 'system' : 'systems'}`}
              </span>
              <span className="sp" />
              {!showOlder && (
                <>
                  <span className="muted" style={{ fontSize: 14, marginRight: 10 }}>
                    {older.reduce((sum, stop) => sum + stop.entries.length, 0)} species
                  </span>
                  <span className="tl-val">
                    {formatCompact(stopValue(older.flatMap((stop) => stop.entries)))}
                  </span>
                </>
              )}
              <span className="tl-chev" style={showOlder ? { transform: 'rotate(180deg)' } : {}}>
                <Glyph name="chevronDown" />
              </span>
            </button>
          </li>
        )}
        {lastSale && (
          <li className="tl-stop sale">
            <div className="tl-head">
              <span className="tl-dot" />
              <span className="tl-sys muted">Sold at Vista Genomics</span>
              <span className="sp" />
              <span className="muted">{formatShortDateTime(lastSale.timestamp)}</span>
            </div>
          </li>
        )}
      </ol>
    </Section>
  );
}

function stopValue(entries: readonly ExobiologyEntry[]): number {
  return entries
    .filter((entry) => entry.status === 'pending')
    .reduce((sum, entry) => sum + (entry.value ?? 0), 0);
}

function StopItem({ stop, here }: { stop: ExobiologyStop; here: boolean }) {
  return (
    <li className={here ? 'tl-stop here' : 'tl-stop'}>
      <div className="tl-head">
        <span className="tl-dot" />
        <span className="tl-sys ellip" title={stop.systemName}>
          {stop.systemName}
        </span>
        <CopyButton text={stop.systemName} />
        <span className="sp" />
        <span className="tl-val">{formatCompact(stopValue(stop.entries))}</span>
      </div>
      {stop.entries.map((entry) => (
        <div
          key={`${entry.bodyName}-${entry.species}`}
          className={`tl-entry ${entry.status}`}
          title={join(entry.variant, formatDateTime(entry.timestamp))}
        >
          <span className="tl-name">{entry.name}</span>
          <span className="dim">
            {join(
              shortBodyName(entry.bodyName, stop.systemName),
              entry.variant && variantColour(entry.name, entry.variant),
            )}
          </span>
          {entry.newSpecies && <span className="bio-new">New</span>}
          <span className="sp" />
          <span className="tl-when">
            {entry.status === 'lost' ? 'lost' : formatWhen(entry.timestamp)}
          </span>
          <span className="tl-v">
            {entry.value === undefined ? '?' : formatCompact(entry.value)}
          </span>
        </div>
      ))}
      {stop.jumpsBefore !== undefined && (
        <div className="tl-gap">
          {stop.jumpsBefore === 0
            ? 'no jumps'
            : `${stop.jumpsBefore} ${stop.jumpsBefore === 1 ? 'jump' : 'jumps'}`}
        </div>
      )}
    </li>
  );
}

/** "Bacterium Informem - Red" → "Red": the species is already on the line. */
function variantColour(name: string, variant: string): string {
  return variant.startsWith(`${name} - `) ? variant.slice(name.length + 3) : variant;
}

/**
 * The time for today's samples, the date too for older ones. Today runs from 06:00, as the
 * commander counts it, so a late session doesn't turn into dates at midnight.
 */
function formatWhen(timestamp: string): string {
  const today = sameDay(new Date(), new Date(timestamp));
  return today ? formatShortTime(timestamp) : formatShortDateTime(timestamp);
}
