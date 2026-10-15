import { type FormEvent, useEffect, useState } from 'react';

import type { CarrierView } from '../../../shared/carriers';
import {
  type CsvRouteState,
  SAVED_ROUTE_NAME_LENGTH,
  type SavedRouteSummary,
} from '../../../shared/csv-route';
import {
  GALAXY_ALGORITHMS,
  type GalaxyAlgorithm,
  type SpanshCarrierKind,
  type SpanshPlotKind,
  type SpanshPlotRequest,
  type SpanshPlotState,
  spanshPlotTitle,
  spanshResultsUrl,
  type SpanshShipChoice,
} from '../../../shared/spansh-plot';
import { useEdssi } from '../api/context';
import { formatNumber, formatShortDateTime } from '../journal/format';
import { useCarriers } from '../ships/useCarriers';
import { NumberInput, Switch } from './Controls';
import { RouteTable } from './CsvRouteView';
import { Glyph } from './Glyph';
import { RouteNameForm } from './SavedRoutes';
import { Select } from './Select';
import { Suggest } from './Suggest';
import { useNow } from './useNow';

const KINDS: readonly { id: SpanshPlotKind; label: string; help: string }[] = [
  {
    id: 'galaxy',
    label: 'Galaxy',
    help: 'Every jump for this ship, as the galaxy map plots it, fuel and all.',
  },
  {
    id: 'neutron',
    label: 'Neutron',
    help: 'Waypoints at neutron stars: the fastest way across long distances.',
  },
  {
    id: 'carrier',
    label: 'Carrier',
    help: "A fleet carrier's jumps and the tritium they burn.",
  },
];

const ALGORITHMS: Record<GalaxyAlgorithm, { label: string; help: string }> = {
  optimistic: { label: 'Optimistic', help: 'The fastest to plot; usually the fewest jumps.' },
  pessimistic: { label: 'Pessimistic', help: 'Slower to plot, more careful with fuel.' },
  fuel: { label: 'Fuel', help: 'Uses the least fuel.' },
  fuel_jumps: { label: 'Fuel, then jumps', help: 'Least fuel, then fewest jumps.' },
  guided: { label: 'Guided', help: 'Follows a neutron route, filling in the jumps between.' },
};

/**
 * The Route tab's Spansh page: Spansh's galaxy, neutron and fleet carrier plotters, asked the way
 * the galaxy map's route plotter is. A finished route waits here to be looked over, so plotting
 * another doesn't lose the one being flown; Follow makes it the route followed on the CSV route
 * page, and puts its first stop on the clipboard.
 */
export function SpanshPlotView({
  state,
  csvRoute,
  here,
  shown,
  onShowRoute,
  onShowMap,
}: {
  state: SpanshPlotState | undefined;
  /** The route followed now, to tell whether the plotted one is it. */
  csvRoute: CsvRouteState | undefined;
  /** The commander's current system, what an empty From means. */
  here: string | undefined;
  /** The page is the one on show. */
  shown: boolean;
  onShowRoute: () => void;
  onShowMap: () => void;
}) {
  const edssi = useEdssi();
  const [kind, setKind] = useState<SpanshPlotKind>('galaxy');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [multiStop, setMultiStop] = useState(false);
  const [via, setVia] = useState<string[]>(['']);
  const [ships, setShips] = useState<SpanshShipChoice[]>([]);
  /** Unset: the ship being flown. */
  const [shipId, setShipId] = useState<number>();
  const [algorithm, setAlgorithm] = useState<GalaxyAlgorithm>('optimistic');
  const [supercharge, setSupercharge] = useState(true);
  const [injections, setInjections] = useState(false);
  const [excludeSecondary, setExcludeSecondary] = useState(false);
  const [refuelEvery, setRefuelEvery] = useState(true);
  /** Unset: what the ship carries. */
  const [cargo, setCargo] = useState<number>();
  const [reserve, setReserve] = useState(0);
  /** Unset: the ship's own. */
  const [range, setRange] = useState<number>();
  const [efficiency, setEfficiency] = useState(60);
  const [carrierKind, setCarrierKind] = useState<SpanshCarrierKind>('fleet');
  const [carrierId, setCarrierId] = useState<string>();
  const [used, setUsed] = useState(0);
  /** Spansh works out the tritium to start with. */
  const [autoTritium, setAutoTritium] = useState(true);
  const [tank, setTank] = useState(1000);
  const [market, setMarket] = useState(0);
  const carriers = useCarriers();

  // Asked again when the page comes into view: a swap or a new loadout changes them.
  useEffect(() => {
    if (!shown) return undefined;
    let live = true;
    void edssi.spanshPlot.ships().then((list) => {
      if (live) setShips(list);
    });
    return () => {
      live = false;
    };
  }, [edssi, shown, state?.result]);

  if (!state) return <p className="route-empty">Loading…</p>;

  const running = state.running;
  const chosen = ships.find((ship) => ship.id === shipId && !ship.current);
  const flying = chosen ?? ships.find((ship) => ship.current);
  const carrier = kind === 'carrier';
  // Empty stops are left out, so an added row not yet filled in doesn't hold a plot back.
  const stops = multiStop ? via.map((stop) => stop.trim()).filter((stop) => stop !== '') : [];
  const ends = { from: from.trim(), to: to.trim(), ...(stops.length > 0 && { via: stops }) };
  const ship = chosen && { shipId: chosen.id };
  const request = (): SpanshPlotRequest =>
    kind === 'carrier'
      ? {
          kind,
          ...ends,
          carrier: carrierKind,
          used,
          ...(!autoTritium && { tritium: { tank, market } }),
        }
      : kind === 'neutron'
        ? { kind, ...ends, ...ship, efficiency, ...(range !== undefined && { range }) }
        : {
            kind,
            ...ends,
            ...ship,
            algorithm,
            supercharge,
            injections,
            excludeSecondary,
            refuelEveryScoopable: refuelEvery,
            reserve,
            ...(cargo !== undefined && { cargo }),
          };
  const shipProblem =
    carrier || (kind === 'neutron' && range !== undefined)
      ? undefined
      : flying
        ? flying.problem
        : "The journal hasn't shown a ship yet.";
  const tritiumProblem =
    carrier && !autoTritium && market > used
      ? 'The tritium in the market is part of the space used: it can’t be more.'
      : undefined;
  const ready =
    !running &&
    to.trim() !== '' &&
    shipProblem === undefined &&
    tritiumProblem === undefined &&
    (from.trim() !== '' || here !== undefined);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (ready) void edssi.spanshPlot.plot(request());
  };
  const herePlaceholder = here ? `here · ${here}` : 'here';
  const locked = running !== undefined;

  return (
    <>
      <form className="panel pad brk" style={{ flex: 'none' }} onSubmit={submit}>
        {/* Held while a plot runs; Cancel, beside them, is not. */}
        <div className="row" style={{ gap: 14, marginBottom: 14 }} inert={locked}>
          <div className="seg lg">
            {KINDS.map((option) => (
              <button
                key={option.id}
                type="button"
                aria-pressed={kind === option.id}
                title={option.help}
                onClick={() => setKind(option.id)}
              >
                {option.label}
              </button>
            ))}
          </div>
          <span className="hint" style={{ fontSize: 14.5 }}>
            {KINDS.find((option) => option.id === kind)?.help}
          </span>
          <span className="sp" />
          <div
            className="field row"
            style={{ gap: 8 }}
            title="Plot through stops on the way, in order: Sol → Colonia → Beagle Point → Sol"
          >
            <span className="label">Stops on the way</span>
            <Switch checked={multiStop} onChange={setMultiStop} />
          </div>
        </div>
        {multiStop ? (
          <StopsFields
            from={from}
            via={via}
            to={to}
            onFrom={setFrom}
            onVia={setVia}
            onTo={setTo}
            herePlaceholder={herePlaceholder}
            locked={locked}
          />
        ) : (
          <div className="plot-fields" inert={locked}>
            <SystemField
              label="From"
              value={from}
              onChange={setFrom}
              placeholder={herePlaceholder}
              here
            />
            <button
              type="button"
              className="ibtn swap"
              aria-label="Swap from and to"
              title="Swap"
              onClick={() => {
                setFrom(to);
                setTo(from);
              }}
            >
              <Glyph name="swap" />
            </button>
            <SystemField label="To" value={to} onChange={setTo} placeholder="" />
          </div>
        )}
        <div className="plot-opts">
          <div className="plot-set" inert={locked}>
            {!carrier && <ShipChoice ships={ships} value={chosen?.id} onChange={setShipId} />}
            {kind === 'galaxy' && (
              <>
                <div className="field" title={ALGORITHMS[algorithm].help}>
                  <span className="label">Routing</span>
                  <Select
                    aria-label="Routing"
                    value={algorithm}
                    options={GALAXY_ALGORITHMS.map((value) => ({
                      value,
                      label: ALGORITHMS[value].label,
                    }))}
                    onChange={setAlgorithm}
                  />
                </div>
                <div className="field" title="Supercharge at neutron stars and white dwarfs">
                  <span className="label">Neutron boosts</span>
                  <Switch checked={supercharge} onChange={setSupercharge} />
                </div>
                <div className="field" title="Plan on synthesised FSD injections">
                  <span className="label">FSD injections</span>
                  <Switch checked={injections} onChange={setInjections} />
                </div>
                <div className="field" title="Only scoop from the main star of each system">
                  <span className="label">Main star only</span>
                  <Switch checked={excludeSecondary} onChange={setExcludeSecondary} />
                </div>
                <div
                  className="field"
                  title="Fill the tank at every scoopable star, not only where the route has to"
                >
                  <span className="label">Refuel at every scoopable</span>
                  <Switch checked={refuelEvery} onChange={setRefuelEvery} />
                </div>
                <div className="field" title="In the hold; the ship's cargo now unless changed">
                  <span className="label">Cargo</span>
                  <NumberInput
                    unit="t"
                    size="sm"
                    label="Cargo"
                    value={cargo ?? flying?.cargo ?? 0}
                    onChange={setCargo}
                    min={0}
                    max={10_000}
                    style={{ width: 110 }}
                  />
                </div>
                <div className="field" title="Fuel the route never dips into">
                  <span className="label">Reserve</span>
                  <NumberInput
                    unit="t"
                    size="sm"
                    label="Reserve"
                    value={reserve}
                    onChange={setReserve}
                    min={0}
                    max={1000}
                    digits={1}
                    style={{ width: 100 }}
                  />
                </div>
              </>
            )}
            {kind === 'neutron' && (
              <>
                <div className="field" title="The ship's on a full tank unless changed">
                  <span className="label">Jump range</span>
                  <NumberInput
                    unit="ly"
                    size="sm"
                    label="Jump range"
                    value={range ?? (flying?.range && Math.floor(flying.range * 100) / 100)}
                    onChange={setRange}
                    min={1}
                    max={1000}
                    digits={2}
                    style={{ width: 120 }}
                  />
                </div>
                <div
                  className="field"
                  title="How near the straight line the route stays: higher strays less for neutron stars"
                >
                  <span className="label">Efficiency</span>
                  <NumberInput
                    unit="%"
                    size="sm"
                    label="Efficiency"
                    value={efficiency}
                    onChange={setEfficiency}
                    min={1}
                    max={100}
                    style={{ width: 100 }}
                  />
                </div>
              </>
            )}
            {carrier && (
              <>
                <CarrierChoice
                  carriers={carriers?.carriers}
                  value={carrierId}
                  onChange={(picked) => {
                    setCarrierId(picked?.carrierId);
                    if (!picked) return;
                    setCarrierKind(picked.kind === 'squadron' ? 'squadron' : 'fleet');
                    const load = carrierLoad(picked);
                    if (load.used !== undefined) setUsed(load.used);
                    if (load.tank !== undefined) {
                      setTank(load.tank);
                      setMarket(Math.min(load.market, load.used ?? load.market));
                      setAutoTritium(false);
                    }
                  }}
                />
                <div className="field">
                  <span className="label">Type</span>
                  <div className="seg lg">
                    {(['fleet', 'squadron'] as const).map((value) => (
                      <button
                        key={value}
                        type="button"
                        aria-pressed={carrierKind === value}
                        onClick={() => setCarrierKind(value)}
                      >
                        {value === 'fleet' ? 'Fleet' : 'Squadron'}
                      </button>
                    ))}
                  </div>
                </div>
                <div
                  className="field"
                  title="Everything aboard: cargo, services, packs and the tritium in the market (Carrier management's used capacity)"
                >
                  <span className="label">Space used</span>
                  <NumberInput
                    unit="t"
                    size="sm"
                    label="Space used"
                    value={used}
                    onChange={setUsed}
                    min={0}
                    max={60_000}
                    style={{ width: 130 }}
                  />
                </div>
                <div
                  className="field"
                  title="Let Spansh work out the tritium to start with, rather than what is aboard"
                >
                  <span className="label">Tritium to start</span>
                  <Switch
                    checked={autoTritium}
                    onChange={setAutoTritium}
                    label={autoTritium ? 'Spansh decides' : 'As aboard'}
                  />
                </div>
                {!autoTritium && (
                  <>
                    <div className="field">
                      <span className="label">In tank</span>
                      <NumberInput
                        unit="t"
                        size="sm"
                        label="Tritium in tank"
                        value={tank}
                        onChange={setTank}
                        min={0}
                        max={1000}
                        style={{ width: 110 }}
                      />
                    </div>
                    <div className="field">
                      <span className="label">In market</span>
                      <NumberInput
                        unit="t"
                        size="sm"
                        label="Tritium in market"
                        value={market}
                        onChange={setMarket}
                        min={0}
                        max={60_000}
                        style={{ width: 120 }}
                      />
                    </div>
                  </>
                )}
              </>
            )}
          </div>
          <div className="plot-go">
            {running ? (
              <button
                type="button"
                className="btn danger lg"
                onClick={() => void edssi.spanshPlot.cancel()}
              >
                <span className="ic-w">
                  <Glyph name="stop" />
                </span>
                Cancel
              </button>
            ) : (
              <button type="submit" className="btn primary lg" disabled={!ready}>
                <span className="ic-w">
                  <Glyph name="route" />
                </span>
                Plot
              </button>
            )}
            {!carrier &&
              (shipProblem !== undefined ? (
                <span className="hint">{shipProblem}</span>
              ) : (
                flying?.range !== undefined && <span className="hint">{shipLine(flying)}</span>
              ))}
          </div>
        </div>
      </form>
      {tritiumProblem && (
        <p className="note">
          <span className="ic-w">
            <Glyph name="warning" />
          </span>
          {tritiumProblem}
        </p>
      )}
      {running && <Progress running={running} here={here} />}
      {!running && state.last?.error !== undefined && <PlotError last={state.last} here={here} />}
      {state.result && (
        <PlotResult
          // Another plot starts over: a name half typed was for the last one.
          key={state.result.route.loadedAt}
          result={state.result}
          saved={csvRoute?.saved ?? []}
          following={
            state.result.followedAt !== undefined &&
            csvRoute?.route?.loadedAt === state.result.followedAt
          }
          onShowRoute={onShowRoute}
          onShowMap={onShowMap}
        />
      )}
    </>
  );
}

function plural(count: number, word: string): string {
  return count === 1 ? word : `${word}s`;
}

function shipLine(ship: SpanshShipChoice): string {
  const boost =
    ship.supercharge !== undefined && ship.supercharge !== 4
      ? ` · ×${formatNumber(ship.supercharge, 0)} supercharge`
      : '';
  return `${ship.label} · ${formatNumber(ship.range ?? 0, 1)} ly${boost}`;
}

/** A carrier's space used, tank and market tritium, as far as EDSSI knows them. */
function carrierLoad(carrier: CarrierView): { used?: number; tank?: number; market: number } {
  const { space, fuel } = carrier;
  return {
    ...(space && { used: Math.max(0, space.capacity - space.free) }),
    ...(fuel && { tank: Math.round(fuel.level) }),
    market: carrier.cargo.find((item) => item.type === 'tritium')?.count ?? 0,
  };
}

function Progress({
  running,
  here,
}: {
  running: NonNullable<SpanshPlotState['running']>;
  here: string | undefined;
}) {
  const now = useNow();
  const elapsed = Math.max(0, (now - Date.parse(running.startedAt)) / 1000);
  const { leg } = running;
  return (
    <section className="panel pad" style={{ flex: 'none' }} aria-label="Plotting">
      <div className="row" style={{ marginBottom: 10 }}>
        <span className="sec-title" style={{ fontSize: 19 }}>
          {spanshPlotTitle(running.request, here)}
        </span>
        <span className="sp" />
        <span className="micro">
          {running.job ? 'Plotting on Spansh' : 'Asking Spansh'}
          {leg && ` · leg ${leg.at} of ${leg.of}`} · {Math.round(elapsed)} s
        </span>
      </div>
      <div className="bar thick plot-wait">
        <i />
      </div>
    </section>
  );
}

function PlotError({
  last,
  here,
}: {
  last: NonNullable<SpanshPlotState['last']>;
  here: string | undefined;
}) {
  const { error } = last;
  const cancelled = error === 'cancelled';
  return (
    <p className={cancelled ? 'note info' : 'note danger'}>
      <span className="ic-w">
        <Glyph name="warning" />
      </span>
      {spanshPlotTitle(last.request, here)}: {cancelled ? 'cancelled.' : error}
    </p>
  );
}

/**
 * The last route plotted: what it comes to, every stop, and the buttons that follow it, or save
 * it under a name to follow later.
 */
function PlotResult({
  result,
  saved,
  following,
  onShowRoute,
  onShowMap,
}: {
  result: NonNullable<SpanshPlotState['result']>;
  /** The CSV route page's saved routes. */
  saved: readonly SavedRouteSummary[];
  /** It is the route followed now. */
  following: boolean;
  onShowRoute: () => void;
  onShowMap: () => void;
}) {
  const edssi = useEdssi();
  const { request, summary, route, jobs } = result;
  const [naming, setNaming] = useState(false);
  const [problem, setProblem] = useState<string>();
  // Still saved, and still this route: its name can be deleted, or taken by another since.
  const savedAs = saved.find(
    (entry) =>
      entry.id === route.savedId &&
      entry.fileName === route.fileName &&
      entry.systems === route.systems.length,
  );
  const neutron = request.kind === 'neutron';
  return (
    <section className="sec" style={{ flex: '1 1 auto' }} aria-label="Plotted route">
      <div className="sec-head">
        <h2
          className="sec-title"
          title={`${route.fileName} · ${formatShortDateTime(route.loadedAt)}, in ${formatNumber(summary.seconds, 0)} s`}
        >
          Plotted
        </h2>
        <span className="sum-fig">
          <b>{formatNumber(summary.jumps, 0)}</b> {plural(summary.jumps, 'jump')}
        </span>
        {neutron && (
          <span className="sum-fig" title="Systems listed: each is several jumps from the last">
            <b>{formatNumber(summary.stops, 0)}</b> waypoints
          </span>
        )}
        {summary.supercharged !== undefined && summary.supercharged > 0 && (
          <span className="sum-fig">
            <b>{formatNumber(summary.supercharged, 0)}</b> supercharged
          </span>
        )}
        {summary.refuels !== undefined && summary.refuels > 0 && (
          <span className="sum-fig">
            <b>{formatNumber(summary.refuels, 0)}</b> {plural(summary.refuels, 'refuel')}
          </span>
        )}
        {summary.injections !== undefined && summary.injections > 0 && (
          <span className="sum-fig">
            <b>{formatNumber(summary.injections, 0)}</b> injected
          </span>
        )}
        {summary.tritium !== undefined && (
          <span className="sum-fig">
            <b>{formatNumber(summary.tritium, 0)}</b> t tritium
          </span>
        )}
        {summary.restocks !== undefined && summary.restocks > 0 && (
          <span className="sum-fig" title="Stops where tritium has to be bought">
            <b>{formatNumber(summary.restocks, 0)}</b> {plural(summary.restocks, 'restock')}
          </span>
        )}
        <span className="sum-fig">
          <b>{formatNumber(summary.distance, 0)}</b> ly
        </span>
        <div className="sec-meta">
          {jobs[0] && (
            <a
              className="link"
              href={spanshResultsUrl(request.kind, jobs[0])}
              target="_blank"
              rel="noreferrer"
              title={jobs.length > 1 ? 'The first leg, on Spansh' : 'This route, on Spansh'}
            >
              Spansh
            </a>
          )}
          <button type="button" className="link" onClick={onShowMap}>
            Map
          </button>
          {savedAs ? (
            <span className="micro" title="Among the saved routes on the CSV route page">
              <span className="micro-ic">
                <Glyph name="check" />
              </span>
              Saved as {savedAs.name}
            </span>
          ) : (
            // Followed, it is saved from the CSV route page, where it keeps its place.
            !following &&
            !naming && (
              <button
                type="button"
                className="btn ghost sm"
                title="Saves it under a name on the CSV route page, to follow later; the route followed now stays"
                onClick={() => setNaming(true)}
              >
                <span className="ic-w">
                  <Glyph name="pin" />
                </span>
                Save
              </button>
            )
          )}
          {following ? (
            <button
              type="button"
              className="btn ghost sm"
              title="It is the route followed on the CSV route page"
              onClick={onShowRoute}
            >
              Following · show it
            </button>
          ) : (
            <button
              type="button"
              className="btn primary sm"
              title={
                result.followedAt === undefined
                  ? 'Replaces the CSV route with this one, and copies its first stop'
                  : 'Followed before, but another route has been loaded since: follow it again'
              }
              onClick={() => void edssi.spanshPlot.follow()}
            >
              <span className="ic-w">
                <Glyph name="play" />
              </span>
              Follow this route
            </button>
          )}
        </div>
      </div>
      {naming && !savedAs && !following && (
        <RouteNameForm
          initial={route.fileName.slice(0, SAVED_ROUTE_NAME_LENGTH)}
          saved={saved}
          onSubmit={(name) => edssi.spanshPlot.save(name)}
          onDone={(outcome) => {
            setProblem(outcome);
            if (outcome === undefined) setNaming(false);
          }}
          onCancel={() => {
            setProblem(undefined);
            setNaming(false);
          }}
        />
      )}
      {problem && (
        <p className="note danger" role="alert">
          <span className="ic-w">
            <Glyph name="warning" />
          </span>
          {problem}
        </p>
      )}
      <RouteTable route={route} compact />
    </section>
  );
}

/** The ship to plot for: the one being flown (the default), or any other the commander owns. */
function ShipChoice({
  ships,
  value,
  onChange,
}: {
  ships: readonly SpanshShipChoice[];
  /** Unset: the ship being flown. */
  value: number | undefined;
  onChange: (shipId: number | undefined) => void;
}) {
  const current = ships.find((ship) => ship.current);
  const others = ships.filter((ship) => !ship.current);
  return (
    <div className="field">
      <span className="label">Ship</span>
      <Select<number | ''>
        aria-label="Ship"
        value={value ?? ''}
        options={[
          { value: '', label: current ? `${current.label} · flying` : 'The ship being flown' },
          ...others.map((ship) => ({
            value: ship.id,
            label: [
              ship.label,
              ship.range === undefined ? 'no loadout' : `${formatNumber(ship.range, 1)} ly`,
              ...(ship.where !== undefined ? [ship.where] : []),
            ].join(' · '),
          })),
        ]}
        onChange={(picked) => onChange(picked === '' ? undefined : picked)}
      />
    </div>
  );
}

/** Fills the carrier plot's figures from one of the commander's carriers, as EDSSI last knew it. */
function CarrierChoice({
  carriers,
  value,
  onChange,
}: {
  /** Unset while the history is read. */
  carriers: readonly CarrierView[] | undefined;
  value: string | undefined;
  onChange: (carrier: CarrierView | undefined) => void;
}) {
  const none = carriers !== undefined && carriers.length === 0;
  return (
    <div
      className="field"
      title={
        none
          ? "The journal names no carrier of the commander's or their squadron's"
          : 'Fills in the space used and the tritium aboard from that carrier'
      }
    >
      <span className="label">Carrier</span>
      <Select
        aria-label="Carrier"
        value={value ?? ''}
        placeholder={!carriers ? 'Loading…' : none ? 'No carrier known' : 'Select carrier'}
        options={(carriers ?? []).map((entry) => ({
          value: entry.carrierId,
          label: [
            entry.name ?? entry.callsign ?? entry.carrierId,
            ...(entry.callsign !== undefined && entry.name !== undefined ? [entry.callsign] : []),
            ...(entry.kind === 'squadron' ? ['squadron'] : []),
          ].join(' · '),
        }))}
        onChange={(picked) => onChange(carriers?.find((entry) => entry.carrierId === picked))}
      />
    </div>
  );
}

/**
 * From, the stops on the way and To, one row each: a stop can be added after any row but the last,
 * and removed. Reversing turns the whole trip round.
 */
function StopsFields({
  from,
  via,
  to,
  onFrom,
  onVia,
  onTo,
  herePlaceholder,
  locked,
}: {
  from: string;
  via: readonly string[];
  to: string;
  onFrom: (value: string) => void;
  onVia: (value: string[]) => void;
  onTo: (value: string) => void;
  herePlaceholder: string;
  locked: boolean;
}) {
  const insert = (at: number) => onVia([...via.slice(0, at), '', ...via.slice(at)]);
  const addButton = (at: number) => (
    <button
      type="button"
      className="ibtn sm"
      aria-label="Add a stop after this one"
      title="Add a stop after this one"
      onClick={() => insert(at)}
    >
      <Glyph name="plus" />
    </button>
  );
  return (
    <div className="plot-stops" inert={locked}>
      <div className="plot-stop">
        <SystemField
          label="From"
          value={from}
          onChange={onFrom}
          placeholder={herePlaceholder}
          here
        />
        {addButton(0)}
        <span />
      </div>
      {via.map((stop, index) => (
        // The rows are only ever told apart by where they are.
        // oxlint-disable-next-line react/no-array-index-key
        <div className="plot-stop" key={index}>
          <SystemField
            label={`Stop ${index + 1}`}
            value={stop}
            onChange={(value) => onVia(via.map((old, at) => (at === index ? value : old)))}
            placeholder=""
          />
          {addButton(index + 1)}
          <button
            type="button"
            className="ibtn sm"
            aria-label={`Remove stop ${index + 1}`}
            title="Remove this stop"
            onClick={() => onVia(via.filter((_, at) => at !== index))}
          >
            <Glyph name="close" />
          </button>
        </div>
      ))}
      <div className="plot-stop">
        <SystemField label="To" value={to} onChange={onTo} placeholder="" />
        <span />
        <button
          type="button"
          className="ibtn sm"
          aria-label="Reverse the trip"
          title="Reverse the trip"
          onClick={() => {
            onFrom(to);
            onTo(from);
            onVia(via.toReversed());
          }}
        >
          <Glyph name="swap" />
        </button>
      </div>
    </div>
  );
}

/** How long typing rests before Spansh is asked for names. */
const SUGGEST_DELAY_MS = 250;

/** A system's name, with the names Spansh knows starting like it suggested. */
function SystemField({
  label,
  value,
  onChange,
  placeholder,
  here = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  /** Empty means where the commander is. */
  here?: boolean;
}) {
  const edssi = useEdssi();
  const [names, setNames] = useState<string[]>([]);
  useEffect(() => {
    const typed = value.trim();
    if (typed.length < 2) return undefined;
    let live = true;
    const timer = setTimeout(() => {
      void edssi.spanshPlot.systems(typed).then((found) => {
        if (live) setNames(found);
      });
    }, SUGGEST_DELAY_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [edssi, value]);
  return (
    <label className="field">
      <span className="label">{label}</span>
      <span className="input">
        {here && (
          <span className="ic-w">
            <Glyph name="target" />
          </span>
        )}
        <Suggest
          value={value}
          onChange={onChange}
          suggestions={value.trim().length < 2 ? [] : names}
          placeholder={placeholder}
          spellCheck={false}
        />
      </span>
    </label>
  );
}
