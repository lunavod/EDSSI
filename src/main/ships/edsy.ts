/**
 * EDSY's database (`eddb.js` in github.com/taleden/EDSY) cut down to what the Ships tab needs:
 * every hull's slots under the journal's names, and every module's name, class and rating.
 *
 * The slot names follow EDSY's own journal export (`edsy.js`): a hull's `slotnames` where it has
 * them, which is where Frontier's numbering breaks the pattern, and the pattern everywhere else.
 */
import type {
  CatalogModule,
  CatalogShip,
  CatalogSlot,
  ShipCatalog,
  SlotGroup,
} from '../../shared/ships';
import { readJsAssignment } from './js-literal';

/** Where EDSY keeps its database. EDSY is CC BY-NC 4.0, by taleden. */
export const EDSY_DATABASE_URL = 'https://raw.githubusercontent.com/taleden/EDSY/master/eddb.js';

/** EDSY's `CORE_SLOT_FDNAME`: its core slots, in the order it lists their sizes. */
const CORE_SLOTS = [
  'Armour',
  'PowerPlant',
  'MainEngines',
  'FrameShiftDrive',
  'LifeSupport',
  'PowerDistributor',
  'Radar',
  'FuelTank',
];

const HARDPOINT_SIZES = ['Tiny', 'Small', 'Medium', 'Large', 'Huge'];

/** EDSY's slot groups, by the names the tab uses. */
const GROUPS: readonly (readonly [string, SlotGroup])[] = [
  ['hardpoint', 'hardpoint'],
  ['utility', 'utility'],
  ['component', 'core'],
  ['internal', 'internal'],
  ['military', 'military'],
];

/** Bulkheads aren't in EDSY's module list, only under each hull, and unnamed there. */
const ARMOUR_GRADES: Readonly<Record<string, string>> = {
  grade1: 'Lightweight Alloy',
  grade2: 'Reinforced Alloy',
  grade3: 'Military Grade Composite',
  mirrored: 'Mirrored Surface Composite',
  reactive: 'Reactive Surface Composite',
};

/** Fewer hulls than this means the file isn't what it used to be. */
const MIN_SHIPS = 30;

/** Reads EDSY's `eddb.js` as data (it is never run) and cuts it down. */
export function catalogFromEdsySource(source: string): ShipCatalog {
  return catalogFromEddb(readJsAssignment(source, 'eddb'));
}

export function catalogFromEddb(eddb: unknown): ShipCatalog {
  if (!isRecord(eddb)) throw new Error('EDSY database is not an object');
  const { ship, module, mtype, blueprint } = eddb;
  if (!isRecord(ship) || !isRecord(module)) throw new Error('EDSY database has no ships');
  const kinds = new Map<string, string>();
  if (isRecord(mtype)) {
    for (const [id, kind] of Object.entries(mtype)) {
      if (isRecord(kind) && typeof kind['name'] === 'string') kinds.set(id, kind['name']);
    }
  }

  const modules: Record<string, CatalogModule> = {};
  /** EDSY's module ids, which a hull's stock fit is written in, to the journal's item names. */
  const items = new Map<string, string>();
  for (const [id, entry] of Object.entries(module)) {
    const read = readModule(entry, kinds);
    if (!read) continue;
    modules[read.fdname] = read.module;
    items.set(id, read.fdname);
  }

  const blueprints: Record<string, string> = {};
  if (isRecord(blueprint)) {
    for (const entry of Object.values(blueprint)) {
      if (!isRecord(entry) || typeof entry['fdname'] !== 'string') continue;
      if (typeof entry['name'] !== 'string') continue;
      // A few are listed twice, for two kinds of module; the names agree.
      blueprints[entry['fdname'].toLowerCase()] ??= entry['name'];
    }
  }

  const ships: Record<string, CatalogShip> = {};
  for (const entry of Object.values(ship)) {
    if (!isRecord(entry) || typeof entry['fdname'] !== 'string') continue;
    const slots = readSlots(entry, kinds);
    if (!slots) continue;
    // Each hull's bulkheads, which only it lists, by the ids its stock fit uses.
    const own = new Map(items);
    if (isRecord(entry['module'])) {
      for (const [id, armour] of Object.entries(entry['module'])) {
        if (!isRecord(armour) || typeof armour['fdname'] !== 'string') continue;
        const fdname = armour['fdname'].toLowerCase();
        // Some hulls' stock bulkheads carry a suffix: `explorer_nx_armour_grade1_default`.
        const grade = ARMOUR_GRADES[/_armour_([a-z]+\d?)/.exec(fdname)?.[1] ?? ''];
        if (!grade) continue;
        const cost = armour['cost'];
        modules[fdname] = {
          name: grade,
          size: 1,
          rating: 'I',
          kind: 'Bulkheads',
          ...(typeof cost === 'number' && { cost }),
        };
        own.set(id, fdname);
      }
    }
    const { cost, retail } = entry;
    ships[entry['fdname'].toLowerCase()] = {
      name: typeof entry['name'] === 'string' ? entry['name'] : entry['fdname'],
      slots,
      stock: readStock(entry['stock'], slots, own),
      ...(typeof cost === 'number' && { hullCost: cost }),
      ...(typeof retail === 'number' && { retail }),
    };
  }
  if (Object.keys(ships).length < MIN_SHIPS) {
    throw new Error(`EDSY database lists only ${Object.keys(ships).length} ships`);
  }

  const version = typeof eddb['version'] === 'number' ? eddb['version'] : 0;
  const modified = readDate(eddb['edsy_lastmodified_db']);
  return { version, ...(modified !== undefined && { modified }), ships, modules, blueprints };
}

function readModule(
  entry: unknown,
  kinds: ReadonlyMap<string, string>,
): { fdname: string; module: CatalogModule } | undefined {
  if (!isRecord(entry)) return undefined;
  const { fdname, name, rating } = entry;
  const size = entry['class'];
  if (typeof fdname !== 'string' || typeof name !== 'string') return undefined;
  if (typeof size !== 'number' || typeof rating !== 'string') return undefined;
  const { mount, cost } = entry;
  const kind = typeof entry['mtype'] === 'string' ? kinds.get(entry['mtype']) : undefined;
  return {
    fdname: fdname.toLowerCase(),
    module: {
      name,
      size,
      rating,
      ...((mount === 'F' || mount === 'G' || mount === 'T') && { mount }),
      ...(kind !== undefined && { kind }),
      ...(typeof cost === 'number' && { cost }),
    },
  };
}

/**
 * A hull's stock fit, from EDSY's `stock`: a module id per slot, group by group in the same order
 * as its sizes, 0 for a slot sold empty.
 */
function readStock(
  stock: unknown,
  slots: readonly CatalogSlot[],
  items: ReadonlyMap<string, string>,
): Record<string, string> {
  const result: Record<string, string> = {};
  if (!isRecord(stock)) return result;
  for (const [edsyGroup, group] of GROUPS) {
    const ids = stock[edsyGroup];
    if (!Array.isArray(ids)) continue;
    const inGroup = slots.filter((slot) => slot.group === group);
    for (const [index, id] of ids.entries()) {
      const slot = inGroup[index];
      const item = typeof id === 'number' && id !== 0 ? items.get(String(id)) : undefined;
      if (slot && item) result[slot.name] = item;
    }
  }
  return result;
}

function readSlots(
  ship: Record<string, unknown>,
  kinds: ReadonlyMap<string, string>,
): CatalogSlot[] | undefined {
  const { slots, slotnames, reserved } = ship;
  if (!isRecord(slots)) return undefined;
  const result: CatalogSlot[] = [];
  for (const [edsyGroup, group] of GROUPS) {
    const sizes = slots[edsyGroup];
    if (!Array.isArray(sizes)) {
      // A hull without a group's key has none of it; one without core slots isn't a hull.
      if (edsyGroup === 'component' || edsyGroup === 'internal') return undefined;
      continue;
    }
    const names = isRecord(slotnames) ? slotnames[edsyGroup] : undefined;
    const limits = isRecord(reserved) ? reserved[edsyGroup] : undefined;
    for (const [index, size] of sizes.entries()) {
      if (typeof size !== 'number') return undefined;
      const given = Array.isArray(names) ? names[index] : undefined;
      const name = typeof given === 'string' ? given : slotName(edsyGroup, index, size, sizes);
      if (name === undefined) return undefined;
      const only = Array.isArray(limits) ? restriction(limits[index], kinds) : undefined;
      result.push({ name, group, size, ...(only && { only }) });
    }
  }
  return result;
}

/** The journal's name for a slot, as EDSY's export makes it. */
function slotName(
  group: string,
  index: number,
  size: number,
  sizes: readonly unknown[],
): string | undefined {
  const number = String(index + 1).padStart(2, '0');
  switch (group) {
    case 'hardpoint': {
      // Numbered within their size: the second large one is LargeHardpoint2.
      const n = sizes.slice(0, index + 1).filter((other) => other === size).length;
      return `${HARDPOINT_SIZES[size] ?? 'Unknown'}Hardpoint${n}`;
    }
    case 'utility':
      return `TinyHardpoint${index + 1}`;
    case 'component':
      return CORE_SLOTS[index];
    case 'military':
      return `Military${number}`;
    case 'internal':
      return `Slot${number}_Size${size}`;
    default:
      return undefined;
  }
}

function restriction(limit: unknown, kinds: ReadonlyMap<string, string>): string[] | undefined {
  if (!isRecord(limit)) return undefined;
  const names = Object.keys(limit).map((id) => kinds.get(id) ?? id);
  return names.length > 0 ? names : undefined;
}

function readDate(value: unknown): string | undefined {
  if (typeof value !== 'number') return undefined;
  const match = /^(\d{4})(\d{2})(\d{2})$/.exec(String(value));
  return match ? `${match[1]}-${match[2]}-${match[3]}` : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
