/**
 * The pure part of the Route tab's map: which of a route's stops can be drawn, where, and how big
 * a view they need. Coordinates are the journal's (`StarPos`: x east, y up, z towards the core),
 * which is left-handed; three.js is right-handed, so z is turned round for drawing, and seen from
 * above the core is up the screen, as in the galaxy map.
 */

import { columnValue, type Coords, type CsvRoute, toNumber } from '../../../shared/csv-route';

export type Vec3 = [number, number, number];

/** A stop the map can draw. */
export interface MapStop {
  /** Its place on the route. */
  index: number;
  name: string;
  /** In the scene's axes (see `toScene`). */
  at: Vec3;
  /** Already flown: at or behind the last route system reached. */
  past: boolean;
  /** Nobody knows where it is: it is put on the line between the placed stops either side. */
  estimated?: boolean;
}

export interface MapRoute {
  stops: MapStop[];
  /** Stops placed by estimate. */
  estimated: number;
  /** Stops with no known place and no placed stops either side, left out of the drawing. */
  unplaced: number;
}

/** A journal position in the scene's axes. */
export function toScene([x, y, z]: Coords): Vec3 {
  return [x, y, -z];
}

/**
 * The stops of a route that can be drawn, split at the commander's position. A stop no lookup
 * knew the place of (a route through systems nobody has logged) is estimated on the straight line
 * between the placed stops either side, by the distance left to fly when the route gives it, else
 * by how many stops along it is: a route's stops lie close to that line between two known points.
 */
export function mapRoute(route: CsvRoute, position: number | undefined): MapRoute {
  const { systems } = route;
  const remaining = systems.map((_, index) =>
    toNumber(columnValue(route, index, /distance.*remain/i)),
  );
  const placed = systems.flatMap((system, index) => (system.coords ? [index] : []));
  const stops: MapStop[] = [];
  let estimated = 0;
  let before = -1;
  systems.forEach((system, index) => {
    const past = position !== undefined && index <= position;
    if (system.coords) {
      before = index;
      stops.push({ index, name: system.name, at: toScene(system.coords), past });
      return;
    }
    const after = placed.find((candidate) => candidate > index);
    const from = systems[before]?.coords;
    const to = after === undefined ? undefined : systems[after]?.coords;
    if (!from || !to || after === undefined) return;
    const [left, leftFrom, leftTo] = [remaining[index], remaining[before], remaining[after]];
    const fraction =
      left !== undefined && leftFrom !== undefined && leftTo !== undefined && leftFrom !== leftTo
        ? (leftFrom - left) / (leftFrom - leftTo)
        : (index - before) / (after - before);
    const t = Math.min(1, Math.max(0, fraction));
    const along = (axis: 0 | 1 | 2) => from[axis] + (to[axis] - from[axis]) * t;
    const at: Coords = [along(0), along(1), along(2)];
    estimated++;
    stops.push({ index, name: system.name, at: toScene(at), past, estimated: true });
  });
  return { stops, estimated, unplaced: systems.length - stops.length };
}

/**
 * The line through the stops as segments, each coloured by whether it has been flown: a leg is
 * flown once the stop it ends at is.
 */
export function segments(stops: readonly MapStop[]): { from: Vec3; to: Vec3; past: boolean }[] {
  return stops.slice(1).map((stop, index) => ({
    from: stops[index]!.at,
    to: stop.at,
    past: stop.past,
  }));
}

export interface Bounds {
  center: Vec3;
  /** Of the sphere around them all, ly; at least a little, so one stop still has a view. */
  radius: number;
}

/** The middle of the points and how far they reach from it. */
export function bounds(points: readonly Vec3[]): Bounds | undefined {
  if (points.length === 0) return undefined;
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const point of points) {
    for (let axis = 0; axis < 3; axis++) {
      min[axis] = Math.min(min[axis]!, point[axis]!);
      max[axis] = Math.max(max[axis]!, point[axis]!);
    }
  }
  const center: Vec3 = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
  let radius = 20;
  for (const [x, y, z] of points) {
    radius = Math.max(radius, Math.hypot(x - center[0], y - center[1], z - center[2]));
  }
  return { center, radius };
}

/** A round grid spacing that puts some ten lines across `span` ly: 10, 20, 50, 100… */
export function gridStep(span: number): number {
  const rough = Math.max(span, 1) / 10;
  const power = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 5, 10].map((factor) => factor * power).find((value) => value >= rough);
  return step ?? 10 * power;
}

/** Places to find one's bearings by, as the journal gives them. */
export const LANDMARKS: readonly { name: string; coords: Coords }[] = [
  { name: 'Sol', coords: [0, 0, 0] },
  { name: 'Sagittarius A*', coords: [25.21875, -20.90625, 25899.96875] },
  { name: 'Colonia', coords: [-9530.5, -910.28125, 19808.125] },
];
