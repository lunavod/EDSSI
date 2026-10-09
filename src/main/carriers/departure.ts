/**
 * A minute's warning before the commander's own carrier jumps while they're docked on it. Only
 * the owner's journal says when a carrier leaves (`CarrierJumpRequest`'s `DepartureTime`); a
 * carrier someone else owns jumps with no word beforehand, so it can't be warned about.
 */

import type { JournalEvent } from '../../shared/journal';
import { dockedCarrierJump, type Overview, updateOverview } from '../../shared/overview';

/** How long before departure the warning comes. */
export const WARNING_MS = 60_000;
/** Closer to departure than this, "in one minute" would be wrong, so the line says so. */
const LATE_MS = 45_000;

export class CarrierDeparture {
  private overview: Overview = {};
  /** Game closed: whatever it last said about docking no longer holds. */
  private offline = false;
  /** The departure already warned about (or passed over), so each is said once. */
  private warned: number | undefined;

  handle(event: JournalEvent): void {
    this.overview = updateOverview(this.overview, event);
    if (event.event === 'Shutdown') this.offline = true;
    else if (event.event === 'LoadGame' || event.event === 'Location') this.offline = false;
  }

  /** When the warning is due, in ms since the epoch; undefined with nothing to warn about. */
  warnAt(): number | undefined {
    const jump = this.overview.carrierJump;
    return jump && jump.departs !== this.warned ? jump.departs - WARNING_MS : undefined;
  }

  /**
   * The line to say at `now`, if the warning is due, the carrier hasn't left yet and the commander
   * is docked on it. Each jump is warned about once, docked or not when the time comes.
   */
  due(now: number): string | undefined {
    const jump = this.overview.carrierJump;
    if (!jump || jump.departs === this.warned || now < jump.departs - WARNING_MS) return undefined;
    this.warned = jump.departs;
    const left = jump.departs - now;
    if (left <= 0 || this.offline || !dockedCarrierJump(this.overview)) return undefined;
    return departureLine(jump.system, left);
  }
}

export function departureLine(system: string | undefined, leftMs: number): string {
  const when = leftMs < LATE_MS ? 'in under a minute' : 'in one minute';
  return system ? `Carrier jumps ${when}, to ${system}.` : `Carrier jumps ${when}.`;
}
