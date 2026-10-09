/**
 * A ship slot by slot: EDSY's slot table for the hull with the journal's `Loadout` fitted into it,
 * so the empty slots show too. For a hull EDSY doesn't list (a ship newer than its database, or no
 * database yet) the slots are the ones the journal has ever shown filled on that ship. A hull the
 * journal has no loadout for can be shown as the shipyard sells it (`stockFit`).
 */
import type { LoadoutEvent } from '../../shared/journal';
import type { FittedModule, ShipCatalog, SlotGroup, SlotView, StockFit } from '../../shared/ships';
import { SLOT_GROUPS } from '../../shared/ships';

type LoadoutModule = LoadoutEvent['Modules'][number];

/** A slot the journal has shown filled, and with what. */
export interface SeenSlot {
  slot: string;
  item: string;
}

/** Slots that are paint, voice or furniture rather than somewhere to fit a module. */
const COSMETIC_SLOT =
  /^(?:PaintJob|Decal\d*|ShipCockpit|CargoHatch|VesselVoice|PlanetaryApproachSuite|ShipName\d*|ShipID\d*|Bobble\d*|EngineColour|WeaponColour|StringLights|ShipKit\w*|Nameplate\w*|\w*Scanner)$/i;

const CORE_SLOTS = [
  'armour',
  'powerplant',
  'mainengines',
  'frameshiftdrive',
  'lifesupport',
  'powerdistributor',
  'radar',
  'fueltank',
];

const HARDPOINT_SIZES = ['tiny', 'small', 'medium', 'large', 'huge'];

const MOUNTS: Readonly<Record<string, string>> = { F: 'Fixed', G: 'Gimballed', T: 'Turreted' };

export function isCosmeticSlot(slot: string): boolean {
  return COSMETIC_SLOT.test(slot);
}

export function shipSlots(
  ship: string,
  loadout: LoadoutEvent | undefined,
  seen: ReadonlyMap<string, SeenSlot>,
  catalog: ShipCatalog | undefined,
): { layout: 'edsy' | 'journal'; slots: SlotView[] } {
  const fitted = new Map<string, LoadoutModule>();
  for (const module of loadout?.Modules ?? []) {
    if (!isCosmeticSlot(module.Slot)) fitted.set(module.Slot.toLowerCase(), module);
  }
  const hull = catalog?.ships[ship.toLowerCase()];

  if (hull) {
    const slots: SlotView[] = hull.slots.map((slot) => {
      const key = slot.name.toLowerCase();
      const module = fitted.get(key);
      fitted.delete(key);
      const only = slot.only && describeRestriction(slot.only);
      // As sold: the stock item, and not engineered since.
      const stock =
        module !== undefined &&
        !module.Engineering &&
        hull.stock[slot.name] === module.Item.toLowerCase();
      return {
        slot: slot.name,
        group: slot.group,
        size: slot.size,
        ...(module && { module: fittedModule(module, catalog) }),
        ...(only && { only }),
        ...(stock && { stock }),
      };
    });
    // Fitted where EDSY says the hull has no slot: its table is wrong, or the game changed.
    for (const module of fitted.values()) {
      slots.push({
        ...guessSlot(module.Slot, module.Item),
        module: fittedModule(module, catalog),
        unlisted: true,
      });
    }
    return { layout: 'edsy', slots: sortSlots(slots, false) };
  }

  const slots: SlotView[] = [];
  for (const module of fitted.values()) {
    slots.push({ ...guessSlot(module.Slot, module.Item), module: fittedModule(module, catalog) });
  }
  for (const [key, was] of seen) {
    if (!fitted.has(key) && !isCosmeticSlot(was.slot)) slots.push(guessSlot(was.slot, was.item));
  }
  return { layout: 'journal', slots: sortSlots(slots, true) };
}

/** `ship` as the shipyard sells it, from EDSY; undefined for a hull EDSY doesn't list. */
export function stockFit(ship: string, catalog: ShipCatalog | undefined): StockFit | undefined {
  const key = ship.toLowerCase();
  const hull = catalog?.ships[key];
  if (!catalog || !hull) return undefined;
  const slots = hull.slots.map((slot): SlotView => {
    const item = hull.stock[slot.name];
    const only = slot.only && describeRestriction(slot.only);
    return {
      slot: slot.name,
      group: slot.group,
      size: slot.size,
      ...(item !== undefined && { module: catalogModule(item, catalog), stock: true }),
      ...(only && { only }),
    };
  });
  return {
    ship: key,
    type: hull.name,
    slots,
    prices: {
      ...(hull.hullCost !== undefined && { hull: hull.hullCost }),
      ...(hull.retail !== undefined && { retail: hull.retail }),
    },
  };
}

/** A module as outfitting sells it: new, on, and at its list price. */
function catalogModule(item: string, catalog: ShipCatalog): FittedModule {
  const known = catalog.modules[item];
  return {
    item,
    name: known?.name ?? itemName(item),
    ...(known && known.kind !== 'Bulkheads' && { grade: `${known.size}${known.rating}` }),
    ...(known?.mount !== undefined && { mount: MOUNTS[known.mount] }),
    on: true,
    priority: 0,
    health: 1,
    ...(known?.cost !== undefined && { value: known.cost }),
  };
}

export function fittedModule(
  module: LoadoutModule,
  catalog: ShipCatalog | undefined,
): FittedModule {
  const item = module.Item.toLowerCase();
  const known = catalog?.modules[item];
  const engineering = module.Engineering;
  const blueprint = engineering?.BlueprintName;
  const experimental = engineering?.ExperimentalEffect_Localised ?? engineering?.ExperimentalEffect;
  return {
    item,
    name: known?.name ?? itemName(item),
    ...(known && known.kind !== 'Bulkheads' && { grade: `${known.size}${known.rating}` }),
    ...(known?.mount !== undefined && { mount: MOUNTS[known.mount] }),
    on: module.On,
    priority: module.Priority,
    health: module.Health,
    ...(module.Value !== undefined && { value: module.Value }),
    ...(engineering &&
      blueprint !== undefined && {
        engineering: {
          blueprint: catalog?.blueprints[blueprint.toLowerCase()] ?? blueprintName(blueprint),
          level: engineering.Level,
          quality: engineering.Quality,
          ...(engineering.Engineer !== undefined && { engineer: engineering.Engineer }),
          ...(experimental !== undefined && { experimental }),
        },
      }),
  };
}

/** "Cargo racks or fuel tanks": what a restricted slot takes. */
export function describeRestriction(kinds: readonly string[]): string | undefined {
  if (kinds.length === 0) return undefined;
  if (kinds.every((kind) => kind.endsWith(' Limpets'))) return 'Limpet controllers';
  if (kinds.every((kind) => kind.startsWith('Mining Tools'))) return 'Mining tools';
  const names = kinds.map((kind) => kind.replace(/^Exp - /, ''));
  const text =
    names.length === 1
      ? names.join('')
      : names.length <= 3
        ? `${names.slice(0, -1).join(', ')} or ${names.at(-1)}`
        : `${names.slice(0, 2).join(', ')} and ${names.length - 2} more`;
  // EDSY's names are title case; keep only acronyms such as FSD capitalised, and the first word.
  return upperFirst(
    text.replace(/[A-Za-z][\w-]*/g, (word) =>
      /^[A-Z]{2,}/.test(word) ? word : word.toLowerCase(),
    ),
  );
}

/** The group and size of a slot EDSY doesn't list, from its name and what was fitted in it. */
function guessSlot(slot: string, item: string): SlotView {
  const hardpoint = /^(tiny|small|medium|large|huge)\w*hardpoint\d+$/i.exec(slot);
  if (hardpoint?.[1]) {
    const size = HARDPOINT_SIZES.indexOf(hardpoint[1].toLowerCase());
    return size === 0 ? { slot, group: 'utility', size: 0 } : { slot, group: 'hardpoint', size };
  }
  const size = sizeOf(slot, item);
  const group: SlotGroup = CORE_SLOTS.includes(slot.toLowerCase())
    ? 'core'
    : /^military\d+$/i.test(slot)
      ? 'military'
      : 'internal';
  return { slot, group, ...(size !== undefined && { size }) };
}

function sizeOf(slot: string, item: string): number | undefined {
  const match = /_size(\d+)$/i.exec(slot) ?? /_size(\d+)/i.exec(item);
  return match?.[1] === undefined ? undefined : Number(match[1]);
}

/**
 * Groups in the tab's order. EDSY's own order within a group is the hull's; the journal's only
 * fallback has none, so its slots go biggest first, then by name.
 */
function sortSlots(slots: SlotView[], bySize: boolean): SlotView[] {
  const indexed = slots.map((slot, index) => ({ slot, index }));
  indexed.sort((a, b) => {
    const group = SLOT_GROUPS.indexOf(a.slot.group) - SLOT_GROUPS.indexOf(b.slot.group);
    if (group !== 0) return group;
    if (!bySize) return a.index - b.index;
    if (a.slot.group === 'core') {
      return (
        CORE_SLOTS.indexOf(a.slot.slot.toLowerCase()) -
        CORE_SLOTS.indexOf(b.slot.slot.toLowerCase())
      );
    }
    return (
      (b.slot.size ?? 0) - (a.slot.size ?? 0) ||
      a.slot.slot.localeCompare(b.slot.slot, 'en', { numeric: true })
    );
  });
  return indexed.map(({ slot }) => slot);
}

/** `int_shieldgenerator_size7_class2_fast` → "Shieldgenerator Fast", for a module EDSY lacks. */
export function itemName(item: string): string {
  const words = item
    .replace(/^(?:int|hpt)_/, '')
    .split('_')
    .filter((word) => !/^(?:size|class)\d+$/.test(word) && word !== '');
  return words.map(upperFirst).join(' ') || item;
}

/** `FSD_LongRange` → "Long Range", for a blueprint EDSY lacks. */
function blueprintName(blueprint: string): string {
  return (
    blueprint
      .split('_')
      .slice(1)
      .join(' ')
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .trim() || blueprint
  );
}

function upperFirst(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
