/** The Ships tab's formatting: slot sizes, module names and what's free. */
import type { SlotGroup, SlotView, ShipView } from '../../../shared/ships';

export const GROUP_TITLES: Readonly<Record<SlotGroup, string>> = {
  hardpoint: 'Hardpoints',
  utility: 'Utility mounts',
  core: 'Core internals',
  internal: 'Optional internals',
  military: 'Military',
};

const HARDPOINT_SIZES = ['U', 'S', 'M', 'L', 'H'];
const HARDPOINT_SIZE_NAMES = ['Utility', 'Small', 'Medium', 'Large', 'Huge'];

/** The slot's size as the outfitting screen marks it: S/M/L/H for hardpoints, a class otherwise. */
export function sizeLabel(slot: SlotView): string | undefined {
  if (slot.size === undefined) return undefined;
  if (slot.group === 'hardpoint' || slot.group === 'utility') return HARDPOINT_SIZES[slot.size];
  // Every hull's bulkheads are class 1; the number says nothing.
  if (slot.slot.toLowerCase() === 'armour') return undefined;
  return String(slot.size);
}

export function sizeTitle(slot: SlotView): string | undefined {
  if (slot.size === undefined) return undefined;
  if (slot.group === 'hardpoint' || slot.group === 'utility') {
    return `${HARDPOINT_SIZE_NAMES[slot.size] ?? 'Unknown'} hardpoint`;
  }
  return `Class ${slot.size}`;
}

/** Slots that can be empty: every core slot is always filled. */
export function isOptional(slot: SlotView): boolean {
  return slot.group !== 'core';
}

export function freeSlots(ship: ShipView): SlotView[] {
  return ship.slots.filter((slot) => isOptional(slot) && !slot.module);
}

export function groupSlots(ship: ShipView): { group: SlotGroup; slots: SlotView[] }[] {
  const groups: { group: SlotGroup; slots: SlotView[] }[] = [];
  for (const slot of ship.slots) {
    const last = groups.at(-1);
    if (last?.group === slot.group) last.slots.push(slot);
    else groups.push({ group: slot.group, slots: [slot] });
  }
  return groups;
}

/** "Panther Clipper Mk II", or the commander's name for it. */
export function shipTitle(ship: ShipView): string {
  return ship.name?.trim() || ship.type;
}

/** The core slots by the outfitting screen's names rather than the journal's. */
const CORE_NAMES: Readonly<Record<string, string>> = {
  armour: 'Bulkheads',
  powerplant: 'Power plant',
  mainengines: 'Thrusters',
  frameshiftdrive: 'Frame shift drive',
  lifesupport: 'Life support',
  powerdistributor: 'Power distributor',
  radar: 'Sensors',
  fueltank: 'Fuel tank',
};

/** `LargeHardpoint2` → "Large hardpoint 2", `Slot03_Size6` → "Slot 3", `Radar` → "Sensors". */
export function slotLabel(slot: string): string {
  const core = CORE_NAMES[slot.toLowerCase()];
  if (core) return core;
  const internal = /^Slot0*(\d+)_Size\d+$/i.exec(slot);
  if (internal) return `Slot ${internal[1]}`;
  return slot
    .replace(/0*(\d+)$/, ' $1')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/ ([A-Z])/g, (_, char: string) => ` ${char.toLowerCase()}`);
}
