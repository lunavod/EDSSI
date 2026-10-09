/**
 * Blueprints out of a ship build from EDSY or Coriolis, for the blueprint to-do list. Both export
 * SLEF (the journal's `Loadout`, wrapped in a header; Inara's fleet export is a list of them), and
 * Coriolis its own "detailed build" too. Every engineered module becomes a blueprint to apply, less
 * what the commander's own ship of that type already has.
 */

import {
  type Blueprint,
  blueprintByKey,
  blueprintsFor,
  type BlueprintTodo,
  maxGrade,
} from './crafting';
import { RECIPES } from './materials';

/** One engineered module of a build, as the journal names things. */
export interface BuildModule {
  /** The journal's slot, where the build names it (`LargeHardpoint1`). */
  slot?: string;
  /** The module as the recipes group blueprints: `Frame Shift Drive`, `Pulse Laser`… */
  module: string;
  /** `BlueprintName`, e.g. `FSD_LongRange`. */
  blueprint: string;
  grade: number;
  /** `special_fsd_heavy`. */
  experimental?: string;
}

export interface ParsedBuild {
  /** The journal's ship name, lowercase, when the build says: `anaconda`. */
  ship?: string;
  /** The build's own name. */
  name?: string;
  modules: BuildModule[];
}

/** A module of a ship the commander owns, from its last `Loadout`. */
export interface OwnedModule {
  slot: string;
  item: string;
  blueprint?: string;
  level?: number;
  experimental?: string;
}

export interface OwnedShip {
  shipId: number;
  /** Lowercase, as `ParsedBuild.ship`. */
  ship: string;
  name?: string;
  current: boolean;
  modules: OwnedModule[];
}

/** A blueprint the build wants, ready to go on the list. */
export interface PlannedBlueprint {
  todo: Omit<BlueprintTodo, 'id'>;
  /** "Increased FSD Range · Frame Shift Drive". */
  label: string;
  /** Where it goes, where the build says. */
  slots: string[];
  /** What the commander's ship has there already, when it has some of it. */
  fitted?: string;
  /** Nothing left to do: the commander's ship has it already. */
  done: boolean;
}

export interface PlannedBuild {
  title: string;
  /** The commander's ship the grades were compared with. */
  comparedWith?: string;
  planned: PlannedBlueprint[];
  /** Modules EDSSI couldn't place, and why. */
  skipped: string[];
}

/** Journal item names (lowercase) to the module their blueprints are listed under; first wins. */
const ITEM_MODULES: readonly [RegExp, string][] = [
  [/_armour_/, 'Armour'],
  [/^int_repairer/, 'Auto Field-Maintenance Unit'],
  [/^hpt_beamlaser/, 'Beam Laser'],
  [/^hpt_pulselaserburst/, 'Burst Laser'],
  [/^hpt_pulselaser/, 'Pulse Laser'],
  [/^hpt_cannon/, 'Cannon'],
  [/^hpt_chafflauncher/, 'Chaff Launcher'],
  [/^int_dronecontrol_collection/, 'Collector Limpet Controller'],
  [/^hpt_electroniccountermeasure/, 'Electronic Countermeasure'],
  [/^hpt_slugshot/, 'Fragment Cannon'],
  [/^int_hyperdrive/, 'Frame Shift Drive'],
  [/^int_fsdinterdictor/, 'Frame Shift Drive Interdictor'],
  [/^int_fuelscoop/, 'Fuel Scoop'],
  [/^int_dronecontrol_fueltransfer/, 'Fuel Transfer Limpet Controller'],
  [/^int_dronecontrol_resourcesiphon/, 'Hatch Breaker Limpet Controller'],
  [/^hpt_heatsinklauncher/, 'Heat Sink Launcher'],
  [/^int_hullreinforcement/, 'Hull Reinforcement Package'],
  [/^hpt_crimescanner/, 'Kill Warrant Scanner'],
  [/^int_lifesupport/, 'Life Support'],
  [/^hpt_cargoscanner/, 'Manifest Scanner'],
  [/^hpt_(basic|dumbfire|drunk|atdumbfire)missilerack/, 'Missile Rack'],
  [/^hpt_(atmulticannon|multicannon)/, 'Multi-Cannon'],
  [/^hpt_plasmaaccelerator/, 'Plasma Accelerator'],
  [/^hpt_plasmapointdefence/, 'Point Defence'],
  [/^int_powerdistributor/, 'Power Distributor'],
  [/^int_powerplant/, 'Power Plant'],
  [/^int_dronecontrol_prospector/, 'Prospector Limpet Controller'],
  [/^hpt_railgun/, 'Rail Gun'],
  [/^int_refinery/, 'Refinery'],
  [/^int_sensors/, 'Sensors'],
  [/^hpt_shieldbooster/, 'Shield Booster'],
  [/^int_shieldcellbank/, 'Shield Cell Bank'],
  [/^int_shieldgenerator/, 'Shield Generator'],
  [/^int_detailedsurfacescanner/, 'Surface Scanner'],
  [/^int_engine/, 'Thrusters'],
  [/^hpt_advancedtorppylon/, 'Torpedo Pylon'],
  [/^hpt_cloudscanner/, 'Wake Scanner'],
  [/^hpt_minelauncher/, 'Mine Launcher'],
];

/** The module a journal item is, by its blueprints' grouping; undefined for one with none. */
export function moduleForItem(item: string): string | undefined {
  const lower = item.toLowerCase();
  return ITEM_MODULES.find(([pattern]) => pattern.test(lower))?.[1];
}

/** Coriolis' standard slots, by its key. */
const CORIOLIS_STANDARD: Readonly<Record<string, string>> = {
  bulkheads: 'Armour',
  powerPlant: 'Power Plant',
  thrusters: 'Thrusters',
  frameShiftDrive: 'Frame Shift Drive',
  lifeSupport: 'Life Support',
  powerDistributor: 'Power Distributor',
  sensors: 'Sensors',
};

/** Coriolis' group names where they aren't the recipes'. */
const CORIOLIS_GROUPS: Readonly<Record<string, string>> = {
  'cargo scanner': 'Manifest Scanner',
  'frame shift wake scanner': 'Wake Scanner',
  'detailed surface scanner': 'Surface Scanner',
  'seeker missile rack': 'Missile Rack',
  'fsd interdictor': 'Frame Shift Drive Interdictor',
  'auto field maintenance unit': 'Auto Field-Maintenance Unit',
  'electronic counter measure': 'Electronic Countermeasure',
  'point defence turret': 'Point Defence',
  'hatch breaker limpet controller': 'Hatch Breaker Limpet Controller',
  railgun: 'Rail Gun',
};

function coriolisModule(group: string): string {
  const lower = group.toLowerCase().replace(/-/g, ' ');
  return CORIOLIS_GROUPS[lower] ?? group;
}

function field(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? Reflect.get(value, key)
    : undefined;
}

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? value : undefined;

/**
 * The builds in an export, whichever of the shapes it is: SLEF (one or a list), a journal
 * `Loadout`, or Coriolis' detailed build. Empty when it is none of them.
 */
export function readBuilds(json: unknown): ParsedBuild[] {
  if (Array.isArray(json)) return json.flatMap((entry) => readBuilds(entry));
  const data = field(json, 'data');
  if (field(json, 'header') !== undefined && data !== undefined) return readBuilds(data);
  if (Array.isArray(field(json, 'Modules'))) return [readLoadout(json)];
  if (field(json, 'components') !== undefined) return [readCoriolis(json)];
  return [];
}

function readLoadout(loadout: unknown): ParsedBuild {
  const modules: BuildModule[] = [];
  const entries = field(loadout, 'Modules');
  for (const entry of Array.isArray(entries) ? entries : []) {
    const engineering = field(entry, 'Engineering');
    const blueprint = text(field(engineering, 'BlueprintName'));
    const grade = Number(field(engineering, 'Level'));
    const item = text(field(entry, 'Item'));
    if (!blueprint || !item || !(grade >= 1)) continue;
    const experimental = text(field(engineering, 'ExperimentalEffect'));
    const slot = text(field(entry, 'Slot'));
    modules.push({
      ...(slot && { slot }),
      module: moduleForItem(item) ?? item,
      blueprint,
      grade,
      ...(experimental && { experimental }),
    });
  }
  const ship = text(field(loadout, 'Ship'));
  const name = text(field(loadout, 'ShipName'));
  return { ...(ship && { ship: ship.toLowerCase() }), ...(name && { name }), modules };
}

function readCoriolis(build: unknown): ParsedBuild {
  const components = field(build, 'components');
  const modules: BuildModule[] = [];
  const add = (entry: unknown, module: string | undefined, slot: string) => {
    const blueprint = field(entry, 'blueprint');
    const name = text(field(blueprint, 'fdname'));
    const grade = Number(field(blueprint, 'grade'));
    if (!module || !name || !(grade >= 1)) return;
    const experimental = text(field(field(blueprint, 'special'), 'edname'));
    modules.push({ slot, module, blueprint: name, grade, ...(experimental && { experimental }) });
  };
  const standard = field(components, 'standard');
  for (const [key, module] of Object.entries(CORIOLIS_STANDARD)) {
    add(field(standard, key), module, key);
  }
  for (const group of ['hardpoints', 'utility', 'internal']) {
    const entries = field(components, group);
    if (!Array.isArray(entries)) continue;
    entries.forEach((entry: unknown, index) => {
      const name = text(field(entry, 'group'));
      add(entry, name && coriolisModule(name), `${group} ${index + 1}`);
    });
  }
  const ship = text(field(build, 'ship'));
  const name = text(field(build, 'name'));
  return {
    ...(ship && { ship: ship.toLowerCase().replace(/[^a-z0-9]+/g, '_') }),
    ...(name && { name }),
    modules,
  };
}

/** The blueprint a module's engineering is, or why there isn't one. */
/**
 * A module's blueprint by the name a build gives it. Coriolis names the generic ones after the
 * module (`LifeSupport_LightWeight`, `AFM_Shielded`, `CollectionLimpet_Reinforced`) where
 * EDDiscovery and EDSY have `misc_lightweight` and the like, and the scanners' `Scanner_LongRange`
 * where they have `sensor_longrange`; so a name the module doesn't have is tried as `misc_` and what
 * follows the module's prefix, and a scanner's as `sensor_`.
 */
function moduleBlueprint(module: string, name: string): Blueprint | undefined {
  const fdName = name.toLowerCase();
  const blueprints = blueprintsFor(module);
  const rest = fdName.replace(/^[^_]+_/, '');
  const names = [
    fdName,
    `misc_${rest}`,
    ...(fdName.startsWith('scanner_') ? [`sensor_${rest}`] : []),
  ];
  for (const name of names) {
    const found = blueprints.find((blueprint) => blueprint.fdName === name);
    if (found) return found;
  }
  return undefined;
}

function blueprintFor(module: BuildModule): Blueprint | string {
  const fdName = module.blueprint.toLowerCase();
  const exact = moduleBlueprint(module.module, module.blueprint);
  if (exact) return exact;
  const named = RECIPES.filter(
    (recipe) => recipe.kind === 'engineering' && recipe.fdName === fdName,
  );
  const keys = new Set(named.map((recipe) => recipe.id.replace(/:\d+$/, '')));
  if (keys.size === 1) {
    const only = blueprintByKey([...keys][0]!);
    if (only) return only;
  }
  return named.length === 0
    ? `${module.blueprint} on the ${module.module}: no such blueprint in EDSSI's tables`
    : `${module.blueprint}: couldn't tell which module it's for (${module.module})`;
}

function experimentalId(module: BuildModule, blueprint: Blueprint): string | undefined {
  const fdName = module.experimental?.toLowerCase();
  if (!fdName) return undefined;
  return RECIPES.find(
    (recipe) =>
      recipe.kind === 'experimental' &&
      recipe.fdName === fdName &&
      recipe.group.split(', ').includes(blueprint.module),
  )?.id;
}

/** The ship of the build's type to compare with: the one flown, else the last seen. */
export function shipToCompare(
  build: ParsedBuild,
  owned: readonly OwnedShip[],
): OwnedShip | undefined {
  const hull = build.ship && hullKey(build.ship);
  const same = owned.filter((ship) => hull !== undefined && hullKey(ship.ship) === hull);
  return same.find((ship) => ship.current) ?? same.at(-1);
}

/**
 * What a build asks for, as blueprint to-dos: one per blueprint and grade range, counting the
 * modules that take it. Grades `ship` already has on a module in that slot (or, failing that, the
 * same kind of module with the same blueprint) are left off, and so is an experimental it has.
 */
export function planBuild(
  build: ParsedBuild,
  ship: OwnedShip | undefined,
  /** At the target grade: a number, or as many as maxing it takes at the engineer's rank. */
  rolls: number | 'max',
  /** The hull's name, e.g. from EDSY: "Panther Clipper Mk II". */
  hullName: (ship: string) => string | undefined = () => undefined,
): PlannedBuild {
  const skipped: string[] = [];
  const unused = [...(ship?.modules ?? [])];
  const take = (module: BuildModule): OwnedModule | undefined => {
    const bySlot = unused.findIndex(
      (owned) =>
        module.slot !== undefined &&
        owned.slot.toLowerCase() === module.slot.toLowerCase() &&
        moduleForItem(owned.item) === module.module,
    );
    const byKind =
      bySlot >= 0
        ? bySlot
        : unused.findIndex(
            (owned) =>
              moduleForItem(owned.item) === module.module &&
              owned.blueprint !== undefined &&
              moduleBlueprint(module.module, owned.blueprint)?.key ===
                moduleBlueprint(module.module, module.blueprint)?.key,
          );
    return byKind >= 0 ? unused.splice(byKind, 1)[0] : undefined;
  };

  const planned: PlannedBlueprint[] = [];
  for (const module of build.modules) {
    const blueprint = blueprintFor(module);
    if (typeof blueprint === 'string') {
      skipped.push(blueprint);
      continue;
    }
    const to = Math.min(module.grade, maxGrade(blueprint));
    const owned = take(module);
    const sameBlueprint =
      owned?.blueprint !== undefined &&
      moduleBlueprint(blueprint.module, owned.blueprint)?.key === blueprint.key;
    const from = sameBlueprint ? Math.min(owned?.level ?? 0, to) : 0;
    let experimental = experimentalId(module, blueprint);
    if (module.experimental && !experimental) {
      skipped.push(
        `${module.experimental} on the ${blueprint.module}: no such experimental effect`,
      );
    }
    if (experimental && owned?.experimental?.toLowerCase() === module.experimental?.toLowerCase()) {
      experimental = undefined;
    }
    const done = from >= to && experimental === undefined;
    const todo: Omit<BlueprintTodo, 'id'> = {
      kind: 'blueprint',
      blueprint: blueprint.key,
      from: done ? Math.max(0, to - 1) : Math.min(from, to - 1),
      to,
      ...(rolls !== 'max' && { targetRolls: rolls }),
      ...(experimental && { experimental }),
      // A module already at the grade still needs its experimental: nothing to roll, only that.
      ...(from >= to && experimental !== undefined && { onlyExperimental: true }),
    };
    const fitted =
      owned?.blueprint && owned.level
        ? `${sameBlueprint ? 'G' + owned.level : `another blueprint, G${owned.level}`}${owned.experimental ? ` + ${experimentalName(owned.experimental)}` : ''}`
        : undefined;
    const same = planned.find(
      (known) =>
        known.done === done &&
        known.todo.blueprint === todo.blueprint &&
        known.todo.from === todo.from &&
        known.todo.to === todo.to &&
        known.todo.experimental === todo.experimental &&
        known.todo.onlyExperimental === todo.onlyExperimental,
    );
    if (same) {
      same.todo.count = (same.todo.count ?? 1) + 1;
      if (module.slot) same.slots.push(module.slot);
      continue;
    }
    planned.push({
      todo,
      label: `${blueprint.name} · ${blueprint.module}`,
      slots: module.slot ? [module.slot] : [],
      ...(fitted && { fitted }),
      done,
    });
  }
  const hull = (name: string) => hullName(name) ?? shipName(name);
  const title = [build.name, build.ship && hull(build.ship)].filter(Boolean).join(' · ');
  return {
    title: title || 'Build',
    ...(ship && {
      comparedWith: ship.name ? `${ship.name} (${hull(ship.ship)})` : hull(ship.ship),
    }),
    planned,
    skipped,
  };
}

/** An experimental effect's name from its journal name: `special_fsd_heavy` is "Mass Manager". */
function experimentalName(fdName: string): string {
  const lower = fdName.toLowerCase();
  return (
    RECIPES.find((recipe) => recipe.kind === 'experimental' && recipe.fdName === lower)?.name ??
    fdName
  );
}

/** A hull's name to compare: Coriolis' `krait_mk_ii` and the journal's `krait_mkii` alike. */
export function hullKey(ship: string): string {
  return ship.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** `krait_mkii` as "Krait Mkii": good enough to recognise a hull by. */
function shipName(ship: string): string {
  return ship
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
