/**
 * Writes the demo's journal: a made-up commander on a made-up exobiology trip, as the game would
 * have written it, so the real services can make the mock's scenario from it (and the real app
 * can be pointed at it with `EDSSI_JOURNAL_DIR`).
 *
 * Three sessions, timed back from `now`:
 * - six days ago, in the bubble: swaps into the explorer and takes the carrier out;
 * - yesterday, deep out: a loop of systems with life, sold at the carrier's Vista Genomics;
 * - today, still going: a plotted route, two systems with life sampled and unsold, and the
 *   current one being surveyed — the commander in low flight over a world with three genera.
 *
 * The biology isn't guessed: each body's genera are what EDSSI's own spawn rules predict for it,
 * so the survey reads as the real thing would. The ships' modules come from EDSY's tables.
 */

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  type GenusPrediction,
  type PlanetFacts,
  predictLife,
  type StarFacts,
} from '../../src/main/history/biology/predict';
import { MATERIALS, RECIPES } from '../../src/shared/recipes.generated';
import type { ShipCatalog } from '../../src/shared/ships';

const G = 9.797759;
const ATMOSPHERE = 101_231.65625;

export const COMMANDER = 'Vesper Kael';
const FID = 'F9000417';
const CARRIER = { id: 3_700_000_417, callsign: 'K7V-2TQ', name: 'HOLLOW LANTERN' };
const EXPLORER = { id: 12, name: 'Long Quiet', ident: 'VK-07' };
const RUNABOUT = { id: 4, name: 'Spanner', ident: 'VK-04' };
const STATION = { name: 'Jameson Memorial', marketId: 128_666_762 };
const SHINRARTA = {
  name: 'Shinrarta Dezhra',
  address: 3_932_277_478_106,
  pos: [55.71875, 17.59375, 27.15625] as const,
};

/** What the scenario builder needs back besides the files. */
export interface DemoJournal {
  dir: string;
  /** A Spansh-style CSV of the whole trip, for the Route tab's CSV page and map. */
  csv: string;
  /** The route system the commander is in, on that CSV. */
  csvPosition: number;
  /** The hulls the commander owns, for their stock fits. */
  hulls: string[];
}

type Vec3 = readonly [number, number, number];

// ---------- a little determinism ----------

let seed = 417;
function random(): number {
  seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
  return seed / 2_147_483_648;
}
const between = (low: number, high: number) => low + random() * (high - low);
const round = (value: number, places: number) => Number(value.toFixed(places));
const lightYears = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

// ---------- the systems ----------

interface StarSpec {
  type: string;
  subclass: number;
  luminosity: string;
  mass: number;
  radius: number;
  temperature: number;
  magnitude: number;
}

interface PlanetSpec {
  /** After the system's name, e.g. `A 2` or `4 a`. */
  suffix: string;
  bodyId: number;
  planetClass: string;
  distanceLs: number;
  gravityG: number;
  temperature: number;
  atmosphere?: { type: string; text: string; pressureAtm: number; gases: Record<string, number> };
  volcanism?: string;
  terraform?: boolean;
  massEm: number;
  radiusKm: number;
  landable: boolean;
  materials?: string[];
  /** Genera to name when mapped; that many are picked from what the rules predict. */
  life?: number;
  /** Mapped with probes. */
  mapped?: boolean;
  /** Species sampled to the end (`complete`), or begun (`logged`). */
  sampled?: { complete: number; logged?: boolean };
}

interface SystemSpec {
  name: string;
  address: number;
  pos: Vec3;
  star: StarSpec;
  planets: PlanetSpec[];
}

const STARS: Record<string, StarSpec> = {
  K: {
    type: 'K',
    subclass: 3,
    luminosity: 'Va',
    mass: 0.71,
    radius: 0.78,
    temperature: 4520,
    magnitude: 6.6,
  },
  G: {
    type: 'G',
    subclass: 6,
    luminosity: 'V',
    mass: 0.93,
    radius: 0.95,
    temperature: 5410,
    magnitude: 5.1,
  },
  F: {
    type: 'F',
    subclass: 8,
    luminosity: 'V',
    mass: 1.18,
    radius: 1.12,
    temperature: 6230,
    magnitude: 3.9,
  },
  M: {
    type: 'M',
    subclass: 2,
    luminosity: 'Va',
    mass: 0.42,
    radius: 0.48,
    temperature: 3420,
    magnitude: 9.4,
  },
  L: {
    type: 'L',
    subclass: 4,
    luminosity: 'V',
    mass: 0.07,
    radius: 0.12,
    temperature: 1580,
    magnitude: 14.2,
  },
  A: {
    type: 'A',
    subclass: 1,
    luminosity: 'Va',
    mass: 2.1,
    radius: 1.71,
    temperature: 9180,
    magnitude: 1.4,
  },
};

const SECTOR = 'Phroi Pruae';
const START: Vec3 = [-2_412.5, 38.3125, 9_874.21875];

/** A boxel-ish name, for a system `index` along the trip. */
function systemName(index: number, mass: string): string {
  const a = 'ABCDEFGHJKLMNOPQRSTUVWXYZ';
  const pick = (n: number) => a[n % a.length]!;
  return `${SECTOR} ${pick(index * 7 + 3)}${pick(index * 11 + 5)}-${pick(index * 5 + 1)} ${mass}${
    (index % 9) + 2
  }-${1_021 + index * 37}`;
}

/** The trip from the carrier's anchorage outwards, one system per jump. */
function tripSystems(count: number): SystemSpec[] {
  const systems: SystemSpec[] = [];
  let pos = START;
  const classes = 'KGKMFKGKLMKGFKAGKMKGKFKGMK';
  for (let index = 0; index < count; index++) {
    const starClass = classes[index % classes.length]!;
    systems.push({
      name: systemName(index, 'ML'.includes(starClass) ? 'c' : 'd'),
      address: 2_871_300_000_000 + index * 5_570_419,
      pos,
      star: STARS[starClass]!,
      planets: [],
    });
    pos = [
      round(pos[0] - between(30, 48), 5),
      round(pos[1] + between(-6, 6), 5),
      round(pos[2] + between(40, 58), 5),
    ];
  }
  return systems;
}

// ---------- the journal ----------

type Fields = Record<string, unknown>;

class Writer {
  private files: { name: string; lines: string[] }[] = [];
  constructor(private time: number) {}

  /** A new file, named for the time it starts as the game names them. */
  file(part = 1): void {
    const at = new Date(this.time).toISOString().replace(/[-:]/g, '').slice(0, 15);
    // Journal.2026-10-12T183015.01.log
    const stamp = `${at.slice(0, 4)}-${at.slice(4, 6)}-${at.slice(6, 8)}T${at.slice(9, 15)}`;
    this.files.push({ name: `Journal.${stamp}.0${part}.log`, lines: [] });
  }

  at(time: number): void {
    this.time = time;
  }

  /** Moves the clock on, a little unevenly, as a commander does. */
  pass(seconds: number): void {
    this.time += Math.round(seconds * between(0.85, 1.15) * 1000);
  }

  get now(): string {
    return new Date(Math.floor(this.time / 1000) * 1000).toISOString().replace('.000Z', 'Z');
  }

  get clock(): number {
    return this.time;
  }

  event(event: string, fields: Fields = {}): Fields {
    const line = { timestamp: this.now, event, ...fields };
    this.files.at(-1)!.lines.push(JSON.stringify(line));
    return line;
  }

  write(dir: string): void {
    for (const file of this.files)
      writeFileSync(join(dir, file.name), `${file.lines.join('\r\n')}\r\n`);
  }
}

// ---------- the ships ----------

interface Module {
  Slot: string;
  Item: string;
  On: boolean;
  Priority: number;
  Health: number;
  Value: number;
  Engineering?: Fields;
}

function moduleValue(catalog: ShipCatalog, item: string): number {
  return catalog.modules[item]?.cost ?? 0;
}

function known(catalog: ShipCatalog, item: string): string | undefined {
  return catalog.modules[item] ? item : undefined;
}

/** The explorer: the stock hull, its guns taken off, a long-range drive and everything a trip wants. */
function explorerModules(catalog: ShipCatalog, ship: string): Module[] {
  const hull = catalog.ships[ship]!;
  const modules = new Map<string, string>(Object.entries(hull.stock));
  for (const slot of hull.slots) {
    if (slot.group === 'hardpoint') modules.delete(slot.name);
  }
  const utility = hull.slots.find((slot) => slot.group === 'utility');
  if (utility) modules.set(utility.name, 'hpt_heatsinklauncher_turret_tiny');
  const fsd = hull.slots.find((slot) => slot.name === 'FrameShiftDrive');
  if (fsd) {
    const item =
      known(catalog, `int_hyperdrive_overcharge_size${fsd.size}_class5`) ??
      `int_hyperdrive_size${fsd.size}_class5`;
    modules.set(fsd.name, item);
  }
  // The optional slots, biggest first: scoop, shields, repairs, the SRV, the booster, the scanner.
  const internals = hull.slots
    .filter((slot) => slot.group === 'internal' && !slot.only)
    .toSorted((a, b) => b.size - a.size);
  const wants = [
    (size: number) => known(catalog, `int_fuelscoop_size${size}_class5`),
    (size: number) => known(catalog, `int_shieldgenerator_size${Math.min(size, 5)}_class2`),
    (size: number) => known(catalog, `int_repairer_size${Math.min(size, 4)}_class5`),
    (size: number) => (size >= 2 ? known(catalog, 'int_buggybay_size2_class2') : undefined),
    (size: number) => known(catalog, `int_guardianfsdbooster_size${Math.min(size, 5)}`),
    (size: number) => (size >= 1 ? known(catalog, 'int_detailedsurfacescanner_tiny') : undefined),
  ];
  for (const slot of internals) {
    const want = wants.shift();
    const item = want?.(slot.size);
    if (item) modules.set(slot.name, item);
  }
  return [...modules].map(([slot, item]) => ({
    Slot: slot,
    Item: item,
    On: true,
    Priority: slot === 'Armour' ? 1 : 0,
    Health: 1,
    Value: moduleValue(catalog, item),
    ...(slot === 'FrameShiftDrive' && {
      Engineering: {
        Engineer: 'Felicity Farseer',
        EngineerID: 300100,
        BlueprintID: 128673694,
        BlueprintName: 'FSD_LongRange',
        Level: 5,
        Quality: 1,
        ExperimentalEffect: 'special_fsd_heavy',
        ExperimentalEffect_Localised: 'Mass Manager',
        Modifiers: [
          { Label: 'Mass', Value: 26, OriginalValue: 20, LessIsGood: 1 },
          { Label: 'FSDOptimalMass', Value: 2_390.4, OriginalValue: 1_440, LessIsGood: 0 },
        ],
      },
    }),
  }));
}

/** The runabout as the shipyard sells it. */
function stockModules(catalog: ShipCatalog, ship: string): Module[] {
  return Object.entries(catalog.ships[ship]!.stock).map(([slot, item]) => ({
    Slot: slot,
    Item: item,
    On: true,
    Priority: 0,
    Health: 1,
    Value: moduleValue(catalog, item),
  }));
}

function loadout(
  catalog: ShipCatalog,
  ship: string,
  who: { id: number; name: string; ident: string },
  modules: Module[],
  jump: number,
): Fields {
  const tankSize = catalog.ships[ship]!.slots.find((slot) => slot.name === 'FuelTank')?.size ?? 5;
  const modulesValue = modules.reduce((sum, module) => sum + module.Value, 0);
  const hullValue = catalog.ships[ship]!.hullCost ?? 50_000_000;
  return {
    Ship: ship,
    ShipID: who.id,
    ShipName: who.name,
    ShipIdent: who.ident,
    HullValue: hullValue,
    ModulesValue: modulesValue,
    HullHealth: 1,
    UnladenMass: 612.4,
    CargoCapacity: 0,
    MaxJumpRange: jump,
    FuelCapacity: { Main: 2 ** tankSize, Reserve: 0.79 },
    Rebuy: Math.round((hullValue + modulesValue) * 0.05),
    Modules: modules,
  };
}

// ---------- the bodies ----------

function starScan(system: SystemSpec): Fields {
  const { star } = system;
  return {
    ScanType: 'AutoScan',
    BodyName: system.name,
    BodyID: 0,
    StarSystem: system.name,
    SystemAddress: system.address,
    DistanceFromArrivalLS: 0,
    StarType: star.type,
    Subclass: star.subclass,
    StellarMass: star.mass,
    Radius: star.radius * 695_700_000,
    AbsoluteMagnitude: star.magnitude,
    Age_MY: 8_420,
    SurfaceTemperature: star.temperature,
    Luminosity: star.luminosity,
    RotationPeriod: 312_000,
    AxialTilt: 0,
    WasDiscovered: false,
    WasMapped: false,
  };
}

function planetScan(system: SystemSpec, planet: PlanetSpec): Fields {
  const atmosphere = planet.atmosphere;
  return {
    ScanType: 'Detailed',
    BodyName: `${system.name} ${planet.suffix}`,
    BodyID: planet.bodyId,
    Parents: [{ Star: 0 }],
    StarSystem: system.name,
    SystemAddress: system.address,
    DistanceFromArrivalLS: planet.distanceLs,
    TidalLock: planet.landable,
    TerraformState: planet.terraform ? 'Terraformable' : '',
    PlanetClass: planet.planetClass,
    Atmosphere: atmosphere?.text ?? '',
    AtmosphereType: atmosphere?.type ?? 'None',
    ...(atmosphere && {
      AtmosphereComposition: Object.entries(atmosphere.gases).map(([Name, Percent]) => ({
        Name,
        Percent,
      })),
    }),
    Volcanism: planet.volcanism ?? '',
    MassEM: planet.massEm,
    Radius: planet.radiusKm * 1000,
    SurfaceGravity: round(planet.gravityG * G, 6),
    SurfaceTemperature: planet.temperature,
    SurfacePressure: round((atmosphere?.pressureAtm ?? 0) * ATMOSPHERE, 4),
    Landable: planet.landable,
    ...(planet.materials && {
      Materials: planet.materials.map((Name, index) => ({
        Name,
        Percent: round(Math.max(0.4, 22 - index * 2.4 + between(-1, 1)), 6),
      })),
    }),
    Composition: { Ice: 0, Rock: 0.67, Metal: 0.33 },
    SemiMajorAxis: planet.distanceLs * 299_792_458,
    Eccentricity: 0.0021,
    OrbitalInclination: 0.84,
    Periapsis: 211.6,
    OrbitalPeriod: Math.round(planet.distanceLs * 9_400),
    AscendingNode: 47.2,
    MeanAnomaly: 131.5,
    RotationPeriod: Math.round(planet.distanceLs * 9_400),
    AxialTilt: 0.21,
    WasDiscovered: false,
    WasMapped: false,
    WasFootfalled: false,
  };
}

/** What the spawn rules predict for `planet`, as the history tracker would ask. */
function predicted(system: SystemSpec, planet: PlanetSpec): GenusPrediction[] {
  const stars: StarFacts[] = [
    {
      bodyName: system.name,
      starType: system.star.type,
      luminosity: system.star.luminosity,
      distanceLs: 0,
    },
  ];
  const facts: PlanetFacts = {
    bodyName: `${system.name} ${planet.suffix}`,
    planetClass: planet.planetClass,
    atmosphereType: planet.atmosphere?.type ?? 'None',
    atmosphere: planet.atmosphere?.gases ?? {},
    volcanism: planet.volcanism ?? '',
    gravity: planet.gravityG * G,
    temperature: planet.temperature,
    pressure: (planet.atmosphere?.pressureAtm ?? 0) * ATMOSPHERE,
    distanceLs: planet.distanceLs,
    orbitalPeriod: Math.round(planet.distanceLs * 9_400),
    materials: planet.materials ?? [],
  };
  return predictLife(
    {
      name: system.name,
      position: system.pos,
      stars,
      planetClasses: system.planets.map((p) => p.planetClass),
    },
    facts,
  );
}

const CO2 = (pressureAtm: number) => ({
  type: 'CarbonDioxide',
  text: 'thin carbon dioxide atmosphere',
  pressureAtm,
  gases: { CarbonDioxide: 99.01, SulphurDioxide: 0.99 },
});
const AMMONIA = {
  type: 'Ammonia',
  text: 'thin ammonia atmosphere',
  pressureAtm: 0.0091,
  gases: { Ammonia: 100 },
};
const ARGON = {
  type: 'Argon',
  text: 'thin argon atmosphere',
  pressureAtm: 0.0042,
  gases: { Argon: 100 },
};
const ROCKY = [
  'iron',
  'sulphur',
  'carbon',
  'nickel',
  'phosphorus',
  'chromium',
  'manganese',
  'zinc',
  'germanium',
  'cadmium',
  'polonium',
];
const METAL = [
  'iron',
  'nickel',
  'sulphur',
  'carbon',
  'chromium',
  'phosphorus',
  'vanadium',
  'germanium',
  'tungsten',
  'mercury',
  'ruthenium',
];

/** Life worth stopping for, at stops 3, 5 and 6 of today's leg; yesterday's loop has some too. */
function populate(systems: SystemSpec[], lifeAt: Map<number, PlanetSpec[]>): void {
  for (const [index, planets] of lifeAt) systems[index]!.planets = planets;
  for (const [index, system] of systems.entries()) {
    if (lifeAt.has(index)) continue;
    system.planets = [
      {
        suffix: '1',
        bodyId: 2,
        planetClass: 'High metal content body',
        distanceLs: round(between(8, 40), 3),
        gravityG: round(between(0.3, 1.1), 3),
        temperature: Math.round(between(380, 900)),
        massEm: 0.31,
        radiusKm: 3_610,
        landable: true,
        materials: METAL,
      },
      {
        suffix: '2',
        bodyId: 3,
        planetClass: 'Sudarsky class I gas giant',
        distanceLs: round(between(400, 1_400), 3),
        gravityG: 2.41,
        temperature: 112,
        massEm: 241.7,
        radiusKm: 62_400,
        landable: false,
      },
    ];
  }
}

// ---------- the trip ----------

export function writeDemoJournal(dir: string, catalog: ShipCatalog, now = Date.now()): DemoJournal {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const explorerShip = catalog.ships['mandalay'] ? 'mandalay' : 'anaconda';
  const runaboutShip = catalog.ships['krait_mkii'] ? 'krait_mkii' : 'python';
  const explorer = explorerModules(catalog, explorerShip);
  const explorerLoadout = loadout(catalog, explorerShip, EXPLORER, explorer, 71.36);
  const runaboutLoadout = loadout(
    catalog,
    runaboutShip,
    RUNABOUT,
    stockModules(catalog, runaboutShip),
    24.88,
  );
  const tank =
    2 ** (catalog.ships[explorerShip]!.slots.find((slot) => slot.name === 'FuelTank')?.size ?? 5);

  const trip = tripSystems(26);
  const anchorage = trip[0]!;
  // Yesterday's loop and today's leg share the anchorage; today's goes on to 14.
  const yesterday = [1, 2, 3, 2, 1].map((i) => ({
    ...trip[i]!,
    name: trip[i]!.name.replace(SECTOR, 'Eol Prou'),
    address: trip[i]!.address + 77,
  }));
  populate(
    trip,
    new Map<number, PlanetSpec[]>([
      [
        3,
        [
          {
            suffix: 'A 2',
            bodyId: 4,
            planetClass: 'Rocky body',
            distanceLs: 812.4,
            gravityG: 0.162,
            temperature: 171.3,
            atmosphere: CO2(0.0243),
            massEm: 0.0442,
            radiusKm: 2_104,
            landable: true,
            materials: ROCKY,
            life: 2,
            mapped: true,
            sampled: { complete: 2 },
          },
          {
            suffix: 'A 4',
            bodyId: 6,
            planetClass: 'High metal content body',
            distanceLs: 1_210.8,
            gravityG: 0.211,
            temperature: 178.9,
            atmosphere: CO2(0.0388),
            massEm: 0.0611,
            radiusKm: 2_334,
            landable: true,
            materials: METAL,
            life: 2,
            mapped: true,
          },
        ],
      ],
      [
        5,
        [
          {
            suffix: '3 b',
            bodyId: 9,
            planetClass: 'Rocky body',
            distanceLs: 488.1,
            gravityG: 0.087,
            temperature: 168.4,
            atmosphere: AMMONIA,
            massEm: 0.0129,
            radiusKm: 1_406,
            landable: true,
            materials: ROCKY,
            life: 1,
            mapped: true,
            sampled: { complete: 1 },
          },
        ],
      ],
      [
        6,
        [
          {
            suffix: '2',
            bodyId: 2,
            planetClass: 'Water world',
            distanceLs: 341.6,
            gravityG: 1.02,
            temperature: 288.7,
            terraform: true,
            atmosphere: {
              type: 'CarbonDioxide',
              text: 'carbon dioxide atmosphere',
              pressureAtm: 2.41,
              gases: { CarbonDioxide: 96.5, Nitrogen: 3.5 },
            },
            massEm: 0.84,
            radiusKm: 6_210,
            landable: false,
          },
          {
            suffix: '3',
            bodyId: 3,
            planetClass: 'High metal content body',
            distanceLs: 512.9,
            gravityG: 0.71,
            temperature: 301.2,
            terraform: true,
            atmosphere: {
              type: 'CarbonDioxide',
              text: 'thick carbon dioxide atmosphere',
              pressureAtm: 4.1,
              gases: { CarbonDioxide: 99 },
            },
            massEm: 0.58,
            radiusKm: 5_102,
            landable: false,
          },
          {
            suffix: '4 a',
            bodyId: 5,
            planetClass: 'Rocky body',
            distanceLs: 1_044.2,
            gravityG: 0.183,
            temperature: 176.1,
            atmosphere: CO2(0.0312),
            massEm: 0.0538,
            radiusKm: 2_201,
            landable: true,
            materials: ROCKY,
            life: 3,
            mapped: true,
            sampled: { complete: 0, logged: true },
          },
          {
            suffix: '5',
            bodyId: 7,
            planetClass: 'High metal content body',
            distanceLs: 1_580.4,
            gravityG: 0.124,
            temperature: 182.6,
            atmosphere: ARGON,
            massEm: 0.0247,
            radiusKm: 1_722,
            landable: true,
            materials: METAL,
            life: 2,
          },
          {
            suffix: '6',
            bodyId: 8,
            planetClass: 'Sudarsky class II gas giant',
            distanceLs: 2_388.5,
            gravityG: 3.1,
            temperature: 155,
            massEm: 412.2,
            radiusKm: 71_200,
            landable: false,
          },
        ],
      ],
    ]),
  );
  populate(
    yesterday,
    new Map<number, PlanetSpec[]>([
      [
        2,
        [
          {
            suffix: 'B 1',
            bodyId: 3,
            planetClass: 'Rocky body',
            distanceLs: 640.2,
            gravityG: 0.141,
            temperature: 174.5,
            atmosphere: CO2(0.0276),
            massEm: 0.0371,
            radiusKm: 1_988,
            landable: true,
            materials: ROCKY,
            life: 3,
            mapped: true,
            sampled: { complete: 3 },
          },
        ],
      ],
    ]),
  );

  const w = new Writer(now - 6 * 86_400_000);
  let fuel = tank;
  let samples: {
    genus: GenusPrediction;
    species: GenusPrediction['species'][number];
    system: SystemSpec;
    planet: PlanetSpec;
  }[] = [];
  const sold: typeof samples = [];

  const header = (part = 1) => {
    w.file(part);
    w.event('Fileheader', {
      part,
      language: 'English/UK',
      Odyssey: true,
      gameversion: '4.4.1.1',
      build: 'r332841/r0 ',
    });
  };
  const login = (ship: string, who: { id: number; name: string; ident: string }) => {
    w.event('Commander', { FID, Name: COMMANDER });
    w.event('Materials', materials());
    w.event('LoadGame', {
      FID,
      Commander: COMMANDER,
      Horizons: true,
      Odyssey: true,
      Ship: ship,
      ShipID: who.id,
      ShipName: who.name,
      ShipIdent: who.ident,
      FuelLevel: fuel,
      FuelCapacity: tank,
      GameMode: 'Solo',
      Credits: 1_204_877_310,
      Loan: 0,
      language: 'English/UK',
      gameversion: '4.4.1.1',
      build: 'r332841/r0 ',
    });
    w.event('Rank', {
      Combat: 3,
      Trade: 5,
      Explore: 7,
      Soldier: 0,
      Exobiologist: 6,
      Empire: 2,
      Federation: 3,
      CQC: 0,
    });
    w.event('Progress', {
      Combat: 41,
      Trade: 12,
      Explore: 63,
      Soldier: 0,
      Exobiologist: 37,
      Empire: 18,
      Federation: 54,
      CQC: 0,
    });
    w.event('Reputation', { Empire: 31.4, Federation: 52.9, Independent: 12.2, Alliance: 8.6 });
    w.event('EngineerProgress', { Engineers: ENGINEER_PROGRESS });
  };
  const fsdJump = (system: SystemSpec, from: SystemSpec | undefined) => {
    w.event('StartJump', {
      JumpType: 'Hyperspace',
      Taxi: false,
      StarSystem: system.name,
      SystemAddress: system.address,
      StarClass: system.star.type,
    });
    w.pass(18);
    const distance = from ? round(lightYears(system.pos, from.pos), 3) : 41.2;
    const used = round(distance / 14.8, 6);
    fuel = round(fuel - used, 6);
    w.event('FSDJump', {
      Taxi: false,
      Multicrew: false,
      StarSystem: system.name,
      SystemAddress: system.address,
      StarPos: system.pos,
      SystemAllegiance: '',
      SystemEconomy: '$economy_None;',
      SystemEconomy_Localised: 'None',
      SystemSecondEconomy: '$economy_None;',
      SystemSecondEconomy_Localised: 'None',
      SystemGovernment: '$government_None;',
      SystemGovernment_Localised: 'None',
      SystemSecurity: '$GAlAXY_MAP_INFO_state_anarchy;',
      SystemSecurity_Localised: 'Anarchy',
      Population: 0,
      Body: system.name,
      BodyID: 0,
      BodyType: 'Star',
      JumpDist: distance,
      FuelUsed: used,
      FuelLevel: fuel,
    });
    w.pass(6);
    w.event('Scan', starScan(system));
    if ('KGBFOAM'.includes(system.star.type)) {
      w.pass(9);
      const scooped = round(tank - fuel, 6);
      fuel = tank;
      w.event('FuelScoop', { Scooped: scooped, Total: tank });
    }
  };
  const survey = (system: SystemSpec, live: boolean) => {
    w.pass(12);
    w.event('FSSDiscoveryScan', {
      Progress: 1,
      BodyCount: system.planets.length + 1,
      NonBodyCount: 3,
      SystemName: system.name,
      SystemAddress: system.address,
    });
    for (const planet of system.planets) {
      w.pass(14);
      w.event('Scan', planetScan(system, planet));
      if (planet.life) {
        w.event('FSSBodySignals', {
          BodyName: `${system.name} ${planet.suffix}`,
          BodyID: planet.bodyId,
          SystemAddress: system.address,
          Signals: [
            {
              Type: '$SAA_SignalType_Biological;',
              Type_Localised: 'Biological',
              Count: planet.life,
            },
          ],
        });
      }
    }
    w.pass(10);
    w.event('FSSAllBodiesFound', {
      SystemName: system.name,
      SystemAddress: system.address,
      Count: system.planets.length + 1,
    });
    for (const planet of system.planets) {
      if (!planet.mapped) continue;
      const body = `${system.name} ${planet.suffix}`;
      const genera = predicted(system, planet)
        .filter((genus) => genus.species.length > 0)
        .toSorted((a, b) => b.species.at(-1)!.value - a.species.at(-1)!.value)
        .slice(0, planet.life ?? 0);
      w.pass(95);
      w.event('SAAScanComplete', {
        BodyName: body,
        SystemAddress: system.address,
        BodyID: planet.bodyId,
        ProbesUsed: 5,
        EfficiencyTarget: 6,
      });
      w.event('SAASignalsFound', {
        BodyName: body,
        SystemAddress: system.address,
        BodyID: planet.bodyId,
        Signals: [
          { Type: '$SAA_SignalType_Biological;', Type_Localised: 'Biological', Count: planet.life },
          { Type: '$SAA_SignalType_Geological;', Type_Localised: 'Geological', Count: 2 },
        ],
        Genuses: genera.map((genus) => ({ Genus: genus.code, Genus_Localised: genus.name })),
      });
      if (!planet.sampled) continue;
      w.pass(70);
      w.event('ApproachBody', {
        StarSystem: system.name,
        SystemAddress: system.address,
        Body: body,
        BodyID: planet.bodyId,
      });
      w.pass(40);
      w.event('Touchdown', {
        PlayerControlled: true,
        Taxi: false,
        Multicrew: false,
        StarSystem: system.name,
        SystemAddress: system.address,
        Body: body,
        BodyID: planet.bodyId,
        OnStation: false,
        OnPlanet: true,
        Latitude: -12.4,
        Longitude: 77.1,
      });
      w.event('Disembark', {
        SRV: true,
        Taxi: false,
        Multicrew: false,
        ID: 13,
        StarSystem: system.name,
        SystemAddress: system.address,
        Body: body,
        BodyID: planet.bodyId,
        OnStation: false,
        OnPlanet: true,
      });
      for (const [index, genus] of genera.entries()) {
        // The best species of each genus the rules allow: what's worth the drive.
        const species = genus.species.at(-1)!;
        const colour = species.colours[0] ?? '';
        const scan = (type: string) =>
          w.event('ScanOrganic', {
            ScanType: type,
            Genus: genus.code,
            Genus_Localised: genus.name,
            Species: species.code,
            Species_Localised: species.name,
            ...(colour && {
              Variant: species.code.replace('_Name;', `_${colour}_Name;`),
              Variant_Localised: `${species.name} - ${colour}`,
            }),
            WasLogged: false,
            SystemAddress: system.address,
            Body: planet.bodyId,
          });
        if (index < planet.sampled.complete) {
          for (const type of ['Log', 'Sample', 'Analyse']) {
            w.pass(170);
            scan(type);
          }
          samples.push({ genus, species, system, planet });
        } else if (planet.sampled.logged && index === planet.sampled.complete) {
          w.pass(150);
          scan('Log');
        }
      }
      w.pass(60);
      w.event('Embark', {
        SRV: true,
        Taxi: false,
        Multicrew: false,
        ID: 13,
        StarSystem: system.name,
        SystemAddress: system.address,
        Body: body,
        BodyID: planet.bodyId,
        OnStation: false,
        OnPlanet: true,
      });
      w.event('Liftoff', {
        PlayerControlled: true,
        Taxi: false,
        Multicrew: false,
        StarSystem: system.name,
        SystemAddress: system.address,
        Body: body,
        BodyID: planet.bodyId,
        OnStation: false,
        OnPlanet: true,
        Latitude: -12.4,
        Longitude: 77.1,
      });
      // Still over the last body of the system being surveyed now, looking for the next colony.
      if (live) continue;
      w.pass(40);
      w.event('LeaveBody', {
        StarSystem: system.name,
        SystemAddress: system.address,
        Body: body,
        BodyID: planet.bodyId,
      });
    }
  };
  const docked = (system: { name: string; address: number }, onCarrier: boolean) =>
    w.event(
      'Docked',
      onCarrier
        ? {
            StationName: CARRIER.callsign,
            StationType: 'FleetCarrier',
            Taxi: false,
            Multicrew: false,
            StarSystem: system.name,
            SystemAddress: system.address,
            MarketID: CARRIER.id,
            StationFaction: { Name: 'FleetCarrier' },
            StationGovernment: '$government_Carrier;',
            StationGovernment_Localised: 'Private Ownership',
            StationServices: CARRIER_SERVICES,
            StationEconomy: '$economy_Carrier;',
            StationEconomy_Localised: 'Private Enterprise',
            StationEconomies: [
              { Name: '$economy_Carrier;', Name_Localised: 'Private Enterprise', Proportion: 1 },
            ],
            DistFromStarLS: 0,
            LandingPads: { Small: 4, Medium: 4, Large: 8 },
          }
        : {
            StationName: STATION.name,
            StationType: 'Orbis',
            Taxi: false,
            Multicrew: false,
            StarSystem: system.name,
            SystemAddress: system.address,
            MarketID: STATION.marketId,
            StationFaction: { Name: 'The Pilots Federation', FactionState: 'None' },
            StationGovernment: '$government_Democracy;',
            StationGovernment_Localised: 'Democracy',
            StationServices: [
              'dock',
              'autodock',
              'commodities',
              'contacts',
              'exploration',
              'missions',
              'outfitting',
              'crewlounge',
              'rearm',
              'refuel',
              'repair',
              'shipyard',
              'tuning',
              'engineer',
              'missionsgenerated',
              'flightcontroller',
              'stationoperations',
              'powerplay',
              'searchrescue',
              'materialtrader',
              'stationMenu',
              'shop',
              'livery',
              'socialspace',
              'bartender',
              'vistagenomics',
              'pioneersupplies',
              'apexinterstellar',
              'frontlinesolutions',
            ],
            StationEconomy: '$economy_HighTech;',
            StationEconomy_Localised: 'High Tech',
            StationEconomies: [
              { Name: '$economy_HighTech;', Name_Localised: 'High Tech', Proportion: 1 },
            ],
            DistFromStarLS: 347.2,
            LandingPads: { Small: 17, Medium: 18, Large: 9 },
          },
    );
  const carrierStats = (fuelLevel: number) =>
    w.event('CarrierStats', {
      CarrierID: CARRIER.id,
      CarrierType: 'FleetCarrier',
      Callsign: CARRIER.callsign,
      Name: CARRIER.name,
      DockingAccess: 'squadronfriends',
      AllowNotorious: false,
      FuelLevel: fuelLevel,
      JumpRangeCurr: 500,
      JumpRangeMax: 500,
      PendingDecommission: false,
      SpaceUsage: {
        TotalCapacity: 25_000,
        Crew: 1_170,
        Cargo: 6_412,
        CargoSpaceReserved: 0,
        ShipPacks: 0,
        ModulePacks: 0,
        FreeSpace: 17_418,
      },
      Finance: {
        CarrierBalance: 2_418_966_120,
        ReserveBalance: 0,
        AvailableBalance: 2_418_966_120,
        ReservePercent: 0,
        TaxRate_rearm: 0,
        TaxRate_refuel: 0,
        TaxRate_repair: 0,
      },
      Crew: CARRIER_CREW,
      ShipPacks: [],
      ModulePacks: [],
    });

  // --- six days ago, in the bubble ---
  header();
  login(runaboutShip, RUNABOUT);
  w.event('Location', {
    Docked: true,
    StationName: STATION.name,
    StationType: 'Orbis',
    MarketID: STATION.marketId,
    Taxi: false,
    Multicrew: false,
    StarSystem: SHINRARTA.name,
    SystemAddress: SHINRARTA.address,
    StarPos: SHINRARTA.pos,
    SystemAllegiance: 'PilotsFederation',
    Population: 85_206_935,
    Body: STATION.name,
    BodyID: 64,
    BodyType: 'Station',
  });
  w.event('Loadout', runaboutLoadout);
  w.event('Missions', { Active: [], Failed: [], Complete: [] });
  w.pass(80);
  w.event('StoredShips', {
    StationName: STATION.name,
    MarketID: STATION.marketId,
    StarSystem: SHINRARTA.name,
    ShipsHere: [
      {
        ShipID: EXPLORER.id,
        ShipType: explorerShip,
        Name: EXPLORER.name,
        Value: explorerLoadout['HullValue'],
        Hot: false,
      },
    ],
    ShipsRemote: [
      {
        ShipID: 7,
        ShipType: 'type9',
        ShipType_Localised: 'Type-9 Heavy',
        Name: 'Slow Boat',
        StarSystem: 'Deciat',
        ShipMarketID: 128_015_000,
        TransferPrice: 1_802_440,
        TransferTime: 6_218,
        Value: 141_641_280,
        Hot: false,
      },
      {
        ShipID: 2,
        ShipType: 'sidewinder',
        Name: 'Pebble',
        StarSystem: 'LHS 20',
        ShipMarketID: 128_016_640,
        TransferPrice: 3_210,
        TransferTime: 1_604,
        Value: 48_067,
        Hot: false,
      },
    ],
  });
  w.pass(40);
  w.event('ShipyardSwap', {
    ShipType: explorerShip,
    ShipID: EXPLORER.id,
    StoreOldShip: runaboutShip,
    StoreShipID: RUNABOUT.id,
    MarketID: STATION.marketId,
  });
  w.event('Loadout', explorerLoadout);
  w.pass(60);
  w.event('Synthesis', synthesis('fsd premium', 'FSD Premium'));
  w.pass(30);
  w.event('Undocked', {
    StationName: STATION.name,
    StationType: 'Orbis',
    MarketID: STATION.marketId,
    Taxi: false,
    Multicrew: false,
  });
  w.pass(240);
  docked({ name: SHINRARTA.name, address: SHINRARTA.address }, true);
  carrierStats(1_000);
  for (let hop = 1; hop <= 4; hop++) {
    w.pass(900);
    const at: SystemSpec =
      hop === 4
        ? anchorage
        : {
            ...anchorage,
            name: systemName(100 + hop, 'd'),
            address: 1_200_000_000 + hop,
            pos: [round(55 - hop * 600, 3), 30, round(27 + hop * 2_460, 3)],
          };
    w.event('CarrierJumpRequest', {
      CarrierType: 'FleetCarrier',
      CarrierID: CARRIER.id,
      SystemName: at.name,
      SystemAddress: at.address,
      DepartureTime: new Date(w.clock + 15 * 60_000).toISOString().replace('.000Z', 'Z'),
    });
    w.pass(1_000);
    w.event('CarrierJump', {
      Docked: true,
      StationName: CARRIER.callsign,
      StationType: 'FleetCarrier',
      MarketID: CARRIER.id,
      StationFaction: { Name: 'FleetCarrier' },
      StationServices: CARRIER_SERVICES,
      Taxi: false,
      Multicrew: false,
      StarSystem: at.name,
      SystemAddress: at.address,
      StarPos: at.pos,
      SystemAllegiance: '',
      Population: 0,
      Body: at.name,
      BodyID: 0,
      BodyType: 'Star',
    });
  }
  w.pass(30);
  w.event('Shutdown');

  // --- yesterday, a loop from the carrier ---
  w.at(now - 26 * 3_600_000);
  header();
  login(explorerShip, EXPLORER);
  w.event('CarrierLocation', {
    CarrierType: 'FleetCarrier',
    CarrierID: CARRIER.id,
    StarSystem: anchorage.name,
    SystemAddress: anchorage.address,
    BodyID: 0,
  });
  w.event('Location', {
    Docked: true,
    StationName: CARRIER.callsign,
    StationType: 'FleetCarrier',
    MarketID: CARRIER.id,
    Taxi: false,
    Multicrew: false,
    StarSystem: anchorage.name,
    SystemAddress: anchorage.address,
    StarPos: anchorage.pos,
    Population: 0,
    Body: anchorage.name,
    BodyID: 0,
    BodyType: 'Star',
  });
  w.event('Loadout', explorerLoadout);
  w.event('Missions', { Active: [], Failed: [], Complete: [] });
  w.pass(30);
  w.event('Undocked', {
    StationName: CARRIER.callsign,
    StationType: 'FleetCarrier',
    MarketID: CARRIER.id,
    Taxi: false,
    Multicrew: false,
  });
  let from: SystemSpec | undefined = anchorage;
  for (const system of yesterday) {
    w.pass(40);
    fsdJump(system, from);
    if (system.planets.some((p) => p.life)) survey(system, false);
    from = system;
  }
  w.pass(40);
  fsdJump(anchorage, from);
  w.pass(120);
  docked(anchorage, true);
  w.pass(20);
  w.event('SellOrganicData', {
    MarketID: CARRIER.id,
    BioData: samples.map(({ genus, species }) => ({
      Genus: genus.code,
      Genus_Localised: genus.name,
      Species: species.code,
      Species_Localised: species.name,
      Value: species.value,
      Bonus: species.value * 4,
    })),
  });
  sold.push(...samples);
  samples = [];
  w.pass(15);
  w.event('MultiSellExplorationData', {
    Discovered: yesterday
      .slice(0, 3)
      .map((s) => ({ SystemName: s.name, NumBodies: s.planets.length + 1 })),
    BaseValue: 2_841_200,
    Bonus: 1_420_600,
    TotalEarnings: 4_261_800,
  });
  w.pass(50);
  w.event('Shutdown');

  // --- today ---
  w.at(now - 2 * 3_600_000 - 41 * 60_000);
  header();
  login(explorerShip, EXPLORER);
  w.event('CarrierLocation', {
    CarrierType: 'FleetCarrier',
    CarrierID: CARRIER.id,
    StarSystem: anchorage.name,
    SystemAddress: anchorage.address,
    BodyID: 0,
  });
  w.event('Location', {
    Docked: true,
    StationName: CARRIER.callsign,
    StationType: 'FleetCarrier',
    MarketID: CARRIER.id,
    Taxi: false,
    Multicrew: false,
    StarSystem: anchorage.name,
    SystemAddress: anchorage.address,
    StarPos: anchorage.pos,
    Population: 0,
    Body: anchorage.name,
    BodyID: 0,
    BodyType: 'Star',
  });
  w.event('Loadout', explorerLoadout);
  w.event('Missions', { Active: [], Failed: [], Complete: [] });
  w.event('Statistics', STATISTICS);
  w.pass(25);
  carrierStats(842);
  w.pass(20);
  w.event('Undocked', {
    StationName: CARRIER.callsign,
    StationType: 'FleetCarrier',
    MarketID: CARRIER.id,
    Taxi: false,
    Multicrew: false,
  });
  // One route plotted to the far end of today's leg.
  const leg = trip.slice(0, 15);
  w.pass(30);
  const plotted = w.event('NavRoute');
  const navRoute = {
    timestamp: plotted['timestamp'],
    event: 'NavRoute',
    Route: leg.map((system) => ({
      StarSystem: system.name,
      SystemAddress: system.address,
      StarPos: system.pos,
      StarClass: system.star.type,
    })),
  };
  from = anchorage;
  const here = 6;
  for (let index = 1; index <= here; index++) {
    const system = trip[index]!;
    w.event('FSDTarget', {
      Name: system.name,
      SystemAddress: system.address,
      StarClass: system.star.type,
      RemainingJumpsInRoute: leg.length - index,
    });
    w.pass(25);
    fsdJump(system, from);
    if (system.planets.some((p) => p.life)) survey(system, index === here);
    from = system;
  }
  const next = trip[here + 1]!;
  w.event('FSDTarget', {
    Name: next.name,
    SystemAddress: next.address,
    StarClass: next.star.type,
    RemainingJumpsInRoute: leg.length - 1 - here,
  });
  // Low over the body with life still to sample.
  const current = trip[here]!;
  const target = current.planets.find((planet) => planet.sampled?.logged)!;

  w.write(dir);
  writeFileSync(join(dir, 'NavRoute.json'), JSON.stringify(navRoute, null, 2));
  writeFileSync(
    join(dir, 'Status.json'),
    JSON.stringify(
      {
        timestamp: w.now,
        event: 'Status',
        // In the main ship, shields up, low over a surface with its latitude and longitude known.
        Flags: (1 << 24) | (1 << 21) | (1 << 3) | (1 << 29),
        Flags2: 0,
        Pips: [4, 8, 0],
        FireGroup: 0,
        GuiFocus: 0,
        Fuel: { FuelMain: round(fuel, 6), FuelReservoir: 0.61 },
        Cargo: 0,
        LegalState: 'Clean',
        Latitude: -12.418,
        Longitude: 77.106,
        Heading: 214,
        Altitude: 1_820,
        BodyName: `${current.name} ${target.suffix}`,
        PlanetRadius: target.radiusKm * 1000,
        Balance: 1_204_877_310,
        Destination: {
          System: current.address,
          Body: target.bodyId,
          Name: `${current.name} ${target.suffix}`,
        },
      },
      null,
      2,
    ),
  );
  writeFileSync(
    join(dir, 'Cargo.json'),
    JSON.stringify(
      { timestamp: w.now, event: 'Cargo', Vessel: 'Ship', Count: 0, Inventory: [] },
      null,
      2,
    ),
  );

  // The whole trip as Spansh's galaxy plotter exports it, for the CSV page.
  const rows = trip.map((system, index) => {
    const prev = trip[index - 1];
    const distance = prev ? lightYears(system.pos, prev.pos) : 0;
    const scoop = 'KGBFOAM'.includes(system.star.type);
    return [
      system.name,
      distance.toFixed(2),
      ((trip.length - 1 - index) * 44.1).toFixed(2),
      system.pos[0],
      system.pos[1],
      system.pos[2],
      system.star.type,
      scoop ? 'Yes' : 'No',
    ].join(',');
  });
  const csv = [
    '"System Name","Distance","Distance Remaining","X","Y","Z","Star Type","Refuel"',
    ...rows,
  ].join('\n');
  return {
    dir,
    csv,
    csvPosition: here,
    hulls: [explorerShip, runaboutShip, 'type9', 'sidewinder'],
  };
}

// ---------- the commander's lot ----------

/** Some of every material, more of the common ones, as a commander who engineers would have. */
function materials(): Fields {
  const lists: Record<'Raw' | 'Manufactured' | 'Encoded', Fields[]> = {
    Raw: [],
    Manufactured: [],
    Encoded: [],
  };
  for (const [name, info] of Object.entries(MATERIALS)) {
    const category = info.category;
    if (category !== 'Raw' && category !== 'Manufactured' && category !== 'Encoded') continue;
    if (name.startsWith('tg_') || name.startsWith('guardian_')) continue;
    const grade = info.grade ?? 3;
    const cap = [0, 300, 250, 200, 150, 100][grade] ?? 100;
    const count = Math.round(cap * between(0.05, 0.9));
    if (count === 0) continue;
    lists[category].push({
      Name: name,
      ...(category !== 'Raw' && { Name_Localised: info.name }),
      Count: count,
    });
  }
  return lists;
}

function synthesis(fdName: string, name: string): Fields {
  const recipe = RECIPES.find((candidate) => candidate.fdName === fdName)!;
  return {
    Name: name,
    Materials: recipe.ingredients.map(([Name, Count]) => ({ Name, Count })),
  };
}

const ENGINEERS = [
  ['Felicity Farseer', 300100, 'Unlocked', 5],
  ['Elvira Martuuk', 300160, 'Unlocked', 5],
  ['Professor Palin', 300220, 'Unlocked', 4],
  ['The Dweller', 300180, 'Unlocked', 5],
  ['Marco Qwent', 300200, 'Unlocked', 3],
  ['Lei Cheung', 300120, 'Unlocked', 2],
  ['Selene Jean', 300210, 'Invited'],
  ['Hera Tani', 300090, 'Invited'],
  ['Liz Ryder', 300080, 'Known'],
  ['Juri Ishmaak', 300250, 'Known'],
  ["Tod 'The Blaster' McQuinn", 300260, 'Known'],
  ['Didi Vatermann', 300000, 'Known'],
  ['Ram Tah', 300110, 'Known'],
  ['Mel Brandon', 300280, 'Known'],
  ['Etienne Dorn', 300290, 'Known'],
  ['Petra Olmanova', 300130, 'Known'],
] as const;
const ENGINEER_PROGRESS = ENGINEERS.map(([name, id, progress, rank]) => ({
  Engineer: name,
  EngineerID: id,
  Progress: progress,
  ...(rank !== undefined && { RankProgress: rank === 5 ? 0 : 42, Rank: rank }),
}));

const CARRIER_SERVICES = [
  'dock',
  'autodock',
  'commodities',
  'contacts',
  'exploration',
  'crewlounge',
  'rearm',
  'refuel',
  'repair',
  'engineer',
  'flightcontroller',
  'stationoperations',
  'stationMenu',
  'carriermanagement',
  'carrierfuel',
  'socialspace',
  'vistagenomics',
];
const CARRIER_CREW = [
  { CrewRole: 'Captain', Activated: true, Enabled: true, CrewName: 'Ines Okafor' },
  { CrewRole: 'Refuel', Activated: true, Enabled: true, CrewName: 'Tomas Reyes' },
  { CrewRole: 'Repair', Activated: true, Enabled: true, CrewName: 'Mira Holt' },
  { CrewRole: 'Rearm', Activated: true, Enabled: true, CrewName: 'Dev Anand' },
  { CrewRole: 'Commodities', Activated: true, Enabled: true, CrewName: 'Saul Brennan' },
  { CrewRole: 'Exploration', Activated: true, Enabled: true, CrewName: 'Wren Calder' },
  { CrewRole: 'CarrierFuel', Activated: true, Enabled: true, CrewName: 'Ada Kowalczyk' },
  { CrewRole: 'VistaGenomics', Activated: true, Enabled: true, CrewName: 'Lio Marchetti' },
  { CrewRole: 'BlackMarket', Activated: false },
  { CrewRole: 'Shipyard', Activated: false },
  { CrewRole: 'Outfitting', Activated: false },
  { CrewRole: 'Bartender', Activated: false },
  { CrewRole: 'PioneerSupplies', Activated: false },
  { CrewRole: 'VoucherRedemption', Activated: false },
];

const STATISTICS = {
  Bank_Account: {
    Current_Wealth: 2_904_118_230,
    Spent_On_Ships: 612_004_100,
    Spent_On_Outfitting: 804_221_900,
    Spent_On_Repairs: 4_120_400,
    Spent_On_Fuel: 182_300,
    Spent_On_Ammo_Consumables: 201_800,
    Insurance_Claims: 6,
    Spent_On_Insurance: 31_402_200,
    Owned_Ship_Count: 4,
  },
  Combat: {
    Bounties_Claimed: 212,
    Bounty_Hunting_Profit: 48_210_400,
    Combat_Bonds: 96,
    Combat_Bond_Profits: 9_810_200,
    Assassinations: 11,
    Assassination_Profits: 3_412_000,
    Highest_Single_Reward: 610_000,
    Skimmers_Killed: 4,
  },
  Crime: {
    Notoriety: 0,
    Fines: 9,
    Total_Fines: 21_400,
    Bounties_Received: 3,
    Total_Bounties: 1_200,
    Highest_Bounty: 600,
  },
  Trading: {
    Markets_Traded_With: 41,
    Market_Profits: 182_400_100,
    Resources_Traded: 61_204,
    Average_Profit: 412_800,
    Highest_Single_Transaction: 21_400_000,
  },
  Mining: { Mining_Profits: 61_210_400, Quantity_Mined: 1_820, Materials_Collected: 7_412 },
  Exploration: {
    Systems_Visited: 4_118,
    Exploration_Profits: 912_400_300,
    Planets_Scanned_To_Level_2: 8_204,
    Planets_Scanned_To_Level_3: 8_204,
    Efficient_Scans: 2_411,
    Highest_Payout: 41_200_400,
    Total_Hyperspace_Distance: 391_204,
    Total_Hyperspace_Jumps: 9_812,
    Greatest_Distance_From_Start: 24_118.4,
    Time_Played: 3_412_800,
  },
  Exobiology: {
    Organic_Genus_Encountered: 21,
    Organic_Species_Encountered: 88,
    Organic_Variant_Encountered: 214,
    Organic_Data_Profits: 1_812_400_100,
    Organic_Data: 612,
    First_Logged_Profits: 1_204_000_000,
    First_Logged: 188,
    Organic_Systems: 301,
    Organic_Planets: 412,
    Organic_Genus: 21,
    Organic_Species: 88,
  },
};
