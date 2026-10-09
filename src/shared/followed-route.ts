import {
  columnValue,
  type CsvRoute,
  type CsvRouteState,
  positionAfterArriving,
  scoopableAt,
  starClassAt,
  toNumber,
} from './csv-route';
import {
  activeRoute,
  distanceLy,
  positionOf,
  type PlottedRoute,
  routeLengthLy,
  unknownToEdsm,
} from './nav-routes';

/** One system of the route the HUD follows, whichever kind of route it is. */
export interface FollowedSystem {
  name: string;
  /** A plotted route knows it, and a CSV route that names its stars. */
  starClass?: string;
  /**
   * A fuel scoop works there, as the route says without a star class: a CSV route's Refuel column
   * (`scoopableAt`), which never says no.
   */
  scoopable?: true;
  /** Light years from the system before; unknown for the first, and for a CSV without distances. */
  legLy?: number;
}

/** The route the HUD shows: the one plotted in the game, or else a CSV route being flown. */
export interface FollowedRoute {
  source: 'plotted' | 'csv';
  /** Start first. Missing when a plotted route's systems weren't recorded. */
  systems?: FollowedSystem[];
  /**
   * Where the commander is on it (0 = start); missing when off it. On a CSV route flown with a
   * plot, the last of its systems reached, though the plot may have left it for a few jumps since.
   */
  position?: number;
  /** Light years from `position` to the end, when known. */
  lyLeft?: number;
  /** How many of the systems ahead EDSM doesn't know; a plotted route's, once it has been asked. */
  unknownAhead?: number;
}

/**
 * The route being followed: a plotted route while the game has one, otherwise the CSV route when
 * the commander is in one of its systems, so a CSV route flown without plotting shows the same.
 * A plot that is only a stretch of the CSV route shows the CSV route, as the one really flown.
 */
export function followedRoute(
  routes: readonly PlottedRoute[],
  csv: CsvRouteState | undefined,
  systemAddress: number | bigint | undefined,
): FollowedRoute | undefined {
  const plotted = activeRoute(routes);
  if (plotted) {
    const along = plottedAlongCsv(plotted, csv);
    return along === undefined || !csv?.route
      ? fromPlotted(plotted, systemAddress)
      : fromCsv(csv.route, along);
  }
  if (csv?.route && csv.here && csv.position !== undefined) {
    return fromCsv(csv.route, csv.position);
  }
  return undefined;
}

/**
 * Whether a plotted route is a stretch of the CSV route: it ends at one of the CSV route's
 * systems further along than where it starts, which is a CSV system too, or else the one the
 * commander last reached (a plot made after straying between two of the CSV's systems, as a
 * neutron route's waypoints are several jumps apart). The systems between may be the game's own.
 * Answers where on the CSV route the commander is: the stretch's start, or the last CSV system
 * reached along it.
 */
export function plottedAlongCsv(
  plotted: PlottedRoute,
  csv: CsvRouteState | undefined,
): number | undefined {
  const systems = plotted.systems;
  const route = csv?.route;
  if (!route || !systems || systems.length < 2) return undefined;
  const start = positionAfterArriving(route.systems, csv.position, systems[0]!.StarSystem);
  const from = start ?? csv.position;
  if (from === undefined) return undefined;
  const to = positionAfterArriving(route.systems, from + 1, systems.at(-1)!.StarSystem);
  if (to === undefined || to <= from) return undefined;
  return Math.max(from, csv.position ?? from);
}

function fromPlotted(
  route: PlottedRoute,
  systemAddress: number | bigint | undefined,
): FollowedRoute {
  const { systems } = route;
  if (!systems) return { source: 'plotted' };
  const position = positionOf(route, systemAddress);
  return {
    source: 'plotted',
    systems: systems.map((system, index) => ({
      name: system.StarSystem,
      starClass: system.StarClass,
      legLy: index > 0 ? distanceLy(systems[index - 1]!, system) : undefined,
    })),
    position,
    lyLeft: position === undefined ? undefined : routeLengthLy(systems, position),
    unknownAhead:
      position === undefined ? undefined : unknownToEdsm(route.edsm, systems.slice(position + 1)),
  };
}

/** Spansh's column of what is left to fly from each row. */
const REMAINING = /distance.*remain/i;
/** Spansh's galaxy plotter's column of each jump's length (not "Distance To Arrival"). */
const JUMPED = /^(distance|jump distance|distance jumped)$/i;

/**
 * The route the assistant talks about: the followed one, or else a loaded CSV route the commander
 * isn't in a system of, measured from the last of its systems they reached (or from before its
 * start, `position` -1, when they have reached none), with `onRoute` false.
 */
export function routeForAssistant(
  routes: readonly PlottedRoute[],
  csv: CsvRouteState | undefined,
  systemAddress: number | bigint | undefined,
): (FollowedRoute & { onRoute: boolean }) | undefined {
  const followed = followedRoute(routes, csv, systemAddress);
  if (followed) return { ...followed, onRoute: followed.position !== undefined };
  if (!csv?.route) return undefined;
  return { ...fromCsv(csv.route, csv.position ?? -1), onRoute: false };
}

function fromCsv(route: CsvRoute, position: number): FollowedRoute {
  const remaining = route.systems.map((_, index) => toNumber(columnValue(route, index, REMAINING)));
  const systems = route.systems.map((system, index): FollowedSystem => {
    const before = remaining[index - 1];
    const left = remaining[index];
    const legLy =
      index === 0
        ? undefined
        : before !== undefined && left !== undefined
          ? before - left
          : toNumber(columnValue(route, index, JUMPED));
    const starClass = starClassAt(route, index);
    const scoopable = starClass === undefined ? scoopableAt(route, index) : undefined;
    return {
      name: system.name,
      legLy,
      ...(starClass !== undefined && { starClass }),
      ...(scoopable !== undefined && { scoopable }),
    };
  });
  const legsAhead = systems.slice(position + 1).map((system) => system.legLy);
  const lyLeft =
    remaining[position] ??
    (legsAhead.every((leg) => leg !== undefined)
      ? legsAhead.reduce((total, leg) => total + leg, 0)
      : undefined);
  return { source: 'csv', systems, position, lyLeft };
}
