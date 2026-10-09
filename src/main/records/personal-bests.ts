/**
 * The commander's own records, as Elite Observatory's Stat Scanner keeps them: the largest,
 * hottest, fastest-orbiting… body of each class they have scanned. Every `Scan` is compared with
 * the bests so far, and one that beats a record says so.
 */

import type { JournalEvent } from '../../shared/journal';

export type RecordCategory =
  | 'largest'
  | 'smallest'
  | 'heaviest'
  | 'lightest'
  | 'slowest_orbit'
  | 'fastest_orbit'
  | 'hottest'
  | 'coldest'
  | 'highest_gravity'
  | 'closest_binary'
  | 'most_rings'
  | 'most_eccentric';

/** A best as the database keeps it. */
export interface BodyRecord {
  /** The commander's FID, or '' before the journal named one. */
  commander: string;
  category: RecordCategory;
  /** The journal's `PlanetClass` or `StarType`, e.g. `Water world`, `K`. */
  bodyClass: string;
  value: number;
  bodyName: string;
  systemName: string;
  /** When the scan that set it was made. */
  timestamp: string;
}

/** A record a scan has just beaten. */
export interface BrokenRecord {
  category: RecordCategory;
  bodyClass: string;
  kind: 'star' | 'planet';
  value: number;
  /** The best it beat. */
  previous: number;
  bodyName: string;
  systemName: string;
}

interface Category {
  id: RecordCategory;
  /** Whether a bigger value beats a smaller one. */
  most: boolean;
  kinds: readonly ('star' | 'planet')[];
  /** "largest", as in "the largest water world". */
  adjective: string;
}

const CATEGORIES: readonly Category[] = [
  { id: 'largest', most: true, kinds: ['star', 'planet'], adjective: 'largest' },
  { id: 'smallest', most: false, kinds: ['star', 'planet'], adjective: 'smallest' },
  { id: 'heaviest', most: true, kinds: ['star', 'planet'], adjective: 'most massive' },
  { id: 'lightest', most: false, kinds: ['star', 'planet'], adjective: 'least massive' },
  { id: 'slowest_orbit', most: true, kinds: ['planet'], adjective: 'slowest orbiting' },
  { id: 'fastest_orbit', most: false, kinds: ['planet'], adjective: 'fastest orbiting' },
  { id: 'hottest', most: true, kinds: ['planet'], adjective: 'hottest' },
  { id: 'coldest', most: false, kinds: ['planet'], adjective: 'coldest' },
  { id: 'highest_gravity', most: true, kinds: ['planet'], adjective: 'highest gravity' },
  { id: 'closest_binary', most: false, kinds: ['planet'], adjective: 'closest binary' },
  { id: 'most_rings', most: true, kinds: ['planet'], adjective: 'most ringed' },
  { id: 'most_eccentric', most: true, kinds: ['planet'], adjective: 'most eccentric' },
];

const CATEGORY_BY_ID = new Map(CATEGORIES.map((category) => [category.id, category]));

/**
 * Scans of a class the commander has made before a best of it is worth announcing. The first few
 * water worlds anyone scans are each the largest, the smallest, the hottest… and saying so is noise.
 */
export const MIN_SCANS_BEFORE_ANNOUNCING = 5;

/** A planet orbiting a barycentre, waiting for its partner's scan to measure the pair. */
interface BinaryPartner {
  bodyId: number;
  semiMajorAxis: number;
  bodyClass: string;
  bodyName: string;
}

export class PersonalBests {
  /** By commander, then `category:bodyClass`. */
  readonly #bests = new Map<string, Map<string, BodyRecord>>();
  /** Scans of each class this run has seen, by commander then class; only the replay seeds it. */
  readonly #scans = new Map<string, Map<string, number>>();
  /** Bests changed since `takeChanged`, to be written to the database. */
  #changed = new Map<string, BodyRecord>();
  #commander = '';
  /** Planets around each barycentre of the current system, by the barycentre's body id. */
  #binaries = new Map<number, BinaryPartner[]>();
  #system: string | undefined;

  constructor(saved: readonly BodyRecord[] = []) {
    for (const record of saved) this.#bestsOf(record.commander).set(keyOf(record), record);
  }

  /**
   * Compares a scan with the bests; returns those it beat, if they are worth announcing: a
   * well-established best, beaten by a body other than the one that held it.
   */
  apply(event: JournalEvent): BrokenRecord[] {
    switch (event.event) {
      case 'Commander':
        this.#commander = event.FID;
        return [];
      case 'LoadGame':
        this.#commander = event.FID;
        return [];
      case 'Location':
      case 'FSDJump':
      case 'CarrierJump':
        if (String(event.SystemAddress) !== this.#system) {
          this.#system = String(event.SystemAddress);
          this.#binaries = new Map();
        }
        return [];
      case 'Scan':
        return this.#scan(event);
      default:
        return [];
    }
  }

  /** Bests changed since the last call, for the database. */
  takeChanged(): BodyRecord[] {
    const changed = [...this.#changed.values()];
    this.#changed = new Map();
    return changed;
  }

  /** The bests each body in `bodyNames` holds, as "Largest water world", for the current commander. */
  held(bodyNames: ReadonlySet<string>): Map<string, string[]> {
    const held = new Map<string, string[]>();
    for (const record of this.#bestsOf(this.#commander).values()) {
      if (!bodyNames.has(record.bodyName)) continue;
      const label = recordLabel(record.category, record.bodyClass);
      held.set(record.bodyName, [...(held.get(record.bodyName) ?? []), label]);
    }
    return held;
  }

  #scan(event: Extract<JournalEvent, { event: 'Scan' }>): BrokenRecord[] {
    const kind = event.StarType !== undefined ? 'star' : event.PlanetClass ? 'planet' : undefined;
    const bodyClass = event.StarType ?? event.PlanetClass;
    // Belt clusters have neither.
    if (!kind || !bodyClass) return [];
    const systemName = event.StarSystem;
    if (String(event.SystemAddress) !== this.#system) {
      this.#system = String(event.SystemAddress);
      this.#binaries = new Map();
    }

    const scans = this.#scansOf(this.#commander);
    const seen = scans.get(bodyClass) ?? 0;
    scans.set(bodyClass, seen + 1);

    const values: [RecordCategory, number | undefined][] = [
      ['largest', positive(event.Radius)],
      ['smallest', positive(event.Radius)],
      ['heaviest', positive(kind === 'star' ? event.StellarMass : event.MassEM)],
      ['lightest', positive(kind === 'star' ? event.StellarMass : event.MassEM)],
      ['slowest_orbit', positive(event.OrbitalPeriod)],
      ['fastest_orbit', positive(event.OrbitalPeriod)],
      ['hottest', positive(event.SurfaceTemperature)],
      ['coldest', positive(event.SurfaceTemperature)],
      ['highest_gravity', positive(event.SurfaceGravity)],
      ['most_rings', event.Rings && event.Rings.length > 0 ? event.Rings.length : undefined],
      ['most_eccentric', positive(event.Eccentricity)],
    ];
    const broken: BrokenRecord[] = [];
    const compare = (
      category: RecordCategory,
      value: number | undefined,
      bodyClassHere: string,
      bodyName: string,
      announce: boolean,
    ) => {
      const definition = CATEGORY_BY_ID.get(category)!;
      if (value === undefined || !definition.kinds.includes(kind)) return;
      const beaten = this.#offer({
        commander: this.#commander,
        category,
        bodyClass: bodyClassHere,
        value,
        bodyName,
        systemName,
        timestamp: event.timestamp,
      });
      if (beaten && announce) {
        broken.push({
          category,
          bodyClass: bodyClassHere,
          kind,
          value,
          bodyName,
          systemName,
          ...beaten,
        });
      }
    };

    const established = seen >= MIN_SCANS_BEFORE_ANNOUNCING;
    for (const [category, value] of values) {
      compare(category, value, bodyClass, event.BodyName, established);
    }
    if (kind === 'planet') {
      for (const pair of this.#binaryPairs(event, bodyClass)) {
        const partnerEstablished = (scans.get(pair.bodyClass) ?? 0) > MIN_SCANS_BEFORE_ANNOUNCING;
        compare(
          'closest_binary',
          pair.separation,
          pair.bodyClass,
          pair.bodyName,
          partnerEstablished,
        );
      }
    }
    return broken;
  }

  /**
   * A planet that shares a barycentre with one other planet, once both are scanned: the pair's
   * separation (both semi-major axes, in metres), offered to each planet's class. Trinaries and
   * pairs with a star or another barycentre are left out.
   */
  #binaryPairs(
    event: Extract<JournalEvent, { event: 'Scan' }>,
    bodyClass: string,
  ): { bodyClass: string; bodyName: string; separation: number }[] {
    const barycentre = event.Parents?.[0]?.Null;
    const semiMajorAxis = positive(event.SemiMajorAxis);
    if (barycentre === undefined || semiMajorAxis === undefined) return [];
    const partners = this.#binaries.get(barycentre) ?? [];
    if (partners.some((partner) => partner.bodyId === event.BodyID)) return [];
    partners.push({ bodyId: event.BodyID, semiMajorAxis, bodyClass, bodyName: event.BodyName });
    this.#binaries.set(barycentre, partners);
    if (partners.length !== 2) return [];
    const separation = partners[0]!.semiMajorAxis + partners[1]!.semiMajorAxis;
    return partners.map((partner) => ({
      bodyClass: partner.bodyClass,
      bodyName: partner.bodyName,
      separation,
    }));
  }

  /** Keeps `record` if it beats the best; returns what it beat, unless it set the first one. */
  #offer(record: BodyRecord): { previous: number } | undefined {
    const bests = this.#bestsOf(record.commander);
    const key = keyOf(record);
    const best = bests.get(key);
    const most = CATEGORY_BY_ID.get(record.category)!.most;
    if (best && (most ? record.value <= best.value : record.value >= best.value)) return undefined;
    bests.set(key, record);
    this.#changed.set(`${record.commander}:${key}`, record);
    // A body beating its own best (a rescan, or a detailed scan after the automatic one) isn't news.
    if (!best || best.bodyName === record.bodyName) return undefined;
    return { previous: best.value };
  }

  #bestsOf(commander: string): Map<string, BodyRecord> {
    let bests = this.#bests.get(commander);
    if (!bests) this.#bests.set(commander, (bests = new Map()));
    return bests;
  }

  #scansOf(commander: string): Map<string, number> {
    let scans = this.#scans.get(commander);
    if (!scans) this.#scans.set(commander, (scans = new Map()));
    return scans;
  }
}

function keyOf(record: { category: string; bodyClass: string }): string {
  return `${record.category}:${record.bodyClass}`;
}

function positive(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

/** "Largest water world", for the body panel. */
export function recordLabel(category: RecordCategory, bodyClass: string): string {
  const adjective = CATEGORY_BY_ID.get(category)?.adjective ?? category;
  const text = `${adjective} ${bodyClassName(bodyClass)}`;
  return text[0]!.toUpperCase() + text.slice(1);
}

/**
 * One line for everything a scan beat, as it is said: "A 3 is your largest and hottest water world
 * yet." Records of two classes (a binary pair's partner) get a sentence each.
 */
export function personalBestCallout(broken: readonly BrokenRecord[], systemName: string): string {
  const byBody = new Map<string, BrokenRecord[]>();
  for (const record of broken) {
    const key = `${record.bodyName} ${record.bodyClass}`;
    byBody.set(key, [...(byBody.get(key) ?? []), record]);
  }
  const sentences = [...byBody.values()].map((records) => {
    const first = records[0]!;
    const adjectives = records.map((record) => CATEGORY_BY_ID.get(record.category)!.adjective);
    return `${shortName(first.bodyName, systemName)} is your ${listed(adjectives)} ${bodyClassName(first.bodyClass)} yet.`;
  });
  return `Personal best. ${sentences.join(' ')}`;
}

function listed(words: readonly string[]): string {
  if (words.length <= 1) return words[0] ?? '';
  return `${words.slice(0, -1).join(', ')} and ${words.at(-1)!}`;
}

function shortName(name: string, systemName: string): string {
  return name.length > systemName.length &&
    name.toLowerCase().startsWith(`${systemName.toLowerCase()} `)
    ? name.slice(systemName.length + 1)
    : name;
}

const STAR_NAMES: Readonly<Record<string, string>> = {
  N: 'neutron star',
  H: 'black hole',
  SupermassiveBlackHole: 'supermassive black hole',
  TTS: 'T Tauri star',
  AeBe: 'Herbig Ae/Be star',
  X: 'exotic star',
  Nebula: 'nebula',
  StellarRemnantNebula: 'stellar remnant nebula',
};

const PLANET_NAMES: Readonly<Record<string, string>> = {
  'earthlike body': 'Earth-like world',
  'high metal content body': 'high metal content world',
  'metal rich body': 'metal-rich body',
  'water giant': 'water giant',
  'helium rich gas giant': 'helium-rich gas giant',
  'gas giant with water based life': 'gas giant with water-based life',
  'gas giant with ammonia based life': 'gas giant with ammonia-based life',
};

/** "water world", "class II gas giant", "class K star", "neutron star": a class as it is said. */
export function bodyClassName(bodyClass: string): string {
  const star = STAR_NAMES[bodyClass];
  if (star) return star;
  const supergiant = /^([A-Z])_\w*SuperGiant$/.exec(bodyClass);
  if (supergiant) return `class ${supergiant[1]!} supergiant`;
  if (/^D[A-Z]*$/.test(bodyClass)) return `class ${bodyClass} white dwarf`;
  if (/^W[A-Z]*$/.test(bodyClass)) return `class ${bodyClass} Wolf-Rayet star`;
  if (/^[A-Z][A-Za-z]*$/.test(bodyClass) && bodyClass.length <= 3) return `class ${bodyClass} star`;
  const lower = bodyClass.toLowerCase();
  const gasGiant = /^sudarsky class (\w+) gas giant$/.exec(lower);
  if (gasGiant) return `class ${gasGiant[1]!.toUpperCase()} gas giant`;
  return PLANET_NAMES[lower] ?? lower;
}
