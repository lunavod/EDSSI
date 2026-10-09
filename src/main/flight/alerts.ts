/**
 * Warnings in flight, less the wiring: low fuel with the nearest scoopable star, a next jump to a
 * star the scoop can't use, too little fuel for the unscoopable stretch of the route a target
 * starts, and a body heavy enough to wreck a landing. Each is said once per
 * system or body, and none while docked or landed; what was held back then is looked at again on
 * lifting off.
 */

import type { CsvRouteState } from '../../shared/csv-route';
import { followedRoute } from '../../shared/followed-route';
import type { SystemSurvey } from '../../shared/history';
import type { JournalEvent, StatusEvent } from '../../shared/journal';
import { type Drive, driveOf, shortStretch, type Stretch } from '../../shared/jump-fuel';
import {
  activeRoute,
  isScoopableClass,
  nextJump,
  type PlottedRoute,
  positionOf,
} from '../../shared/nav-routes';
import type { FlightAlertSettings } from '../../shared/settings';
import { type Coords, field } from '../spansh/client';

const STANDARD_GRAVITY = 9.80665;
/** A scoopable star this few jumps along the route is named before any nearer one off it. */
export const ROUTE_PREFERENCE_JUMPS = 3;
/** How far Spansh is asked to look for a scoopable star; the nearest is all that's wanted. */
const STAR_SEARCH_LY = 200;
/**
 * The next-jump warning waits this long after arriving. The game targets the system after next
 * while still in hyperspace, and a warning then sounds like it's about the jump under way.
 */
export const ARRIVAL_DELAY_MS = 5000;
/** A jump that never arrives (cancelled, or a line EDSSI missed) stops holding warnings back. */
export const JUMP_TIMEOUT_MS = 90_000;

const DOCKED = 1 << 0;
const LANDED = 1 << 1;
const SCOOPING = 1 << 11;
const HAS_LAT_LONG = 1 << 21;
const IN_MAIN_SHIP = 1 << 24;
const FSD_JUMP = 1 << 30;
/** Flags2: riding a taxi, or in someone else's ship. Neither tank is the commander's to watch. */
const IN_TAXI = 1 << 1;
const IN_MULTICREW = 1 << 2;

/** Spansh's names for main-sequence and giant stars of classes O to M: the scoopable ones. */
export const SCOOPABLE_SUBTYPES = [
  'O (Blue-White) Star',
  'B (Blue-White) Star',
  'B (Blue-White super giant) Star',
  'A (Blue-White) Star',
  'A (Blue-White super giant) Star',
  'F (White) Star',
  'F (White super giant) Star',
  'G (White-Yellow) Star',
  'G (White-Yellow super giant) Star',
  'K (Yellow-Orange) Star',
  'K (Yellow-Orange giant) Star',
  'M (Red dwarf) Star',
  'M (Red giant) Star',
  'M (Red super giant) Star',
];

export interface PrimaryStar {
  /** A journal star class (`K`, `DA`, `N`…) or EDSM's name for one (`Neutron Star`). */
  type: string;
  scoopable: boolean;
}

export interface NearestStar {
  system: string;
  distanceLy: number;
}

export interface FlightAlertOptions {
  settings: () => FlightAlertSettings;
  /** Plotted routes, oldest first. */
  routes: () => readonly PlottedRoute[];
  /** The route loaded from a CSV file, followed when no route is plotted. */
  csvRoute?: () => CsvRouteState | undefined;
  /** The history tracker's survey of the current system. */
  survey: () => SystemSurvey | undefined;
  /** What EDSM knows of a system's primary star; undefined when it doesn't. */
  primaryStar: (system: string) => Promise<PrimaryStar | undefined>;
  /** The nearest system whose main star is scoopable, the current one included. */
  nearestScoopable: (coords: Coords, signal: AbortSignal) => Promise<NearestStar | undefined>;
  notify: (text: string) => void;
}

interface Here {
  address: number | bigint;
  name: string;
  coords: Coords;
}

interface Target {
  address: number | bigint;
  name: string;
  starClass?: string;
}

/** Follows the session and says each warning once. Feed it every event and every Status update. */
export class FlightAlerts {
  readonly #options: FlightAlertOptions;
  readonly #told = new Set<string>();
  #live = false;
  #here: Here | undefined;
  /** The star class of the system the last jump went to, from its StartJump. */
  #arrival: { address: number | bigint; starClass: string } | undefined;
  #target: Target | undefined;
  #fuelCapacity: number | undefined;
  #fuel: number | undefined;
  /** The drive's figures, from the last Loadout; unset when they can't be worked out. */
  #drive: Drive | undefined;
  #status: StatusEvent | undefined;
  #pending: AbortController | undefined;
  /** Set from a hyperspace jump's start until a little after its arrival. */
  #jumping = false;
  #jumpTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(options: FlightAlertOptions) {
    this.#options = options;
  }

  /** Call once the session has been replayed, so only what happens from now on is warned about. */
  markLive(): void {
    this.#live = true;
  }

  stop(): void {
    this.#pending?.abort();
    clearTimeout(this.#jumpTimer);
  }

  event(event: JournalEvent): void {
    switch (event.event) {
      case 'Loadout': {
        // Typed, but not checked at runtime.
        const main: unknown = event.FuelCapacity?.Main;
        this.#fuelCapacity = typeof main === 'number' && main > 0 ? main : undefined;
        this.#drive = driveOf(event);
        return;
      }
      case 'Location':
      case 'CarrierJump':
        this.#arrive(event);
        return;
      case 'StartJump':
        if (event.JumpType === 'Hyperspace' && event.SystemAddress !== undefined) {
          this.#arrival = event.StarClass
            ? { address: event.SystemAddress, starClass: event.StarClass }
            : undefined;
          this.#holdTargetFor(JUMP_TIMEOUT_MS);
        }
        return;
      case 'FSDJump': {
        this.#arrive(event);
        this.#holdTargetFor(ARRIVAL_DELAY_MS);
        if (this.#target && sameAddress(this.#target.address, event.SystemAddress)) {
          this.#target = undefined;
        }
        // Riding a shuttle or in someone else's ship, neither tank is the commander's.
        if (event.Taxi || event.Multicrew) return;
        if (Number.isFinite(event.FuelLevel)) this.#fuel = event.FuelLevel;
        this.#checkFuel(false);
        // The game targets the route's next system during the jump, but the route alone is enough.
        const next = nextJump(activeRoute(this.#options.routes()), event.SystemAddress);
        if (next && !this.#target) {
          this.#target = {
            address: next.system.SystemAddress,
            name: next.system.StarSystem,
            starClass: next.system.StarClass,
          };
        }
        return;
      }
      case 'FSDTarget':
        this.#target = {
          address: event.SystemAddress,
          name: event.Name,
          starClass: event.StarClass || undefined,
        };
        this.#checkTarget();
        return;
      case 'ApproachBody':
        this.#checkGravity(event.SystemAddress, { bodyId: event.BodyID, name: event.Body });
        return;
      default:
        return;
    }
  }

  status(status: StatusEvent): void {
    const previous = this.#status;
    const wasQuiet = this.#quiet();
    this.#status = status;
    // What was held back while docked, now there's someone at the controls to hear it.
    const resumed = wasQuiet && !this.#quiet();
    const main = Number(status.Fuel?.FuelMain);
    if (status.Fuel && Number.isFinite(main) && (status.Flags & IN_MAIN_SHIP) !== 0) {
      this.#fuel = main;
    }
    // Fuel drops as the jump starts, still in the old system; the arrival says it again.
    if ((status.Flags & FSD_JUMP) === 0) this.#checkFuel(true);
    // Status.json is rewritten every few metres near a surface; a new body is what counts.
    const body = nearBody(status);
    if (body && this.#here && (resumed || body !== nearBody(previous))) {
      this.#checkGravity(this.#here.address, { name: body });
    }
    if (resumed) this.#checkTarget();
    // Filled up: a stretch held back while scooping is looked at with the tank as it is now.
    else if (previous && (previous.Flags & SCOOPING) !== 0 && (status.Flags & SCOOPING) === 0) {
      this.#checkStretch();
    }
  }

  /** Keeps the next-jump warning back for `ms`, then gives whatever is targeted by then. */
  #holdTargetFor(ms: number): void {
    this.#jumping = true;
    clearTimeout(this.#jumpTimer);
    this.#jumpTimer = setTimeout(() => {
      this.#jumping = false;
      this.#jumpTimer = undefined;
      this.#checkTarget();
    }, ms);
  }

  #arrive(event: {
    StarSystem: string;
    SystemAddress: number | bigint;
    StarPos: [number, number, number];
  }): void {
    const coords = toCoords(event.StarPos);
    this.#here = coords
      ? { address: event.SystemAddress, name: event.StarSystem, coords }
      : undefined;
  }

  /** Docked or landed, or not flying a ship of one's own: nothing to warn about. */
  #quiet(): boolean {
    const status = this.#status;
    if (!status) return false;
    return (
      (status.Flags & (DOCKED | LANDED)) !== 0 ||
      ((status.Flags2 ?? 0) & (IN_TAXI | IN_MULTICREW)) !== 0
    );
  }

  /** Flying the ship itself, as far as Status.json says; true before it has said anything. */
  #inShip(): boolean {
    return !this.#status || (this.#status.Flags & IN_MAIN_SHIP) !== 0;
  }

  #once(key: string): boolean {
    if (this.#told.has(key)) return false;
    this.#told.add(key);
    return true;
  }

  #checkFuel(fromStatus: boolean): void {
    const settings = this.#options.settings();
    const here = this.#here;
    const capacity = this.#fuelCapacity;
    const fuel = this.#fuel;
    if (!this.#live || !settings.low_fuel || this.#quiet() || !this.#inShip()) return;
    if (!here || capacity === undefined || fuel === undefined) return;
    const fraction = fuel / capacity;
    if (fraction >= settings.low_fuel_fraction) return;
    // Already at it.
    if (fromStatus && this.#status && (this.#status.Flags & SCOOPING) !== 0) return;
    if (!this.#once(`fuel:${String(here.address)}`)) return;

    this.#pending?.abort();
    const controller = new AbortController();
    this.#pending = controller;
    this.#findStar(here, controller.signal)
      .then((where) => {
        if (!controller.signal.aborted) this.#options.notify(lowFuelLine(fraction, where));
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) console.warn('[flight-alert] star search failed', error);
      })
      .finally(() => {
        if (this.#pending === controller) this.#pending = undefined;
      });
  }

  /** Where to scoop: here, a little way along the route, or the nearest Spansh knows of. */
  async #findStar(here: Here, signal: AbortSignal): Promise<string | undefined> {
    const local = scoopableHere(this.#options.survey(), here.address, this.#arrival);
    if (local) return local;
    const onRoute = scoopableOnRoute(activeRoute(this.#options.routes()), here.address);
    if (onRoute && onRoute.jumps <= ROUTE_PREFERENCE_JUMPS) return routeWords(onRoute);
    const nearest = await this.#options
      .nearestScoopable(here.coords, signal)
      .catch((error: unknown) => {
        if (!signal.aborted) console.warn('[flight-alert] Spansh search failed', error);
        return undefined;
      });
    if (nearest) {
      return nearest.system.toLowerCase() === here.name.toLowerCase()
        ? 'the star here'
        : `${nearest.system}, ${lightYears(nearest.distanceLy)}`;
    }
    return onRoute && routeWords(onRoute);
  }

  #checkTarget(): void {
    // The stretch says the target can't be scooped too; saying that twice is noise.
    const stretched = this.#checkStretch();
    const settings = this.#options.settings();
    const target = this.#target;
    if (!this.#live || !settings.unscoopable_next_jump || !target) return;
    if (this.#quiet() || this.#jumping) return;
    const key = `hop:${String(target.address)}`;
    if (this.#told.has(key)) return;
    if (stretched) {
      this.#told.add(key);
      return;
    }
    if (target.starClass) {
      this.#told.add(key);
      if (!isScoopableClass(target.starClass)) {
        this.#options.notify(nextJumpLine(target.name, target.starClass, this.#fuelShare()));
      }
      return;
    }
    // Neither the game nor the route said what the star is.
    this.#told.add(key);
    this.#options
      .primaryStar(target.name)
      .then((star) => {
        const still = this.#target && sameAddress(this.#target.address, target.address);
        if (star && !star.scoopable && still) {
          this.#options.notify(nextJumpLine(target.name, star.type, this.#fuelShare()));
        }
      })
      .catch((error: unknown) => console.warn('[flight-alert] EDSM lookup failed', error));
  }

  /**
   * Too little fuel for the stretch of the route the target starts: its jumps with no scoopable
   * star, up to the next one that has. True when it warned. Once per target, and not while
   * scooping, as the tank isn't full yet; the end of scooping looks again.
   */
  #checkStretch(): boolean {
    const settings = this.#options.settings();
    const target = this.#target;
    const here = this.#here;
    const drive = this.#drive;
    const fuel = this.#fuel;
    if (!this.#live || !settings.fuel_for_stretch || !target || !here) return false;
    if (this.#quiet() || this.#jumping || !this.#inShip()) return false;
    if (this.#status && (this.#status.Flags & SCOOPING) !== 0) return false;
    if (!drive || fuel === undefined) return false;
    const key = `stretch:${String(target.address)}`;
    if (this.#told.has(key)) return false;
    this.#told.add(key);
    const route = followedRoute(this.#options.routes(), this.#options.csvRoute?.(), here.address);
    const cargo = Number(this.#status?.Cargo);
    const stretch = shortStretch(route, target, fuel, Number.isFinite(cargo) ? cargo : 0, drive);
    if (!stretch) return false;
    this.#options.notify(stretchLine(stretch));
    return true;
  }

  #checkGravity(systemAddress: number | bigint, body: { bodyId?: number; name: string }): void {
    const settings = this.#options.settings();
    if (!this.#live || !settings.high_gravity || this.#quiet() || !this.#inShip()) return;
    const key = `gravity:${String(systemAddress)}:${body.name.toLowerCase()}`;
    if (this.#told.has(key)) return;
    const g = gravityOf(this.#options.survey(), systemAddress, body);
    // An unscanned body is looked at again next time it comes up.
    if (g === undefined) return;
    this.#told.add(key);
    if (g >= settings.high_gravity_threshold) this.#options.notify(gravityLine(body.name, g));
  }

  #fuelShare(): number | undefined {
    const capacity = this.#fuelCapacity;
    return capacity !== undefined && this.#fuel !== undefined ? this.#fuel / capacity : undefined;
  }
}

/** A scoopable star in the system itself: the nearest one scanned, or the one jumped to. */
export function scoopableHere(
  survey: SystemSurvey | undefined,
  address: number | bigint,
  arrival: { address: number | bigint; starClass: string } | undefined,
): string | undefined {
  if (survey && sameAddress(survey.systemAddress, address)) {
    const star = survey.bodies
      .filter((body) => body.kind === 'star' && body.type && isScoopableClass(body.type))
      .toSorted((a, b) => (a.distanceLs ?? 0) - (b.distanceLs ?? 0))[0];
    if (star) {
      return star.distanceLs !== undefined && star.distanceLs >= 1
        ? `${star.name} in this system, ${Math.round(star.distanceLs)} light seconds out`
        : 'the star here';
    }
  }
  if (arrival && sameAddress(arrival.address, address) && isScoopableClass(arrival.starClass)) {
    return 'the star here';
  }
  return undefined;
}

/** The first scoopable star after the current system on a route, and how many jumps on it is. */
export function scoopableOnRoute(
  route: PlottedRoute | undefined,
  address: number | bigint,
): { system: string; jumps: number } | undefined {
  const systems = route?.systems;
  const position = route && positionOf(route, address);
  if (!systems || position === undefined) return undefined;
  for (let index = position + 1; index < systems.length; index++) {
    const system = systems[index]!;
    if (isScoopableClass(system.StarClass)) {
      return { system: system.StarSystem, jumps: index - position };
    }
  }
  return undefined;
}

/** The body's gravity in g, if the survey has its scan. */
export function gravityOf(
  survey: SystemSurvey | undefined,
  systemAddress: number | bigint,
  body: { bodyId?: number; name: string },
): number | undefined {
  if (!survey || !sameAddress(survey.systemAddress, systemAddress)) return undefined;
  const found = survey.bodies.find((candidate) =>
    body.bodyId !== undefined
      ? candidate.bodyId === body.bodyId
      : candidate.name.toLowerCase() === body.name.toLowerCase(),
  );
  return found?.gravity === undefined ? undefined : found.gravity / STANDARD_GRAVITY;
}

/** The nearest main star of a scoopable class, the system at `coords` included. */
export function scoopableStarSearch(coords: Coords): Record<string, unknown> {
  return {
    filters: {
      is_main_star: { value: true },
      subtype: { value: SCOOPABLE_SUBTYPES },
      distance: { min: '0', max: String(STAR_SEARCH_LY) },
    },
    sort: [{ distance: { direction: 'asc' } }],
    size: 1,
    page: 0,
    reference_coords: coords,
  };
}

/** The star in a search result; Spansh's answer isn't checked, so anything odd is none. */
export function readNearestStar(result: unknown): NearestStar | undefined {
  const rows = field(result, 'results');
  const row: unknown = Array.isArray(rows) ? rows[0] : undefined;
  const system = field(row, 'system_name');
  const distance = Number(field(row, 'distance'));
  return typeof system === 'string' && Number.isFinite(distance)
    ? { system, distanceLy: distance }
    : undefined;
}

/** "Fuel at 18%. Nearest scoopable star: Hypoe Flyi AB-C d1, 6.2 light years." */
export function lowFuelLine(fraction: number, where: string | undefined): string {
  const fuel = `Fuel at ${percent(fraction)}.`;
  if (!where) return `${fuel} No scoopable star known within ${STAR_SEARCH_LY} light years.`;
  return where === 'the star here'
    ? `${fuel} The star here is scoopable.`
    : `${fuel} Nearest scoopable star: ${where}.`;
}

/** "Next jump, Col 285 Sector AB-C d1, has no scoopable star: a neutron star. Fuel at 62%." */
export function nextJumpLine(system: string, starType: string, fuel: number | undefined): string {
  const tank = fuel === undefined ? '' : ` Fuel at ${percent(fuel)}.`;
  return `Next jump, ${system}, has no scoopable star: ${describeStar(starType)}.${tank}`;
}

/**
 * "Not enough fuel to reach a scoopable star: none for 4 jumps, until Hypoe Flyi AB-C d1. That
 * takes about 23 tonnes, and the tank has 15. Fill up here first."
 */
export function stretchLine(stretch: Stretch): string {
  const jumps = `${stretch.jumps} jump${stretch.jumps === 1 ? '' : 's'}`;
  const where = stretch.scoop
    ? `none for ${jumps}, until ${stretch.scoop}`
    : `none in the last ${jumps} of the route`;
  const first = stretch.scoopableHere ? ' Fill up here first.' : '';
  return (
    `Not enough fuel to reach a scoopable star: ${where}. ` +
    `That takes about ${tonnes(stretch.needed)} tonnes, and the tank has ${tonnes(stretch.fuel)}.${first}`
  );
}

/** "High gravity: Pru Aihm AB 3 a is 3.1 g." */
export function gravityLine(body: string, g: number): string {
  return `High gravity: ${body} is ${g.toFixed(1)} g.`;
}

/** A star class as said aloud: `N` is "a neutron star", EDSM's `Black Hole` is "a black hole". */
export function describeStar(type: string): string {
  if (/^D|^White Dwarf/i.test(type)) return 'a white dwarf';
  if (type === 'N' || /^Neutron/i.test(type)) return 'a neutron star';
  if (/^H$|BlackHole|Black Hole/i.test(type)) return 'a black hole';
  if (/^[LTY]$|Brown dwarf/i.test(type)) return 'a brown dwarf';
  if (/^TTS$|T Tauri/i.test(type)) return 'a T Tauri star';
  if (/^AeBe$|Herbig/i.test(type)) return 'a Herbig star';
  if (/^W|^Wolf-Rayet/i.test(type)) return 'a Wolf-Rayet star';
  if (/^C|^S$|^MS$|^(C|CN|CJ|S-type|MS-type) Star$/.test(type)) return 'a carbon star';
  return type.includes(' ') ? `a ${type.replace(/ Star$/, ' star')}` : `a class ${type} star`;
}

function tonnes(value: number): string {
  return value < 10 ? value.toFixed(1) : String(Math.round(value));
}

function routeWords(onRoute: { system: string; jumps: number }): string {
  return `${onRoute.system}, ${onRoute.jumps} jump${onRoute.jumps === 1 ? '' : 's'} on along the route`;
}

function percent(fraction: number): string {
  return `${Math.max(0, Math.round(fraction * 100))}%`;
}

function lightYears(distance: number): string {
  return `${distance < 10 ? distance.toFixed(1) : Math.round(distance)} light years`;
}

/** The body the ship is on or near (Status.json flag 21), if any. */
function nearBody(status: StatusEvent | undefined): string | undefined {
  return status && (status.Flags & HAS_LAT_LONG) !== 0 ? status.BodyName || undefined : undefined;
}

function toCoords(position: unknown): Coords | undefined {
  if (!Array.isArray(position) || position.length !== 3) return undefined;
  const [x, y, z] = position.map(Number);
  return [x, y, z].every(Number.isFinite) ? { x: x!, y: y!, z: z! } : undefined;
}

/** Addresses may be numbers or bigints (see parse.ts); compare their digits. */
function sameAddress(a: number | bigint, b: number | bigint): boolean {
  return String(a) === String(b);
}
