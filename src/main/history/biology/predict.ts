/**
 * Which species could grow on a body, by the community's spawn rules (see `rules.ts`). Before the
 * surface scanner names the genera, this narrows every genus in the game down to the ones the body
 * can hold; after, it narrows each named genus down to its likely species and colour. It follows
 * Silarn's EDMC-BioScan, which has been checked against a great many bodies, rule for rule. What
 * the journal hasn't said yet (the galaxy position, a star not scanned) never rules a species out.
 */

import { organicValue } from '../values';
import { LARGE_NEBULAE, NEBULA_SECTORS, PLANETARY_NEBULAE } from './nebulae.generated';
import { GUARDIAN_ZONES, REGION_GROUPS, REGION_ROWS, TUBER_ZONES } from './regions.generated';
import type { GenusRules, SpawnRule, SpeciesRules } from './rules';
import { GENERA } from './species.generated';

export type Vec3 = readonly [number, number, number];

/** The game's standard gravity and atmosphere, as BioScan converts the journal's SI values. */
const G = 9.797759;
const ATMOSPHERE = 101_231.65625;

export interface StarFacts {
  bodyName: string;
  /** `Scan.StarType`. */
  starType: string;
  /** `Scan.Luminosity`, e.g. `Vab`. */
  luminosity?: string;
  distanceLs?: number;
}

export interface PlanetFacts {
  bodyName: string;
  planetClass: string;
  /** `Scan.AtmosphereType`; `None`, or undefined, for none. */
  atmosphereType?: string;
  /** Percent by gas name. */
  atmosphere?: Readonly<Record<string, number>>;
  /** `Scan.Volcanism`; empty for none. */
  volcanism?: string;
  /** In m/s². */
  gravity?: number;
  /** In K. */
  temperature?: number;
  /** In Pa. */
  pressure?: number;
  distanceLs?: number;
  /** In seconds. */
  orbitalPeriod?: number;
  /** Material names, e.g. `polonium`. */
  materials?: readonly string[];
}

export interface SystemFacts {
  name: string;
  /** `StarPos`, in ly. */
  position?: Vec3;
  /** Every star scanned so far. */
  stars: readonly StarFacts[];
  /** The class of every planet scanned so far. */
  planetClasses: readonly string[];
}

export interface SpeciesPrediction {
  code: string;
  name: string;
  /** Base price of a complete sample. */
  value: number;
  /** Colours it could come in here; empty for a species without variants by colour. */
  colours: string[];
}

export interface GenusPrediction {
  code: string;
  name: string;
  colonyDistance: number;
  multiple: boolean;
  /** Cheapest first. */
  species: SpeciesPrediction[];
}

/** Genera that could grow on `planet`, by name, each with the species that could. */
const COLONY_DISTANCES = new Map(GENERA.map((genus) => [genus.code, genus.colonyDistance]));

/** Metres between colonies of different species of a genus, by its codex name. */
export function colonyDistance(genusCode: string): number | undefined {
  return COLONY_DISTANCES.get(genusCode);
}

export function predictLife(system: SystemFacts, planet: PlanetFacts): GenusPrediction[] {
  const place = placeOf(system);
  const predictions: GenusPrediction[] = [];
  for (const genus of GENERA) {
    const species = genus.species
      .filter((candidate) => candidate.rules.some((rule) => holds(rule, system, planet, place)))
      .map((candidate) => ({ candidate, colours: coloursOf(genus, candidate, system, planet) }))
      .filter(({ colours }) => colours !== undefined)
      .map(({ candidate, colours }): SpeciesPrediction => ({
        code: candidate.code,
        name: candidate.name,
        value: organicValue(candidate.code) ?? candidate.value,
        colours: colours ?? [],
      }))
      .toSorted((a, b) => a.value - b.value);
    if (species.length === 0) continue;
    predictions.push({
      code: genus.code,
      name: genus.name,
      colonyDistance: genus.colonyDistance,
      multiple: genus.multiple,
      species,
    });
  }
  return predictions.toSorted((a, b) => a.name.localeCompare(b.name));
}

/** Where a system is, as far as the rules care; worked out once per position. */
interface Place {
  region?: number;
  nearLargeNebula?: boolean;
  nearAnyNebula?: boolean;
  inGuardianZone?: boolean;
  /** Tuber zones the system is in the band of. */
  tuberZones?: ReadonlySet<string>;
}

const places = new Map<string, Place>();

function placeOf(system: SystemFacts): Place {
  const position = system.position;
  if (!position) return {};
  const key = `${system.name}|${position.join(',')}`;
  let place = places.get(key);
  if (!place) {
    const inSector = NEBULA_SECTORS.some((sector) => system.name.startsWith(sector));
    const nearLargeNebula = inSector || anyWithin(LARGE_NEBULAE, position, 150);
    place = {
      region: galacticRegion(position),
      nearLargeNebula,
      nearAnyNebula: nearLargeNebula || anyWithin(PLANETARY_NEBULAE, position, 100),
      inGuardianZone: GUARDIAN_ZONES.some((zone) => distance(zone.centre, position) < zone.radius),
      tuberZones: new Set(
        TUBER_ZONES.filter((zone) => {
          const away = distance(zone.centre, position);
          return zone.min <= away && away <= zone.max;
        }).map((zone) => zone.name),
      ),
    };
    if (places.size > 256) places.clear();
    places.set(key, place);
  }
  return place;
}

function holds(rule: SpawnRule, system: SystemFacts, planet: PlanetFacts, place: Place): boolean {
  const atmosphere = planet.atmosphereType || 'None';
  if (rule.atmosphere && !rule.atmosphere.includes(atmosphere)) return false;
  if (rule.atmosphereComponent) {
    for (const [gas, percent] of Object.entries(rule.atmosphereComponent)) {
      if ((planet.atmosphere?.[gas] ?? 0) < percent) return false;
    }
  }

  if (planet.gravity !== undefined) {
    const g = planet.gravity / G;
    if (rule.maxGravity !== undefined && g > rule.maxGravity) return false;
    if (rule.minGravity !== undefined && g < rule.minGravity) return false;
  }
  // BioScan skips temperature and pressure checks on a zero, as on a body without air.
  if (planet.temperature) {
    if (rule.maxTemperature !== undefined && planet.temperature > rule.maxTemperature) return false;
    if (rule.minTemperature !== undefined && planet.temperature < rule.minTemperature) return false;
  }
  if (planet.pressure) {
    const atm = planet.pressure / ATMOSPHERE;
    if (rule.minPressure !== undefined && atm < rule.minPressure) return false;
    if (rule.maxPressure !== undefined && atm >= rule.maxPressure) return false;
  }
  if (rule.maxOrbitalPeriod !== undefined && (planet.orbitalPeriod ?? 0) >= rule.maxOrbitalPeriod) {
    return false;
  }
  if (rule.volcanism !== undefined && !volcanismHolds(rule.volcanism, planet.volcanism ?? '')) {
    return false;
  }
  if (rule.bodyType && !rule.bodyType.includes(planet.planetClass)) return false;
  if (rule.distance !== undefined && (planet.distanceLs ?? Infinity) < rule.distance) return false;
  if (rule.system !== undefined && system.name !== rule.system) return false;

  if (rule.regions && place.region !== undefined && !regionHolds(rule.regions, place.region)) {
    return false;
  }
  if (rule.guardian && place.inGuardianZone === false) return false;
  if (rule.tuber !== undefined && place.tuberZones) {
    const zones = rule.tuber === 'Any' ? [...place.tuberZones] : rule.tuber;
    if (!zones.some((zone) => place.tuberZones?.has(zone))) return false;
  }
  if (rule.nebula === 'large' && place.nearLargeNebula === false) return false;
  if (rule.nebula === 'all' && place.nearAnyNebula === false) return false;

  if (rule.bodies && !system.planetClasses.some((type) => rule.bodies?.includes(type))) {
    return false;
  }
  if (rule.star && !system.stars.some((star) => starMatches(rule.star ?? [], star))) return false;
  if (rule.parentStar) {
    const types = [mainStar(system), ...parentStars(system, planet)].flatMap((star) =>
      star ? [star.starType] : [],
    );
    const classes = rule.parentStar;
    if (!types.some((type) => classes.some((query) => isStarClass(query, type)))) return false;
  }
  return true;
}

function volcanismHolds(rule: string | readonly string[], volcanism: string): boolean {
  if (typeof rule !== 'string') {
    return rule.some((kind) =>
      kind.startsWith('=') ? volcanism === kind.slice(1) : volcanism.includes(kind),
    );
  }
  if (rule === 'Any') return volcanism !== '';
  if (rule === 'None') return volcanism === '';
  // A "not this kind" rule still needs some volcanism.
  if (rule.startsWith('!')) return volcanism !== '' && !volcanism.includes(rule.slice(1));
  return true;
}

function regionHolds(groups: readonly string[], region: number): boolean {
  const inGroup = (group: string) => REGION_GROUPS[group]?.includes(region) ?? false;
  const excluded = groups.filter((group) => group.startsWith('!'));
  if (excluded.some((group) => inGroup(group.slice(1)))) return false;
  const included = groups.filter((group) => !group.startsWith('!'));
  return included.length === 0 || included.some(inGroup);
}

function starMatches(requirements: NonNullable<SpawnRule['star']>, star: StarFacts): boolean {
  return requirements.some((requirement) => {
    if (typeof requirement === 'string') return isStarClass(requirement, star.starType);
    const [starClass, luminosity] = requirement;
    return (
      isStarClass(starClass, star.starType) &&
      ['', 'a', 'b', 'ab', 'z'].some((flag) => `${luminosity}${flag}` === star.luminosity)
    );
  });
}

/**
 * The colours a species could come in here, or undefined when its colour rules find none, which
 * rules it out: a star-coloured species needs a star it has a colour for. Colour comes from the
 * body's parent star, and from the arrival star as well.
 */
function coloursOf(
  genus: GenusRules,
  species: SpeciesRules,
  system: SystemFacts,
  planet: PlanetFacts,
): string[] | undefined {
  const starColours = species.starColours ?? genus.starColours;
  if (starColours) {
    const colours = new Set<string>();
    const parents = parentStars(system, planet);
    for (const parent of parents) {
      const colour = colourFor(starColours, parent.starType);
      if (colour) {
        colours.add(colour);
        break;
      }
    }
    for (const star of system.stars) {
      if (parents.includes(star) || star.distanceLs !== 0) continue;
      const colour = colourFor(starColours, star.starType);
      if (colour) colours.add(colour);
    }
    return colours.size > 0 ? [...colours].toSorted() : undefined;
  }
  if (species.elementColours) {
    const colours = Object.entries(species.elementColours)
      .filter(([element]) => planet.materials?.includes(element))
      .map(([, colour]) => colour);
    return colours.length > 0 ? colours.toSorted() : undefined;
  }
  return [];
}

function colourFor(
  colours: Readonly<Record<string, string>>,
  starType: string,
): string | undefined {
  return Object.entries(colours).find(([query]) => isStarClass(query, starType))?.[1];
}

/** The arrival star. */
function mainStar(system: SystemFacts): StarFacts | undefined {
  return system.stars.find((star) => star.distanceLs === 0);
}

/**
 * The stars a planet orbits, read from its name as BioScan does: "AB 1 a" orbits A and B, while
 * "1 a" in a single-star system orbits the star named after the system.
 */
function parentStars(system: SystemFacts, planet: PlanetFacts): StarFacts[] {
  const short = shortName(planet.bodyName, system.name);
  const letters = /^([A-Z]+) .+$/.exec(short)?.[1];
  const names = letters ? [...new Set(letters)].toSorted() : [system.name];
  return names.flatMap((name) => {
    const star = system.stars.find(
      (candidate) => shortName(candidate.bodyName, system.name) === name,
    );
    return star ? [star] : [];
  });
}

function shortName(bodyName: string, systemName: string): string {
  return bodyName.startsWith(`${systemName} `) ? bodyName.slice(systemName.length + 1) : bodyName;
}

/** Whether a journal star type is of a rule's class: giants count as their class, `D` any dwarf. */
export function isStarClass(query: string, starType: string): boolean {
  switch (query) {
    case 'A':
      return starType === 'A' || starType === 'A_BlueWhiteSuperGiant';
    case 'B':
      return starType === 'B' || starType === 'B_BlueWhiteSuperGiant';
    case 'F':
      return starType === 'F' || starType === 'F_WhiteSuperGiant';
    case 'G':
      return starType === 'G' || starType === 'G_WhiteSuperGiant';
    case 'K':
      return starType === 'K' || starType === 'K_OrangeGiant';
    case 'M':
      return starType === 'M' || starType === 'M_RedGiant' || starType === 'M_RedSuperGiant';
    case 'D':
    case 'C':
    case 'W':
      return starType.startsWith(query);
    default:
      return starType === query;
  }
}

/** The region id at a galactic position, from klightspeed's region map; undefined outside it. */
export function galacticRegion([x, , z]: Vec3): number | undefined {
  const px = Math.trunc(((x + 49_985) * 83) / 4096);
  const pz = Math.trunc(((z + 24_105) * 83) / 4096);
  const row = REGION_ROWS[pz];
  if (px < 0 || pz < 0 || !row) return undefined;
  let start = 0;
  for (let index = 0; index < row.length; index += 2) {
    const length = row[index]!;
    if (px < start + length) return row[index + 1] || undefined;
    start += length;
  }
  return undefined;
}

function anyWithin(triples: readonly number[], [x, y, z]: Vec3, radius: number): boolean {
  const limit = radius * radius;
  for (let index = 0; index < triples.length; index += 3) {
    const dx = triples[index]! - x;
    const dy = triples[index + 1]! - y;
    const dz = triples[index + 2]! - z;
    if (dx * dx + dy * dy + dz * dz < limit) return true;
  }
  return false;
}

function distance(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}
