/**
 * A route loaded from a CSV file, such as the ones Spansh's plotters export: a heading row, then
 * one row per system in the order they are flown. Only the system name matters to EDSSI; every
 * other column is kept as text, to be shown as the file had it.
 */
export interface CsvRoute {
  /** The file it came from, without its folder. */
  fileName: string;
  /** The folder it was picked from; unset for a file dropped on the window. */
  folder?: string;
  /** When it was loaded (ISO 8601, UTC); jumps from before then don't move along it. */
  loadedAt: string;
  /** The headings of the columns after the system name. */
  columns: string[];
  systems: CsvRouteSystem[];
  /** The saved route it was loaded from, or saved as, which follows it along. */
  savedId?: number;
}

/** A route saved under a name, as the list to switch between shows it. */
export interface SavedRouteSummary {
  id: number;
  name: string;
  fileName: string;
  /** How many systems it has. */
  systems: number;
  /** The route system last reached on it. */
  position?: number;
  /** When it was saved under this name (ISO 8601, UTC). */
  savedAt: string;
}

/** The longest name a route can be saved under. */
export const SAVED_ROUTE_NAME_LENGTH = 60;

export interface CsvRouteSystem {
  name: string;
  /** One per column in `CsvRoute.columns`. */
  values: string[];
  /**
   * Where it is (the journal's `StarPos`: x, y, z in ly), for the Route tab's map. From X/Y/Z
   * columns in the file, or else looked up after loading (an extension's locator, else EDSM);
   * unset when unknown.
   */
  coords?: Coords;
  /** Its main star's class, looked up after loading, for a file that doesn't say. */
  starClass?: string;
}

/** What a lookup found of a route system. */
export interface Located {
  coords: Coords;
  starClass?: string;
}

export type Coords = [x: number, y: number, z: number];

/** The loaded route and where the commander is on it, as the Route tab shows it. */
export interface CsvRouteState {
  route?: CsvRoute;
  /** The route system the commander was last in; unset until they reach one. */
  position?: number;
  /** Whether they are still in it. */
  here: boolean;
  /** The last system name put on the clipboard for them. */
  copied?: string;
  /** Every route saved under a name, oldest first. */
  saved?: SavedRouteSummary[];
}

/** Headings that name the system column; without one, the first column is taken. */
const SYSTEM_HEADING = /^(system( ?name)?|star ?system|name)$/i;

/** Splits CSV text into rows of cells: quoted cells, doubled quotes and CRLF endings included. */
export function parseCsv(text: string, delimiter = ','): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const input = withoutBom(text);
  for (let i = 0; i < input.length; i++) {
    const char = input[i]!;
    if (quoted) {
      if (char !== '"') cell += char;
      else if (input[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === delimiter) {
      row.push(cell);
      cell = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && input[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += char;
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((cells) => cells.some((value) => value.trim() !== ''));
}

/**
 * Reads a route from CSV text. Rows naming the same system as the one before (Spansh's Road to
 * Riches lists a system once per body) become one stop, keeping the first row's values.
 */
export function parseCsvRoute(text: string, fileName: string, loadedAt: string): CsvRoute {
  const firstLine = withoutBom(text).split(/\r?\n/, 1)[0] ?? '';
  const delimiter = !firstLine.includes(',') && firstLine.includes(';') ? ';' : ',';
  const [header, ...rows] = parseCsv(text, delimiter);
  if (!header || rows.length === 0) throw new Error('The file has no rows of systems.');
  const headings = header.map((heading) => heading.trim());
  const found = headings.findIndex((heading) => SYSTEM_HEADING.test(heading));
  const nameColumn = Math.max(found, 0);
  const columns = headings.filter((_, index) => index !== nameColumn);

  const axes = COORD_HEADINGS.map((heading) => headings.findIndex((name) => heading.test(name)));

  const systems: CsvRouteSystem[] = [];
  for (const cells of rows) {
    const name = cells[nameColumn]?.trim();
    if (!name) continue;
    if (sameSystem(systems.at(-1)?.name, name)) continue;
    const values = headings
      .map((_, index) => cells[index]?.trim() ?? '')
      .filter((_, index) => index !== nameColumn);
    const [x, y, z] = axes.map((column) => toNumber(cells[column]));
    systems.push({
      name,
      values,
      ...(x !== undefined && y !== undefined && z !== undefined && { coords: [x, y, z] }),
    });
  }
  if (systems.length === 0) throw new Error('No system names were found in the file.');
  return { fileName, loadedAt, columns, systems };
}

/** Headings of a file's coordinate columns, x, y and z, as some tools export them. */
const COORD_HEADINGS = [/^(coords? ?)?x$/i, /^(coords? ?)?y$/i, /^(coords? ?)?z$/i];

/** A cell as a number; undefined when it is empty or isn't one. */
export function toNumber(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** Excel saves UTF-8 CSV with a byte order mark in front. */
function withoutBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** System names compare as the game treats them: without regard to case. */
export function sameSystem(a: string | undefined, b: string | undefined): boolean {
  return a !== undefined && b !== undefined && a.toLowerCase() === b.toLowerCase();
}

/**
 * Where on the route arriving in `systemName` puts the commander, or undefined if it isn't on it.
 * A system listed twice is taken at its first appearance from the current position on, so a route
 * that passes back through a system still moves forwards.
 */
export function positionAfterArriving(
  systems: readonly CsvRouteSystem[],
  position: number | undefined,
  systemName: string,
): number | undefined {
  const matches = systems.flatMap((system, index) =>
    sameSystem(system.name, systemName) ? [index] : [],
  );
  return matches.find((index) => index >= (position ?? 0)) ?? matches.at(-1);
}

/** The system to fly to next: the one after the position, or the start when off the route. */
export function nextSystem(
  systems: readonly CsvRouteSystem[],
  position: number | undefined,
): CsvRouteSystem | undefined {
  return systems[position === undefined ? 0 : position + 1];
}

/** A column's value at a row, by heading (any case); undefined when there's no such column. */
export function columnValue(route: CsvRoute, index: number, heading: RegExp): string | undefined {
  const column = route.columns.findIndex((name) => heading.test(name));
  return column < 0 ? undefined : route.systems[index]?.values[column];
}

/** A column's heading naming each stop's main star class. */
const STAR = /^(star|star ?class|star ?type|primary ?star)$/i;
/** Spansh's galaxy plotter's column of the stops where the tank is filled from the star. */
const REFUEL = /^refuel$/i;

/**
 * The stop's main star class, when the file names it or a lookup found it. Undefined when neither
 * says.
 */
export function starClassAt(route: CsvRoute, index: number): string | undefined {
  const value = columnValue(route, index, STAR)?.trim();
  return value || route.systems[index]?.starClass;
}

/** Whether the file has a column naming each stop's star. */
export function hasStarColumn(route: CsvRoute): boolean {
  return route.columns.some((name) => STAR.test(name));
}

/**
 * Whether a fuel scoop works at a stop, as Spansh's galaxy plotter's `Refuel` column says: a stop
 * it refuels at is scoopable. One it doesn't refuel at says nothing: Spansh passes scoopable
 * stars by when the tank has enough (a G star with `No` in a real export), so that is left to the
 * star's class. True or undefined.
 */
export function scoopableAt(route: CsvRoute, index: number): true | undefined {
  const column = route.columns.findIndex((name) => REFUEL.test(name));
  if (column < 0) return undefined;
  const value = route.systems[index]?.values[column]?.trim().toLowerCase();
  return value === 'yes' || value === 'true' || value === '1' ? true : undefined;
}
