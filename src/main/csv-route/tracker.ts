import {
  type CsvRoute,
  type CsvRouteState,
  type Located,
  nextSystem,
  positionAfterArriving,
  sameSystem,
} from '../../shared/csv-route';

/** What an arrival did to the route. */
export interface Arrival {
  /** The position moved. */
  moved: boolean;
  /** The system after this one, when this one is on the route. */
  next?: string;
}

/**
 * Follows the commander along a loaded CSV route: which route system they were last in, and
 * whether they are still there. Knows nothing of Electron; the service decides what to copy.
 */
export class CsvRouteTracker {
  #route: CsvRoute | undefined;
  #position: number | undefined;
  #system: string | undefined;
  #copied: string | undefined;

  constructor(saved?: { route: CsvRoute; position: number | undefined }) {
    this.#route = saved?.route;
    this.#position = saved?.position;
  }

  get position(): number | undefined {
    return this.#position;
  }

  get route(): CsvRoute | undefined {
    return this.#route;
  }

  state(): CsvRouteState {
    const route = this.#route;
    const at = this.#position === undefined ? undefined : route?.systems[this.#position];
    return {
      ...(route && { route }),
      ...(this.#position !== undefined && { position: this.#position }),
      here: sameSystem(at?.name, this.#system),
      ...(this.#copied !== undefined && { copied: this.#copied }),
    };
  }

  /**
   * The commander is in `systemName` (a jump, or the game loading). Arrivals from before the route
   * was loaded only say where the commander is; they don't move along it.
   */
  arrive(systemName: string, timestamp: string): Arrival {
    this.#system = systemName;
    const route = this.#route;
    if (!route || timestamp < route.loadedAt) return { moved: false };
    const position = positionAfterArriving(route.systems, this.#position, systemName);
    if (position === undefined) return { moved: false };
    const moved = position !== this.#position;
    this.#position = position;
    const next = route.systems[position + 1]?.name;
    return { moved, ...(next !== undefined && { next }) };
  }

  /**
   * Starts following a route, placed at the commander's system if it's on it, else at `position`
   * (where a saved route was left). Answers the system to head for: the next one, or the start
   * when they aren't on the route.
   */
  load(route: CsvRoute, position?: number): string | undefined {
    const left =
      position !== undefined && position >= 0 && position < route.systems.length
        ? position
        : undefined;
    this.#route = route;
    this.#copied = undefined;
    this.#position =
      (this.#system === undefined
        ? undefined
        : positionAfterArriving(route.systems, left, this.#system)) ?? left;
    return nextSystem(route.systems, this.#position)?.name;
  }

  /** Marks the route as saved under `savedId`, or no longer saved. */
  keepAs(savedId: number | undefined): void {
    const route = this.#route;
    if (!route) return;
    const { savedId: _, ...rest } = route;
    this.#route = savedId === undefined ? rest : { ...rest, savedId };
  }

  /** Moves to a position the commander picked by hand. */
  setPosition(position: number | undefined): void {
    const count = this.#route?.systems.length ?? 0;
    this.#position =
      position === undefined || position < 0 || position >= count ? undefined : position;
  }

  /**
   * Fills in where the route's systems are and their stars, from `find` (by name), leaving what is
   * already known. Answers whether anything was added.
   */
  locate(find: (name: string) => Partial<Located> | undefined): boolean {
    const route = this.#route;
    if (!route) return false;
    let added = false;
    const systems = route.systems.map((system) => {
      if (system.coords && system.starClass !== undefined) return system;
      const found = find(system.name);
      const coords = system.coords ?? found?.coords;
      const starClass = system.starClass ?? found?.starClass;
      if (coords === system.coords && starClass === system.starClass) return system;
      added = true;
      return {
        ...system,
        ...(coords && { coords }),
        ...(starClass !== undefined && { starClass }),
      };
    });
    if (added) this.#route = { ...route, systems };
    return added;
  }

  clear(): void {
    this.#route = undefined;
    this.#position = undefined;
    this.#copied = undefined;
  }

  copied(name: string): void {
    this.#copied = name;
  }
}
