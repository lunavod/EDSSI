/**
 * The Route tab's Spansh page: Spansh's galaxy, neutron and fleet carrier plotters, asked from a
 * form the way the galaxy map's route plotter is. These are the shapes that cross between the
 * window and `src/main/spansh-plot-service.ts`, and the pure folding of each plotter's answer into
 * the CSV route the Route tab follows, under the column names of Spansh's own CSV exports.
 */

import type { CsvRoute, CsvRouteSystem } from './csv-route';

/**
 * - `galaxy`: Spansh's galaxy plotter, an exact route for the ship: fuel, where to scoop, neutron
 *   boosts, FSD injections.
 * - `neutron`: Spansh's neutron plotter, waypoints at neutron stars, several jumps apart.
 * - `carrier`: Spansh's fleet carrier plotter: jumps of up to 500 ly and the tritium they burn.
 */
export const SPANSH_PLOT_KINDS = ['galaxy', 'neutron', 'carrier'] as const;

export type SpanshPlotKind = (typeof SPANSH_PLOT_KINDS)[number];

/** The galaxy plotter's routing algorithms, as Spansh names them. */
export const GALAXY_ALGORITHMS = [
  'optimistic',
  'pessimistic',
  'fuel',
  'fuel_jumps',
  'guided',
] as const;

export type GalaxyAlgorithm = (typeof GALAXY_ALGORITHMS)[number];

export const CARRIER_KINDS = ['fleet', 'squadron'] as const;

export type SpanshCarrierKind = (typeof CARRIER_KINDS)[number];

/** A system by name; empty means the commander's current system. */
export type SystemName = string;

interface PlotEnds {
  from: SystemName;
  to: SystemName;
  /** Systems to pass through, in order. */
  via?: SystemName[];
}

export interface GalaxyPlotRequest extends PlotEnds {
  kind: 'galaxy';
  /** The commander's ship to fly (the journal's `ShipID`); unset: the one being flown. */
  shipId?: number;
  algorithm: GalaxyAlgorithm;
  /** Jump through neutron stars and white dwarfs. */
  supercharge: boolean;
  /** Plan on synthesised FSD injections. */
  injections: boolean;
  /** Only scoop from the main star. */
  excludeSecondary: boolean;
  /** Fill the tank at every scoopable star, not only where it must. */
  refuelEveryScoopable: boolean;
  /** In the hold, t; unset: what the ship carries now (none for another ship). */
  cargo?: number;
  /** Fuel never to dip into, t. */
  reserve: number;
}

export interface NeutronPlotRequest extends PlotEnds {
  kind: 'neutron';
  shipId?: number;
  /** Ly; unset: the ship's, on a full tank with what it carries. */
  range?: number;
  /** 1–100: how near the straight line it stays, at the cost of neutron stars. */
  efficiency: number;
}

export interface CarrierPlotRequest extends PlotEnds {
  kind: 'carrier';
  carrier: SpanshCarrierKind;
  /** Space used, t: cargo, services, packs and the tritium in the market. */
  used: number;
  /** Tritium in the tank and in the market, t; unset: Spansh works out what to start with. */
  tritium?: { tank: number; market: number };
}

export type SpanshPlotRequest = GalaxyPlotRequest | NeutronPlotRequest | CarrierPlotRequest;

/** What a route comes to, for the head of the result. Unset figures don't apply to its kind. */
export interface SpanshPlotSummary {
  /** The jumps flown: a neutron route's waypoints are several jumps apart. */
  jumps: number;
  /** Stops listed: systems on a galaxy or carrier route, waypoints on a neutron one. */
  stops: number;
  distance: number;
  supercharged?: number;
  refuels?: number;
  injections?: number;
  /** A carrier route: tritium burnt, t. */
  tritium?: number;
  /** A carrier route: stops where tritium has to be bought. */
  restocks?: number;
  /** How long Spansh took, s. */
  seconds: number;
}

/** A ship the Spansh page offers to fly: every ship the commander owns. */
export interface SpanshShipChoice {
  /** The journal's `ShipID`. */
  id: number;
  /** "Wanderer (Python Mk II)", or the type alone for an unnamed ship. */
  label: string;
  current: boolean;
  /** Where it is kept, when it isn't the ship being flown. */
  where?: string;
  /** Ly on a full tank with what it carries; unset when there is no loadout, and `problem` says why. */
  range?: number;
  /** How far a neutron boost multiplies its range. */
  supercharge?: number;
  /** In the hold now, t. */
  cargo?: number;
  problem?: string;
}

/** What the Spansh page shows. */
export interface SpanshPlotState {
  /** The plot under way. */
  running?: {
    request: SpanshPlotRequest;
    startedAt: string;
    /** Spansh's job, once it is queued: the leg being plotted, of a galaxy route with stops. */
    job?: string;
    leg?: { at: number; of: number };
  };
  /** The last route plotted, to look over before following it. */
  result?: {
    request: SpanshPlotRequest;
    summary: SpanshPlotSummary;
    /** As the CSV route would be; `loadedAt` is when it was plotted. */
    route: CsvRoute;
    /** Spansh's jobs, one per leg, for its own results page. */
    jobs: string[];
    /** When it was last made the followed route (its `loadedAt` there); unset if it never was. */
    followedAt?: string;
  };
  /** How the last plot ended. */
  last?: {
    request: SpanshPlotRequest;
    finishedAt: string;
    /** Why it failed; `cancelled` when it was stopped. */
    error?: string;
  };
}

/** One plotter's answer as Spansh gives it: the `result` of a finished job. */
export type SpanshRouteResult = unknown;

/** Spansh's own results page for a job. */
export function spanshResultsUrl(kind: SpanshPlotKind, job: string): string {
  const page =
    kind === 'galaxy' ? 'exact-plotter' : kind === 'neutron' ? 'plotter' : 'fleet-carrier';
  return `https://spansh.co.uk/${page}/results/${encodeURIComponent(job)}`;
}

const KIND_NAMES: Record<SpanshPlotKind, string> = {
  galaxy: 'galaxy',
  neutron: 'neutron',
  carrier: 'carrier',
};

/** What the plot is, in a few words: "Sol → Colonia · neutron". */
export function spanshPlotTitle(request: SpanshPlotRequest, here?: string): string {
  const name = (system: string): string => system.trim() || here || 'here';
  const places = [request.from, ...(request.via ?? []), request.to].map(name).join(' → ');
  return `${places} · ${KIND_NAMES[request.kind]}`;
}

/** Spansh's galaxy plotter's CSV columns, and `Inject` for the jumps that need an injection. */
const GALAXY_COLUMNS = [
  'Distance',
  'Distance Remaining',
  'Fuel Left',
  'Fuel Used',
  'Refuel',
  'Neutron Star',
  'Inject',
];
/** Spansh's neutron plotter's CSV columns. */
const NEUTRON_COLUMNS = ['Distance', 'Distance Remaining', 'Neutron Star', 'Jumps'];
/** Spansh's fleet carrier plotter's CSV columns. */
const CARRIER_COLUMNS = [
  'Distance',
  'Distance Remaining',
  'Tritium in tank',
  'Tritium in market',
  'Fuel Used',
  'Icy Ring',
  'Pristine',
  'Restock Tritium',
];

/** One stop as Spansh lists it; anything it leaves out is undefined. */
type Row = Record<string, unknown>;

/**
 * A plotter's answer as the Route tab's followed route, with its summary. A galaxy route with stops
 * on the way is one answer per leg, joined: each leg after the first starts where the last ended,
 * so its first stop is left out. Throws when the answer isn't the plotter's shape.
 */
export function spanshToCsvRoute(
  kind: SpanshPlotKind,
  legs: readonly SpanshRouteResult[],
  title: string,
  loadedAt: string,
): { route: CsvRoute; summary: Omit<SpanshPlotSummary, 'seconds'> } {
  const rows = legs.flatMap((leg, index) => {
    const listed = kind === 'neutron' ? field(leg, 'system_jumps') : field(leg, 'jumps');
    if (!Array.isArray(listed)) throw new Error("Spansh's answer lists no systems.");
    const stops = listed.filter(isRow);
    return index === 0 ? stops : stops.slice(1);
  });
  if (rows.length === 0) throw new Error("Spansh's answer lists no systems.");
  const name = kind === 'neutron' ? 'system' : 'name';
  const route = (columns: string[], values: (row: Row, index: number) => string[]): CsvRoute => ({
    fileName: title,
    loadedAt,
    columns,
    systems: rows.map((row, index): CsvRouteSystem => {
      const [x, y, z] = [num(row['x']), num(row['y']), num(row['z'])];
      return {
        name: text(row[name]),
        values: values(row, index),
        ...(x !== undefined && y !== undefined && z !== undefined && { coords: [x, y, z] }),
      };
    }),
  });

  if (kind === 'neutron') {
    // Each leg's distances left run to its own end; the route's run to the last.
    const jumped = rows.map((row, index) => (index === 0 ? 0 : (num(row['distance_jumped']) ?? 0)));
    const distance = sum(jumped);
    let left = distance;
    return {
      route: route(NEUTRON_COLUMNS, (row, index) => {
        left -= jumped[index]!;
        return [
          figure(jumped[index]),
          figure(Math.max(0, left)),
          yesNo(row['neutron_star']),
          String(num(row['jumps']) ?? 0),
        ];
      }),
      summary: {
        jumps: sum(rows.map((row) => num(row['jumps']) ?? 0)),
        stops: rows.length,
        distance,
        supercharged: rows.filter((row) => row['neutron_star'] === true).length,
      },
    };
  }

  const distances = rows.map((row, index) => (index === 0 ? 0 : (num(row['distance']) ?? 0)));
  const distance = sum(distances);
  let left = distance;
  const remaining = distances.map((jumped) => {
    left -= jumped;
    return figure(Math.max(0, left));
  });
  const fuelUsed = (row: Row) => figure(num(row['fuel_used']));

  if (kind === 'carrier') {
    return {
      route: route(CARRIER_COLUMNS, (row, index) => [
        figure(distances[index]),
        remaining[index]!,
        String(num(row['fuel_in_tank']) ?? ''),
        String(num(row['tritium_in_market']) ?? ''),
        fuelUsed(row),
        yesNo(row['has_icy_ring']),
        yesNo(row['is_system_pristine']),
        String(num(row['restock_amount']) ?? 0),
      ]),
      summary: {
        jumps: rows.length - 1,
        stops: rows.length,
        distance,
        tritium: sum(rows.map((row) => num(row['fuel_used']) ?? 0)),
        restocks: rows.filter((row) => (num(row['must_restock']) ?? 0) > 0).length,
      },
    };
  }

  return {
    route: route(GALAXY_COLUMNS, (row, index) => [
      figure(distances[index]),
      remaining[index]!,
      figure(num(row['fuel_in_tank'])),
      fuelUsed(row),
      yesNo(row['must_refuel']),
      yesNo(row['has_neutron']),
      yesNo((num(row['must_inject']) ?? 0) > 0),
    ]),
    summary: {
      jumps: rows.length - 1,
      stops: rows.length,
      distance,
      supercharged: rows.filter((row) => row['has_neutron'] === true).length,
      refuels: rows.filter((row) => row['must_refuel'] === true).length,
      injections: rows.filter((row) => (num(row['must_inject']) ?? 0) > 0).length,
    },
  };
}

function isRow(value: unknown): value is Row {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function field(value: unknown, key: string): unknown {
  return isRow(value) ? value[key] : undefined;
}

function num(value: unknown): number | undefined {
  // id64s and the like arrive as bigints; a figure never does, but take one all the same.
  const number = typeof value === 'bigint' ? Number(value) : value;
  return typeof number === 'number' && Number.isFinite(number) ? number : undefined;
}

function text(value: unknown): string {
  if (typeof value === 'string') return value;
  return typeof value === 'number' || typeof value === 'bigint' ? String(value) : '';
}

/** Two places, as the route table shows them; empty when unknown. */
function figure(value: number | undefined): string {
  return value === undefined ? '' : String(Math.round(value * 100) / 100);
}

function yesNo(value: unknown): string {
  return value === true || value === 1 ? 'Yes' : 'No';
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
