import { describe, expect, it } from 'vitest';

import type { JournalEvent } from '../../../shared/journal';
import { formatNumber } from './format';
import { categoryOf, describeEvent } from './summaries';

const at = '2026-09-10T10:00:00Z';

describe('categoryOf', () => {
  it.each([
    ['FSDJump', 'travel'],
    ['CarrierJump', 'travel'],
    ['CarrierStats', 'station'],
    ['Docked', 'station'],
    ['Scan', 'exploration'],
    ['Scanned', 'combat'],
    ['MarketSell', 'trade'],
    ['Cargo', 'trade'],
    ['CargoDepot', 'missions'],
    ['Missions', 'session'],
    ['MaterialTrade', 'engineering'],
    ['NpcCrewPaidWage', 'background'],
    ['NpcCrewRank', 'social'],
    ['NavRouteClear', 'background'],
    ['FSSSignalDiscovered', 'background'],
    ['SomethingNew', 'other'],
  ])('%s → %s', (name, category) => {
    expect(categoryOf(name)).toBe(category);
  });
});

describe('describeEvent', () => {
  it('summarises a jump', () => {
    const event = {
      timestamp: at,
      event: 'FSDJump',
      StarSystem: 'Komovoy',
      JumpDist: 23.456,
      FuelUsed: 3.2,
    } as JournalEvent;
    expect(describeEvent(event)).toEqual({
      title: 'FSD Jump',
      summary: `Jumped to Komovoy · ${formatNumber(23.46)} ly · ${formatNumber(3.2)} t fuel`,
      category: 'travel',
    });
  });

  it('prefers localised text and skips internal symbols', () => {
    const named = {
      timestamp: at,
      event: 'FSSSignalDiscovered',
      SignalName: '$MULTIPLAYER_SCENARIO14_TITLE;',
      SignalName_Localised: 'Resource Extraction Site',
      SignalType: 'ResourceExtraction',
    } as JournalEvent;
    expect(describeEvent(named).summary).toBe('Resource Extraction Site · Resource Extraction');

    const unnamed = { ...named, SignalName_Localised: undefined } as JournalEvent;
    expect(describeEvent(unnamed).summary).toBe('Unknown signal · Resource Extraction');
  });

  it('leaves out negligible fuel use and internal ship names', () => {
    const jump = {
      timestamp: at,
      event: 'FSDJump',
      StarSystem: 'Komovoy',
      JumpDist: 3.05,
      FuelUsed: 0.004,
    } as JournalEvent;
    expect(describeEvent(jump).summary).toBe(`Jumped to Komovoy · ${formatNumber(3.05)} ly`);

    const loadout = {
      timestamp: at,
      event: 'Loadout',
      Ship: 'explorer_nx',
      ShipName: '',
      ShipIdent: 'PR-10E',
      MaxJumpRange: 69.74,
      Rebuy: 25036316,
    } as JournalEvent;
    expect(describeEvent(loadout).summary).toBe(
      `PR-10E · ${formatNumber(69.74)} ly jump range · rebuy ${formatNumber(25036316, 0)} CR`,
    );
  });

  it('totals the ship locker by kind', () => {
    const locker = {
      timestamp: at,
      event: 'ShipLocker',
      Items: [{ Name: 'a', OwnerID: 0, Count: 2 }],
      Components: [
        { Name: 'b', OwnerID: 0, Count: 3 },
        { Name: 'c', OwnerID: 0, Count: 4 },
      ],
      Consumables: [],
      Data: [],
    } as JournalEvent;
    expect(describeEvent(locker).summary).toBe('2 items · 7 components');

    const empty: JournalEvent = { timestamp: at, event: 'ShipLocker', Items: [], Components: [] };
    expect(describeEvent(empty).summary).toBe('Locker empty');
    expect(describeEvent({ timestamp: at, event: 'ShipLocker' }).summary).toBe(
      'Snapshot in ShipLocker.json',
    );
  });

  it('files NPC chatter and negligible scooping under background', () => {
    const npc = {
      timestamp: at,
      event: 'ReceiveText',
      From: '',
      Message: '$COMMS_entered:#name=Algorab;',
      Message_Localised: 'Entered Channel: Algorab',
      Channel: 'npc',
    } as const;
    expect(describeEvent(npc).category).toBe('background');
    expect(describeEvent({ ...npc, From: 'Cmdr Bob', Channel: 'wing' }).category).toBe('social');

    const scoop = { timestamp: at, event: 'FuelScoop', Scooped: 0.001, Total: 32 } as const;
    expect(describeEvent(scoop).category).toBe('background');
    expect(describeEvent({ ...scoop, Scooped: 0.5 }).category).toBe('travel');
  });

  it('falls back to no summary when a payload has an unexpected shape', () => {
    const broken = { timestamp: at, event: 'SAASignalsFound', BodyName: 'X' } as JournalEvent;
    expect(describeEvent(broken)).toMatchObject({ title: 'SAA Signals Found', summary: undefined });
  });
});
