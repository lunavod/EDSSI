import { useState } from 'react';

import type { CsvRouteState } from '../../../shared/csv-route';
import { type FollowedRoute, followedRoute } from '../../../shared/followed-route';
import type { HistorySnapshot, SystemSurvey } from '../../../shared/history';
import type { StatusEvent } from '../../../shared/journal';
import { type RouteFuel, routeFuel } from '../../../shared/jump-fuel';
import { isScoopableClass, type PlottedRoute } from '../../../shared/nav-routes';
import {
  type CarrierJumpScheduled,
  dockedCarrierJump,
  type Overview,
} from '../../../shared/overview';
import { ExtensionBoundary } from '../ExtensionBoundary';
import { sidePanelBlocks } from '../extensions';
import { formatCredits, formatNumber } from '../journal/format';
import { useInVr } from '../vr/in-vr';
import { BodyPanel } from './BodyPanel';
import { CopyButton } from './CopyButton';
import { DataTable, type DataRow, toneClass } from './DataTable';
import { Glyph } from './Glyph';
import { Icon } from './Icon';
import { ICONS } from './icons';
import { Line } from './Line';
import { nearBody } from './near-body';
import { StarClass } from './StarClass';
import { type Fact, starBadge, systemFacts, systemTags, type SystemTag } from './system-facts';
import { securityRow, systemValueRow, threatRow } from './system-rows';
import { useNow } from './useNow';
import { useSystemInfo } from './useSystemInfo';

/** The extensions' blocks, under the fuel. Fixed before this module loads (`main.tsx`). */
const EXTENSION_BLOCKS = sidePanelBlocks();

interface SidePanelProps {
  overview: Overview;
  status: StatusEvent | undefined;
  routes: readonly PlottedRoute[];
  csvRoute: CsvRouteState | undefined;
  history: HistorySnapshot | undefined;
  /** Where the low-fuel warning goes off, as a share of the tank. */
  lowFuelFraction?: number;
}

/**
 * The current system, the body the commander is near (while on or near its surface), the station
 * they are docked at, the next jump and the fuel; what is unsold pinned below.
 */
export function SidePanel({
  overview,
  status,
  routes,
  csvRoute,
  history,
  lowFuelFraction,
}: SidePanelProps) {
  const survey = history?.survey;
  // The survey belongs to whichever system the history reader is in; it may still be catching up.
  const here =
    survey && String(survey.systemAddress) === String(overview.systemAddress) ? survey : undefined;
  const bodyName = nearBody(status);
  const route = followedRoute(routes, csvRoute, overview.systemAddress);
  return (
    <aside className="side" aria-label="Where you are">
      <div className="side-scroll">
        <CurrentSystem overview={overview} survey={here} />
        {bodyName && (
          <>
            <hr className="hair" />
            <BodyPanel bodyName={bodyName} survey={here} />
          </>
        )}
        {overview.station && (
          <>
            <hr className="hair" />
            <Station overview={overview} cargo={status?.Cargo} />
          </>
        )}
        <NextJump route={route} />
        <Fuel
          overview={overview}
          fuel={status?.Fuel?.FuelMain}
          cargo={status?.Cargo}
          route={route}
          lowFuelFraction={lowFuelFraction}
        />
        {EXTENSION_BLOCKS.map(({ key, extension, block: { Block } }) => (
          <ExtensionBoundary key={key} name={extension}>
            <Block />
          </ExtensionBoundary>
        ))}
      </div>
      <div className="side-foot">
        <Line />
        <Unsold history={history} balance={status?.Balance ?? overview.credits} />
      </div>
    </aside>
  );
}

function CurrentSystem({
  overview,
  survey,
}: {
  overview: Overview;
  /** Only when it is of this system. */
  survey: SystemSurvey | undefined;
}) {
  const info = useSystemInfo(overview.system);
  if (overview.system === undefined) {
    return <p className="side-empty">Waiting for the journal…</p>;
  }
  const details = overview.systemDetails;
  // Out in the black every one of these reads "None", so they only earn their line in the bubble.
  const inhabited = (details?.population ?? 0) > 0;
  const tags = systemTags(overview.starClass, survey, info);
  return (
    <section className="side-block" aria-label="Current system">
      <div className="sys-title">
        <Icon src={ICONS.orrery} className="icon sys-logo" />
        <div className="grow">
          <div className="sys-name ellip" title={overview.system}>
            {overview.system}
          </div>
          {overview.station && <div className="sys-sub">Docked at {overview.station}</div>}
        </div>
        <CopyButton text={overview.system} large />
      </div>
      <div className="facts">
        {systemFacts(survey, info, details).map((fact) => (
          <FactTile key={fact.label} fact={fact} />
        ))}
      </div>
      {tags.length > 0 && (
        <div className="tags">
          {tags.map((tag) => (
            <Tag key={tag.label} tag={tag} />
          ))}
        </div>
      )}
      {inhabited && (
        <DataTable
          className="kv sm tight"
          rows={rows(
            securityRow(details?.security),
            { label: 'Economy', value: details?.economy || '—' },
            { label: 'Government', value: details?.government || '—' },
            { label: 'Allegiance', value: details?.allegiance || '—' },
            threatRow(info),
            systemValueRow(survey),
          )}
        />
      )}
    </section>
  );
}

function FactTile({ fact }: { fact: Fact }) {
  return (
    <div className="fact" title={fact.title}>
      <span className={fact.tone ? `v ${toneClass(fact.tone)}` : 'v'}>
        {fact.value}
        {fact.unit && <small>{fact.unit}</small>}
      </span>
      <span className="k">{fact.label}</span>
    </div>
  );
}

function Tag({ tag }: { tag: SystemTag }) {
  return (
    <span className={tag.tone === 'accent' ? 'tag' : `tag ${tag.tone}`} title={tag.title}>
      {tag.warning && (
        <span className="ic-w">
          <Glyph name="warning" />
        </span>
      )}
      {tag.label}
    </span>
  );
}

/** Drops the rows that had nothing to say, so the panel never fills up with dashes. */
function rows(...candidates: (DataRow | false | undefined)[]): DataRow[] {
  return candidates.filter((row): row is DataRow => row !== false && row !== undefined);
}

/** The station the ship is docked at: what kind, what it offers, and how full the hold is. */
function Station({ overview, cargo }: { overview: Overview; cargo: number | undefined }) {
  const details = overview.stationDetails;
  const kind = [details?.type && stationType(details.type), details?.largestPad]
    .filter(Boolean)
    .join(' · ');
  const services = SERVICES.filter(([service]) => details?.services?.includes(service)).map(
    ([, label]) => label,
  );
  const capacity = overview.cargoCapacity;
  return (
    <section className="side-block" aria-label="Station">
      <div className="side-label">
        <span className="ic-w">
          <Glyph name="station" />
        </span>
        Station
      </div>
      <div className="row" style={{ gap: 10 }}>
        <span className="side-name fit ellip" title={overview.station}>
          {overview.station}
        </span>
        {kind && <span className="tag ghost">{kind}</span>}
      </div>
      {(services.length > 0 || capacity !== undefined) && (
        <div className="row micro" style={{ gap: 12, marginTop: 6 }}>
          <span className="ellip">{services.join(' · ')}</span>
          <span className="sp" />
          {capacity !== undefined && capacity > 0 && (
            <span className="nowrap">
              {cargo === undefined
                ? `Hold ${capacity} t`
                : `Cargo ${formatNumber(cargo, 0)} / ${capacity} t`}
            </span>
          )}
        </div>
      )}
      {capacity !== undefined && capacity > 0 && cargo !== undefined && (
        <div className="bar thick" style={{ marginTop: 8 }}>
          <i style={{ width: `${Math.min(100, (cargo / capacity) * 100)}%` }} />
        </div>
      )}
      <CarrierCountdown jump={dockedCarrierJump(overview)} />
    </section>
  );
}

/** A carrier's jump is a few minutes' tunnel after it leaves; past that, the line is stale. */
const JUMP_STALE_MS = 3 * 60_000;
/** Under this the countdown turns to a warning, as the spoken one does. */
const JUMP_WARN_MS = 60_000;

/** Docked on the commander's carrier with a jump scheduled: where to, and how long until it leaves. */
function CarrierCountdown({ jump }: { jump: CarrierJumpScheduled | undefined }) {
  // Mounted only with a jump, so the clock starts fresh rather than from whenever the panel did.
  return jump ? <Countdown jump={jump} /> : null;
}

function Countdown({ jump }: { jump: CarrierJumpScheduled }) {
  const now = useNow();
  const left = jump.departs - now;
  if (left < -JUMP_STALE_MS) return null;
  return (
    <div className="row micro" style={{ gap: 12, marginTop: 6 }}>
      <span className="ellip" title={jump.system}>
        Jumping to {jump.system ?? 'another system'}
      </span>
      <span className="sp" />
      <span className={left < JUMP_WARN_MS ? 'nowrap warn' : 'nowrap'}>
        {left > 0 ? `Departs in ${countdown(left)}` : 'Departing'}
      </span>
    </div>
  );
}

/** 754,000 ms → "12:34". */
export function countdown(ms: number): string {
  const seconds = Math.ceil(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/** The services worth naming, in the journal's words and the panel's. */
const SERVICES: readonly (readonly [string, string])[] = [
  ['commodities', 'Market'],
  ['shipyard', 'Shipyard'],
  ['outfitting', 'Outfitting'],
];

/** `CraterOutpost` → "Crater outpost"; `FleetCarrier` → "Fleet carrier". */
function stationType(type: string): string {
  const words = type.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The next system of the route being followed: plotted, or a CSV route flown without one. */
function NextJump({ route }: { route: FollowedRoute | undefined }) {
  // In the cockpit the route strip above says this already.
  const vr = useInVr();
  const position = route?.position;
  const system = position === undefined ? undefined : route?.systems?.[position + 1];
  const info = useSystemInfo(system?.name);
  if (vr || !route?.systems || position === undefined || !system) return null;
  const traffic = info?.traffic?.day;
  const deaths = info?.deaths?.day;
  return (
    <>
      <hr className="hair" />
      <section className="side-block" aria-label="Next jump">
        <div className="side-label">
          <Icon src={ICONS.galaxyMap} className="icon ic-w" />
          Next jump · {position + 1} of {route.systems.length - 1}
          {route.source === 'csv' && ' · CSV route'}
        </div>
        <div className="row" style={{ gap: 10 }}>
          <StarClass badge={starBadge(system.starClass, info, system.scoopable)} />
          <span className="side-name ellip" title={system.name}>
            {system.name}
          </span>
          <CopyButton text={system.name} />
        </div>
        <div className="row micro" style={{ gap: 14, marginTop: 6 }}>
          {system.legLy !== undefined && <span>{formatNumber(system.legLy, 2)} ly</span>}
          {traffic !== undefined && traffic > 10 && (
            <span className={traffic > 100 ? 'danger' : 'warn'}>Traffic {traffic} today</span>
          )}
          {deaths !== undefined && deaths > 0 && (
            <span className={deaths >= 5 ? 'danger' : 'warn'}>{deaths} ships lost today</span>
          )}
        </div>
      </section>
    </>
  );
}

/**
 * The main tank against its size, the jump range, what the next jump and the rest of the route
 * will burn, and how far off the next star to scoop is.
 */
function Fuel({
  overview,
  fuel,
  cargo,
  route,
  lowFuelFraction,
}: {
  overview: Overview;
  fuel: number | undefined;
  /** Tonnes in the hold, which the drive has to carry too. */
  cargo: number | undefined;
  route: FollowedRoute | undefined;
  lowFuelFraction: number | undefined;
}) {
  const capacity = overview.fuelCapacity;
  const now =
    fuel !== undefined && overview.drive
      ? routeFuel(route, fuel, cargo ?? 0, overview.drive, capacity)
      : undefined;
  // The tank pays for a jump as it starts, but the ship is only a system further along the route
  // once it arrives. In between the route would be counted with that jump still on it, from a
  // tank that has paid for it already; so what was worked out as the countdown began stands.
  const jumping = overview.charging !== undefined;
  const [kept, setKept] = useState<{ fuel: number; burn: RouteFuel | undefined }>();
  if (jumping && !kept && fuel !== undefined) setKept({ fuel, burn: now });
  if (!jumping && kept) setKept(undefined);
  const held = jumping ? kept : undefined;
  const burn = held ? held.burn : now;
  /** The tank the burn was worked out from. */
  const from = held?.fuel ?? fuel ?? 0;
  if (fuel === undefined && overview.maxJumpRange === undefined) return null;
  const share = fuel !== undefined && capacity ? Math.min(1, fuel / capacity) : undefined;
  const low = share !== undefined && lowFuelFraction !== undefined && share < lowFuelFraction;
  const scoop = jumpsToScoopable(route);
  // What will burn comes off the top of the tank: the next jump last on the bar, the rest of the
  // route before it, and neither past what is in the tank.
  const section = (tonnes: number | undefined) => {
    if (tonnes === undefined || fuel === undefined || !capacity) return undefined;
    const start = Math.max(0, Math.min(from, capacity) - tonnes);
    const width = Math.max(0, Math.min(fuel, capacity) - start);
    return { left: `${(start / capacity) * 100}%`, width: `${(width / capacity) * 100}%` };
  };
  const routeSection = section(burn?.route);
  const nextSection = section(burn?.next);
  return (
    <>
      <hr className="hair" />
      <section className="side-block" aria-label="Fuel and range">
        <div className="side-label">
          <span className="ic-w">
            <Glyph name="fuel" />
          </span>
          Fuel &amp; range
        </div>
        <div className="row" style={{ gap: 12, alignItems: 'baseline' }}>
          {fuel !== undefined && (
            <span className={low ? 'side-figure warn' : 'side-figure'}>
              {formatNumber(fuel, 1)}
              {capacity !== undefined && <small> / {formatNumber(capacity, 0)} t</small>}
            </span>
          )}
          <span className="sp" />
          {overview.maxJumpRange !== undefined && (
            <span className="side-aside">
              Range <b>{formatNumber(overview.maxJumpRange, 1)} ly</b>
            </span>
          )}
        </div>
        {share !== undefined && (
          <div className={low ? 'bar thick warn' : 'bar thick'} style={{ margin: '6px 0' }}>
            <i style={{ width: `${share * 100}%` }} />
            {routeSection && <i className="burn-route" style={routeSection} />}
            {nextSection && <i className="burn-next" style={nextSection} />}
            {lowFuelFraction !== undefined && (
              <span
                className="tick"
                style={{ left: `${lowFuelFraction * 100}%` }}
                title={`Low fuel warning at ${formatNumber(lowFuelFraction * 100, 0)}%`}
              />
            )}
          </div>
        )}
        {burn && (
          <div className="row" style={{ gap: 12, marginBottom: 6 }}>
            <span
              className="side-aside"
              title={
                burn.next > from
                  ? 'More than is in the tank'
                  : `Leaves ${formatNumber(from - burn.next, 1)} t in the tank`
              }
            >
              {nextSection && <i className="swatch burn-next" />}
              Next jump{' '}
              <b className={burn.next > from ? 'warn' : undefined}>
                {formatNumber(burn.next, 2)} t
              </b>
            </span>
            <span className="sp" />
            {burn.route !== undefined && (
              <span
                className="side-aside"
                title={
                  `Estimated over the ${burn.legs} ${burn.legs === 1 ? 'system' : 'systems'} left` +
                  (burn.route > from ? ', scooping on the way' : '')
                }
              >
                {routeSection && <i className="swatch burn-route" />}
                Route <b>{formatNumber(burn.route, 1)} t</b>
              </span>
            )}
          </div>
        )}
        {scoop !== undefined && (
          <div className="row micro">
            <span className={scoop === 'none' ? 'warn' : undefined}>
              {scoop === 'none'
                ? 'No scoopable star left on the route'
                : scoop === 0
                  ? 'Scoopable star here'
                  : `Next scoopable star in ${scoop} ${scoop === 1 ? 'jump' : 'jumps'}`}
            </span>
          </div>
        )}
      </section>
    </>
  );
}

/**
 * Jumps from here to the next system on the route whose star can be scooped, 0 for here; `none`
 * when no star ahead can be, and undefined when the route doesn't say what its stars are.
 */
export function jumpsToScoopable(route: FollowedRoute | undefined): number | 'none' | undefined {
  const systems = route?.systems;
  const position = route?.position;
  if (!systems || position === undefined) return undefined;
  let known = false;
  for (let index = position; index < systems.length; index++) {
    const system = systems[index];
    if (!system) continue;
    const scoopable =
      system.starClass !== undefined ? isScoopableClass(system.starClass) : system.scoopable;
    if (scoopable) return index - position;
    if (system.starClass !== undefined) known = true;
  }
  return known ? 'none' : undefined;
}

/** What is unsold across every session, over the balance in the bank. */
function Unsold({
  history,
  balance,
}: {
  history: HistorySnapshot | undefined;
  /** The commander's credit balance, if the journal has said. */
  balance: number | undefined;
}) {
  const ledger = history?.ready ? history.ledger : undefined;
  const lines: DataRow[] = [];
  if (!ledger) {
    lines.push({ label: 'Ledger', value: 'Reading journals…' });
  } else {
    const { cartographics, exobiology } = ledger;
    if (cartographics.value > 0) {
      lines.push({
        label: 'Cartographics',
        value: withSession(cartographics.value, cartographics.sessionValue),
        title: `Estimated: ${cartographics.bodies} bodies in ${cartographics.systems} systems. ${formatCredits(cartographics.sessionValue)} of it since the game was launched`,
      });
    }
    if (exobiology.value > 0) {
      lines.push({
        label: 'Exobiology',
        value: withSession(exobiology.value, exobiology.sessionValue),
        title: `Estimated: ${exobiology.species} species. ${formatCredits(exobiology.sessionValue)} of it since the game was launched`,
      });
    }
    if (ledger.bounties > 0) {
      lines.push({ label: 'Bounties', value: formatCredits(ledger.bounties) });
    }
    if (ledger.combatBonds > 0) {
      lines.push({ label: 'Combat bonds', value: formatCredits(ledger.combatBonds) });
    }
    if (ledger.fines > 0) {
      lines.push({ label: 'Fines', value: formatCredits(ledger.fines), tone: 'warning' });
    }
    if (lines.length === 0) lines.push({ label: 'Data', value: 'All sold' });
  }
  return (
    <section className="side-block" aria-label="Unsold">
      <div className="side-label">
        <span className="ic-w">
          <Glyph name="cargo" />
        </span>
        Unsold
      </div>
      <dl className="kv sm tight">
        {lines.map((line) => (
          <div key={line.label}>
            <dt>{line.label}</dt>
            <dd className={toneClass(line.tone)} title={line.title}>
              {line.value}
            </dd>
          </div>
        ))}
        {balance !== undefined && (
          <div className="total">
            <dt>Balance</dt>
            <dd>{formatCredits(balance)}</dd>
          </div>
        )}
      </dl>
    </section>
  );
}

/** "+100,500 · 100,501 CR": the part earned since the game was launched, then the total. */
function withSession(value: number, sessionValue: number) {
  return (
    <>
      {sessionValue > 0 && <small>+{formatNumber(sessionValue, 0)} · </small>}
      {formatCredits(value)}
    </>
  );
}
