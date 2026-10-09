import type { JournalEvent } from '../../shared/journal';
import type { Coords } from './client';

/** What a Spansh search measures its distances from: a named system, or a point. */
export type Reference = { reference_system: string } | { reference_coords: Coords };

/** Where the commander last arrived, from the journal. */
export interface Position {
  system: string;
  coords: Coords;
}

/** Where a jump or a `Location` put the commander; undefined for any other event. */
export function positionOf(event: JournalEvent): Position | undefined {
  if (event.event !== 'FSDJump' && event.event !== 'CarrierJump' && event.event !== 'Location') {
    return undefined;
  }
  const [x, y, z] = Array.isArray(event.StarPos) ? event.StarPos : [];
  if (
    typeof event.StarSystem !== 'string' ||
    typeof x !== 'number' ||
    typeof y !== 'number' ||
    typeof z !== 'number'
  ) {
    return undefined;
  }
  return { system: event.StarSystem, coords: { x, y, z } };
}

/**
 * Where to search around: the system named, else the commander's own coordinates (so a system
 * Spansh doesn't know still works), else the name of the system they're in.
 */
export function referenceFor(
  near: string,
  here: string | undefined,
  position: Position | undefined,
): { reference: Reference; label: string } {
  const named = near.trim();
  const atHere = named === '' || (here !== undefined && named.toLowerCase() === here.toLowerCase());
  if (!atHere) return { reference: { reference_system: named }, label: named };
  if (position && (here === undefined || position.system === here)) {
    return { reference: { reference_coords: position.coords }, label: position.system };
  }
  if (here) return { reference: { reference_system: here }, label: here };
  throw new Error("Where you are isn't known yet; name a system to search around.");
}
