import { describe, expect, it } from 'vitest';

import type { JournalEvent } from './journal';
import { currentShip, dockedCarrierJump, type Overview, updateOverview } from './overview';

// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test payloads, like parsed JSON.
const logged = (fields: Record<string, unknown>) => fields as unknown as JournalEvent;

const CARRIER = 3710725120;
const request = logged({
  event: 'CarrierJumpRequest',
  CarrierID: CARRIER,
  SystemName: 'Col 285 Sector GD-E b14-0',
  DepartureTime: '2026-09-26T23:31:10Z',
});
const docked = (marketId: number) =>
  logged({
    event: 'Docked',
    StationName: 'G9N-T7J',
    StationType: 'FleetCarrier',
    MarketID: marketId,
  });

const fold = (...events: JournalEvent[]) => events.reduce<Overview>(updateOverview, {});

describe('carrier jumps', () => {
  it('shows the jump while docked on that carrier', () => {
    expect(dockedCarrierJump(fold(docked(CARRIER), request))).toEqual({
      carrierId: String(CARRIER),
      system: 'Col 285 Sector GD-E b14-0',
      departs: Date.parse('2026-09-26T23:31:10Z'),
    });
  });

  it('keeps it while away, but shows it only on board', () => {
    const away = fold(request, docked(128016384));
    expect(away.carrierJump).toBeDefined();
    expect(dockedCarrierJump(away)).toBeUndefined();
    expect(dockedCarrierJump(fold(docked(CARRIER), request, logged({ event: 'Undocked' })))).toBe(
      undefined,
    );
  });

  it('drops it once cancelled or made', () => {
    const cancelled = logged({ event: 'CarrierJumpCancelled', CarrierID: CARRIER });
    expect(fold(request, cancelled).carrierJump).toBeUndefined();
    const jumped = logged({ event: 'CarrierJump', Docked: true, MarketID: CARRIER });
    expect(fold(docked(CARRIER), request, jumped).carrierJump).toBeUndefined();
    const other = logged({ event: 'CarrierJump', Docked: true, MarketID: 1234 });
    expect(fold(request, other).carrierJump).toBeDefined();
  });
});

describe('currentShip', () => {
  const loadout = (ship: string) => logged({ event: 'Loadout', Ship: ship, Modules: [] });
  const cargo = (vessel: string, count: number) =>
    logged({ event: 'Cargo', Vessel: vessel, Count: count });

  it('is the last loadout, with the ship hold rather than the SRV', () => {
    const ship = currentShip([
      loadout('anaconda'),
      cargo('Ship', 12),
      loadout('dolphin'),
      cargo('SRV', 2),
    ]);
    expect(ship?.loadout.Ship).toBe('dolphin');
    expect(ship?.cargo).toBe(12);
  });

  it('is nothing before a loadout, and an empty hold before any cargo', () => {
    expect(currentShip([cargo('Ship', 4)])).toBeUndefined();
    expect(currentShip([loadout('dolphin')])?.cargo).toBe(0);
  });
});
