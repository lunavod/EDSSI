import { describe, expect, it } from 'vitest';

import type { JournalEvent } from '../../shared/journal';
import { CarrierDeparture, departureLine, WARNING_MS } from './departure';

// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test payloads, like parsed JSON.
const logged = (fields: Record<string, unknown>) => fields as unknown as JournalEvent;

const CARRIER = 3710725120;
const DEPARTS = Date.parse('2026-09-27T00:16:10Z');
const WARN = DEPARTS - WARNING_MS;

const docked = (marketId = CARRIER) => logged({ event: 'Docked', MarketID: marketId });
const undocked = logged({ event: 'Undocked', MarketID: CARRIER });
const request = logged({
  event: 'CarrierJumpRequest',
  CarrierID: CARRIER,
  SystemName: 'Scorpius Dark Region XJ-Z b2',
  DepartureTime: '2026-09-27T00:16:10Z',
});

function tracker(...events: JournalEvent[]) {
  const departure = new CarrierDeparture();
  for (const event of events) departure.handle(event);
  return departure;
}

describe('CarrierDeparture', () => {
  it('warns a minute before departure while docked on the carrier', () => {
    const departure = tracker(docked(), request);
    expect(departure.warnAt()).toBe(WARN);
    expect(departure.due(WARN - 1)).toBeUndefined();
    expect(departure.due(WARN)).toBe(
      'Carrier jumps in one minute, to Scorpius Dark Region XJ-Z b2.',
    );
    expect(departure.warnAt()).toBeUndefined();
    expect(departure.due(WARN + 1)).toBeUndefined();
  });

  it('counts a jump requested before docking', () => {
    expect(tracker(request, docked()).due(WARN)).toMatch(/in one minute/);
  });

  it('knows the ship is docked from Location and a carrier jump', () => {
    const location = logged({ event: 'Location', Docked: true, MarketID: CARRIER });
    expect(tracker(location, request).due(WARN)).toBeDefined();
    const other = logged({ event: 'CarrierJump', Docked: true, MarketID: 1234 });
    expect(tracker(request, other).due(WARN)).toBeUndefined();
  });

  it('stays quiet when undocked or docked elsewhere', () => {
    expect(tracker(docked(), request, undocked).due(WARN)).toBeUndefined();
    expect(tracker(docked(128016384), request).due(WARN)).toBeUndefined();
    expect(tracker(docked(), request, logged({ event: 'Shutdown' })).due(WARN)).toBeUndefined();
  });

  it('forgets a cancelled jump, and one the carrier has made', () => {
    const cancelled = logged({ event: 'CarrierJumpCancelled', CarrierID: CARRIER });
    expect(tracker(docked(), request, cancelled).warnAt()).toBeUndefined();
    const jumped = logged({ event: 'CarrierJump', Docked: true, MarketID: CARRIER });
    expect(tracker(docked(), request, jumped).warnAt()).toBeUndefined();
  });

  it('keeps a jump while aboard some other carrier as it jumps', () => {
    const other = logged({ event: 'CarrierJump', Docked: true, MarketID: 1234 });
    expect(tracker(request, other).warnAt()).toBe(WARN);
  });

  it('says so when started late, and nothing once the carrier has left', () => {
    expect(tracker(docked(), request).due(DEPARTS - 20_000)).toMatch(/in under a minute/);
    expect(tracker(docked(), request).due(DEPARTS)).toBeUndefined();
  });

  it('ignores a request with no departure time', () => {
    const old = logged({ event: 'CarrierJumpRequest', CarrierID: CARRIER, SystemName: 'Sol' });
    expect(tracker(docked(), old).warnAt()).toBeUndefined();
  });
});

describe('departureLine', () => {
  it('leaves out an unknown destination', () => {
    expect(departureLine(undefined, WARNING_MS)).toBe('Carrier jumps in one minute.');
  });
});
