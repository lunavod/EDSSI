import type { StatusEvent } from '../../../shared/journal';

/** Status.json flag 21: the ship, SRV or commander is on or near a planet's surface. */
const HAS_LAT_LONG = 1 << 21;

/** The body the commander is on or near, while near enough to its surface for the game to say. */
export function nearBody(status: StatusEvent | undefined): string | undefined {
  return status !== undefined && (status.Flags & HAS_LAT_LONG) !== 0 ? status.BodyName : undefined;
}
