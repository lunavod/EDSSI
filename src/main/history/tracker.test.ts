import { describe, expect, it } from 'vitest';

import type { JournalEvent } from '../../shared/journal';
import { FIRST_FOOTFALL_BONUS, HistoryTracker } from './tracker';
import { estimateBodyValue } from './values';

let clock = Date.parse('2026-09-10T10:00:00Z');

function logged(fields: Record<string, unknown>): JournalEvent {
  clock += 1000;
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test payloads, like parsed JSON.
  return {
    timestamp: new Date(clock).toISOString().replace('.000', ''),
    ...fields,
  } as JournalEvent;
}

function track(...events: JournalEvent[]): HistoryTracker {
  const tracker = new HistoryTracker();
  for (const event of events) tracker.apply(event);
  return tracker;
}

const jump = (address: number, name: string) =>
  logged({ event: 'FSDJump', StarSystem: name, SystemAddress: address, StarPos: [0, 0, 0] });

function scan(address: number, system: string, bodyId: number, fields: Record<string, unknown>) {
  return logged({
    event: 'Scan',
    ScanType: 'AutoScan',
    BodyName: `${system} ${bodyId}`,
    BodyID: bodyId,
    StarSystem: system,
    SystemAddress: address,
    DistanceFromArrivalLS: bodyId * 100,
    WasDiscovered: true,
    WasMapped: false,
    ...fields,
  });
}
const star = (address: number, system: string, fields: Record<string, unknown> = {}) =>
  scan(address, system, 0, {
    StarType: 'K',
    StellarMass: 0.8,
    DistanceFromArrivalLS: 0,
    ...fields,
  });
const hmc = (
  address: number,
  system: string,
  bodyId: number,
  fields: Record<string, unknown> = {},
) =>
  scan(address, system, bodyId, {
    PlanetClass: 'High metal content body',
    MassEM: 0.5,
    TerraformState: '',
    Landable: true,
    ...fields,
  });

const odyssey = { mapped: false, mappedEfficiently: false, odyssey: true } as const;
const starValue = estimateBodyValue({
  starType: 'K',
  stellarMass: 0.8,
  wasDiscovered: true,
  wasMapped: false,
  ...odyssey,
});
const hmcValue = estimateBodyValue({
  planetClass: 'High metal content body',
  massEM: 0.5,
  terraformState: '',
  wasDiscovered: true,
  wasMapped: false,
  ...odyssey,
});

describe('HistoryTracker', () => {
  it('adds up unsold scan data until it is sold, system by system', () => {
    const tracker = track(
      jump(1, 'Alpha'),
      star(1, 'Alpha'),
      hmc(1, 'Alpha', 1),
      jump(2, 'Beta'),
      hmc(2, 'Beta', 1),
    );
    expect(tracker.snapshot(true).ledger.cartographics).toEqual({
      value: starValue + 2 * hmcValue,
      sessionValue: starValue + 2 * hmcValue,
      bodies: 3,
      systems: 2,
    });

    tracker.apply(
      logged({
        event: 'SellExplorationData',
        Systems: ['Alpha'],
        Discovered: [],
        BaseValue: 0,
        Bonus: 0,
        TotalEarnings: 0,
      }),
    );
    expect(tracker.snapshot(true).ledger.cartographics).toEqual({
      value: hmcValue,
      sessionValue: hmcValue,
      bodies: 1,
      systems: 1,
    });

    tracker.apply(
      logged({
        event: 'MultiSellExplorationData',
        Discovered: [{ SystemName: 'Beta', NumBodies: 1 }],
        BaseValue: 0,
        Bonus: 0,
        TotalEarnings: 0,
      }),
    );
    expect(tracker.snapshot(true).ledger.cartographics).toEqual({
      value: 0,
      sessionValue: 0,
      bodies: 0,
      systems: 0,
    });
  });

  it('sells everything far enough away at once, whichever systems the sale names', () => {
    const jumpTo = (address: number, name: string, x: number) =>
      logged({ event: 'FSDJump', StarSystem: name, SystemAddress: address, StarPos: [x, 0, 0] });
    const tracker = track(
      jumpTo(1, 'Far', 0),
      hmc(1, 'Far', 1),
      jumpTo(2, 'Also far', 50),
      hmc(2, 'Also far', 1),
      jumpTo(3, 'Near', 95),
      hmc(3, 'Near', 1),
      jumpTo(4, 'Here', 100),
      hmc(4, 'Here', 1),
      logged({
        event: 'MultiSellExplorationData',
        Discovered: [{ SystemName: 'Also far', NumBodies: 1 }],
        BaseValue: 0,
        Bonus: 0,
        TotalEarnings: 0,
      }),
    );
    // Data from within 20 ly of the seller, this system's included, can't be sold here.
    expect(tracker.snapshot(true).ledger.cartographics).toMatchObject({ bodies: 2, systems: 2 });
  });

  it('pays for first discovery and mapping, keeping the flags from the first scan', () => {
    const tracker = track(
      jump(1, 'Alpha'),
      hmc(1, 'Alpha', 1, { WasDiscovered: false }),
      // A later scan of the same body no longer says it was undiscovered.
      hmc(1, 'Alpha', 1, { ScanType: 'Detailed', WasDiscovered: true }),
      logged({
        event: 'SAAScanComplete',
        BodyName: 'Alpha 1',
        SystemAddress: 1,
        BodyID: 1,
        ProbesUsed: 4,
        EfficiencyTarget: 5,
      }),
    );
    const expected = estimateBodyValue({
      planetClass: 'High metal content body',
      massEM: 0.5,
      terraformState: '',
      wasDiscovered: false,
      wasMapped: false,
      mapped: true,
      mappedEfficiently: true,
      odyssey: true,
    });
    expect(tracker.snapshot(true).ledger.cartographics.value).toBe(expected);
    expect(tracker.snapshot(true).survey?.bodies[0]).toMatchObject({
      firstDiscovery: true,
      mapped: true,
      mappedEfficiently: true,
      value: expected,
    });
  });

  it('says what mapping a planet would add, until it is mapped', () => {
    const tracker = track(
      jump(1, 'Alpha'),
      star(1, 'Alpha'),
      hmc(1, 'Alpha', 1, { WasDiscovered: false }),
    );
    const planet = {
      planetClass: 'High metal content body',
      massEM: 0.5,
      terraformState: '',
      wasDiscovered: false,
      wasMapped: false,
    };
    const [arrival, body] = tracker.snapshot(true).survey!.bodies;
    expect(arrival?.mappingValue).toBeUndefined();
    expect(body?.mappingValue).toBe(
      estimateBodyValue({ ...planet, ...odyssey, mapped: true, mappedEfficiently: true }) -
        estimateBodyValue({ ...planet, ...odyssey }),
    );

    tracker.apply(
      logged({
        event: 'SAAScanComplete',
        BodyName: 'Alpha 1',
        SystemAddress: 1,
        BodyID: 1,
        ProbesUsed: 9,
        EfficiencyTarget: 5,
      }),
    );
    expect(tracker.snapshot(true).survey!.bodies[1]?.mappingValue).toBeUndefined();
  });

  it('loses unsold data and vouchers with the ship, and settles fines at the rebuy', () => {
    const tracker = track(
      jump(1, 'Alpha'),
      hmc(1, 'Alpha', 1),
      logged({ event: 'Bounty', Target: 'viper', VictimFaction: 'Pirates', TotalReward: 100000 }),
      logged({ event: 'FactionKillBond', Reward: 5000, AwardingFaction: 'A', VictimFaction: 'B' }),
      logged({ event: 'CommitCrime', CrimeType: 'fireInNoFireZone', Faction: 'Police', Fine: 400 }),
      logged({ event: 'Died' }),
    );
    expect(tracker.snapshot(true).ledger).toMatchObject({
      fines: 400,
      bounties: 0,
      combatBonds: 0,
      cartographics: { value: 0, bodies: 0, systems: 0 },
    });
    expect(tracker.snapshot(true).survey?.bodies[0]?.status).toBe('lost');

    tracker.apply(logged({ event: 'Resurrect', Option: 'rebuy', Cost: 1000, Bankrupt: false }));
    expect(tracker.snapshot(true).ledger.fines).toBe(0);
  });

  it('prices what each death cost, and keeps only the last few', () => {
    const died = logged({ event: 'Died' });
    const tracker = track(
      jump(1, 'Alpha'),
      star(1, 'Alpha'),
      hmc(1, 'Alpha', 1),
      jump(2, 'Beta'),
      hmc(2, 'Beta', 1),
      logged({ event: 'Bounty', Target: 'viper', VictimFaction: 'Pirates', TotalReward: 100000 }),
      died,
    );
    expect(tracker.snapshot(true).losses).toEqual([
      {
        timestamp: died.timestamp,
        systemName: 'Beta',
        cartographics: { value: starValue + 2 * hmcValue, bodies: 3, systems: 2 },
        exobiology: { value: 0, species: 0 },
        bounties: 100000,
        combatBonds: 0,
        notable: [
          { kind: 'body', name: 'Alpha 1', systemName: 'Alpha', value: hmcValue },
          { kind: 'body', name: 'Beta 1', systemName: 'Beta', value: hmcValue },
          { kind: 'body', name: 'Alpha 0', systemName: 'Alpha', value: starValue },
        ],
      },
    ]);

    // A death with nothing to lose isn't worth a line.
    tracker.apply(logged({ event: 'Died' }));
    expect(tracker.snapshot(true).losses).toHaveLength(1);

    for (let i = 0; i < 25; i++) {
      tracker.apply(hmc(2, 'Beta', 10 + i));
      tracker.apply(logged({ event: 'Died' }));
    }
    expect(tracker.snapshot(true).losses).toHaveLength(20);
  });

  it('pays off fines faction by faction or all at once', () => {
    const crime = (Faction: string, Fine: number) =>
      logged({ event: 'CommitCrime', CrimeType: 'assault', Faction, Fine });
    const tracker = track(crime('Police', 100), crime('Guard', 200), crime('Police', 50));
    expect(tracker.snapshot(true).ledger.fines).toBe(350);
    tracker.apply(logged({ event: 'PayFines', Amount: 150, Faction: 'Police', ShipID: 1 }));
    expect(tracker.snapshot(true).ledger.fines).toBe(200);
    tracker.apply(logged({ event: 'PayFines', Amount: 200, AllFines: true, ShipID: 1 }));
    expect(tracker.snapshot(true).ledger.fines).toBe(0);
  });

  it('cashes in vouchers, counting what a broker kept', () => {
    const tracker = track(
      logged({ event: 'Bounty', Target: 'viper', VictimFaction: 'Pirates', TotalReward: 100000 }),
      logged({ event: 'Bounty', Target: 'skimmer', VictimFaction: 'Pirates', Reward: 20000 }),
      logged({ event: 'CapShipBond', Reward: 30000, AwardingFaction: 'A', VictimFaction: 'B' }),
    );
    expect(tracker.snapshot(true).ledger).toMatchObject({ bounties: 120000, combatBonds: 30000 });

    tracker.apply(
      logged({ event: 'RedeemVoucher', Type: 'bounty', Amount: 75000, BrokerPercentage: 25 }),
    );
    tracker.apply(logged({ event: 'RedeemVoucher', Type: 'CombatBond', Amount: 30000 }));
    expect(tracker.snapshot(true).ledger).toMatchObject({ bounties: 20000, combatBonds: 0 });
  });

  it('follows organic sampling to a payout, with the first footfall bonus', () => {
    const organic = (ScanType: string, Species = '$Codex_Ent_Bacterial_04_Name;') =>
      logged({
        event: 'ScanOrganic',
        ScanType,
        Genus: '$Codex_Ent_Bacterial_Genus_Name;',
        Genus_Localised: 'Bacterium',
        Species,
        Species_Localised: 'Bacterium Acies',
        Variant_Localised: 'Bacterium Acies - Aquamarine',
        SystemAddress: 1,
        Body: 1,
      });
    const tracker = track(
      jump(1, 'Alpha'),
      hmc(1, 'Alpha', 1, { WasFootfalled: false }),
      organic('Log'),
      organic('Sample'),
    );
    expect(tracker.snapshot(true).survey?.bodies[0]?.organics[0]).toMatchObject({
      name: 'Bacterium Acies',
      samples: 2,
      value: 1000000 * FIRST_FOOTFALL_BONUS,
    });
    expect(tracker.snapshot(true).ledger.exobiology).toEqual({
      value: 0,
      sessionValue: 0,
      species: 0,
    });

    tracker.apply(organic('Sample'));
    tracker.apply(organic('Analyse'));
    expect(tracker.snapshot(true).ledger.exobiology).toEqual({
      value: 1000000 * FIRST_FOOTFALL_BONUS,
      sessionValue: 1000000 * FIRST_FOOTFALL_BONUS,
      species: 1,
    });

    tracker.apply(
      logged({
        event: 'SellOrganicData',
        MarketID: 1,
        BioData: [
          { Genus: 'x', Species: '$Codex_Ent_Bacterial_04_Name;', Value: 1000000, Bonus: 4000000 },
        ],
      }),
    );
    expect(tracker.snapshot(true).ledger.exobiology).toEqual({
      value: 0,
      sessionValue: 0,
      species: 0,
    });
    expect(tracker.snapshot(true).survey?.bodies[0]?.organics[0]?.status).toBe('sold');
  });

  it('throws away a sample in progress when another species is started', () => {
    const organic = (ScanType: string, Species: string) =>
      logged({ event: 'ScanOrganic', ScanType, Genus: 'g', Species, SystemAddress: 1, Body: 1 });
    const tracker = track(
      jump(1, 'Alpha'),
      organic('Log', '$Codex_Ent_Stratum_07_Name;'),
      organic('Sample', '$Codex_Ent_Stratum_07_Name;'),
      organic('Log', '$Codex_Ent_Tussocks_13_Name;'),
    );
    const organics = tracker.snapshot(true).survey?.bodies[0]?.organics;
    expect(organics?.map((o) => [o.species, o.samples])).toEqual([
      ['$Codex_Ent_Stratum_07_Name;', 0],
      ['$Codex_Ent_Tussocks_13_Name;', 1],
    ]);
  });

  it('counts a third sample only once it is analysed', () => {
    const organic = (ScanType: string) =>
      logged({
        event: 'ScanOrganic',
        ScanType,
        Genus: '$Codex_Ent_Bacterial_Genus_Name;',
        Species: '$Codex_Ent_Bacterial_01_Name;',
        SystemAddress: 1,
        Body: 1,
      });
    // Back in the ship before the analysis finished: the game never logs Analyse.
    const tracker = track(jump(1, 'Alpha'), organic('Log'), organic('Sample'), organic('Sample'));
    expect(tracker.snapshot(true).survey?.bodies[0]?.organics[0]?.samples).toBe(2);
    expect(tracker.snapshot(true).ledger.exobiology.species).toBe(0);

    tracker.apply(organic('Analyse'));
    expect(tracker.snapshot(true).ledger.exobiology.species).toBe(1);
  });

  it('describes the bodies of the current system, nearest first', () => {
    const tracker = track(
      jump(1, 'Alpha'),
      logged({
        event: 'FSSDiscoveryScan',
        Progress: 0.4,
        BodyCount: 4,
        NonBodyCount: 2,
        SystemName: 'Alpha',
        SystemAddress: 1,
      }),
      hmc(1, 'Alpha', 3),
      star(1, 'Alpha'),
      logged({
        event: 'FSSBodySignals',
        BodyName: 'Alpha 5',
        BodyID: 5,
        SystemAddress: 1,
        Signals: [{ Type: '$SAA_SignalType_Biological;', Count: 2 }],
      }),
      logged({
        event: 'SAASignalsFound',
        BodyName: 'Alpha 3',
        SystemAddress: 1,
        BodyID: 3,
        Signals: [{ Type: '$SAA_SignalType_Biological;', Count: 1 }],
        Genuses: [{ Genus: '$Codex_Ent_Bacterial_Genus_Name;', Genus_Localised: 'Bacterium' }],
      }),
      logged({ event: 'FSSAllBodiesFound', SystemName: 'Alpha', SystemAddress: 1, Count: 4 }),
    );
    const survey = tracker.snapshot(true).survey;
    expect(survey).toMatchObject({
      systemName: 'Alpha',
      bodyCount: 4,
      nonBodyCount: 2,
      progress: 0.4,
      allFound: true,
    });
    expect(
      survey?.bodies.map((body) => [
        body.name,
        body.kind,
        body.bioSignals,
        body.genuses.map((genus) => genus.name),
      ]),
    ).toEqual([
      ['Alpha 0', 'star', 0, []],
      ['Alpha 3', 'planet', 1, ['Bacterium']],
      // Known only from its signals so far.
      ['Alpha 5', undefined, 2, []],
    ]);

    tracker.apply(jump(2, 'Beta'));
    expect(tracker.snapshot(true).survey).toMatchObject({ systemName: 'Beta', bodies: [] });
  });

  it('splits out what was earned since the game was launched', () => {
    const launch = (part = 1) =>
      logged({
        event: 'Fileheader',
        part,
        language: 'English/UK',
        Odyssey: true,
        gameversion: '4.2',
        build: 'r1',
      });
    const tracker = track(launch(), jump(1, 'Alpha'), star(1, 'Alpha'), hmc(1, 'Alpha', 1));
    expect(tracker.snapshot(true).ledger.cartographics.sessionValue).toBe(starValue + hmcValue);

    tracker.apply(launch());
    // Another part of the same session changes nothing.
    tracker.apply(launch(2));
    expect(tracker.snapshot(true).ledger.cartographics.sessionValue).toBe(0);

    tracker.apply(hmc(1, 'Alpha', 2));
    tracker.apply(
      logged({
        event: 'SAAScanComplete',
        BodyName: 'Alpha 1',
        SystemAddress: 1,
        BodyID: 1,
        ProbesUsed: 9,
        EfficiencyTarget: 5,
      }),
    );
    const mappedValue = estimateBodyValue({
      planetClass: 'High metal content body',
      massEM: 0.5,
      terraformState: '',
      wasDiscovered: true,
      wasMapped: false,
      ...odyssey,
      mapped: true,
    });
    const { cartographics } = tracker.snapshot(true).ledger;
    expect(cartographics.value).toBe(starValue + mappedValue + hmcValue);
    // Body 1 was scanned last session, so only its mapping counts; body 2 counts in full.
    expect(cartographics.sessionValue).toBe(mappedValue - hmcValue + hmcValue);
  });

  it('predicts life from the scans, before and after the surface scanner names it', () => {
    const system = 'Blu Theia WF-S c19-0';
    const planet = hmc(9, system, 2, {
      BodyName: `${system} 2`,
      AtmosphereType: 'CarbonDioxide',
      AtmosphereComposition: [
        { Name: 'CarbonDioxide', Percent: 93.5 },
        { Name: 'SulphurDioxide', Percent: 6.5 },
      ],
      Volcanism: '',
      SurfaceGravity: 4.001408,
      SurfaceTemperature: 195.83,
      SurfacePressure: 3498.75,
      WasFootfalled: false,
    });
    const bodySignals = (event: string, fields: Record<string, unknown> = {}) =>
      logged({
        event,
        BodyName: `${system} 2`,
        SystemAddress: 9,
        BodyID: 2,
        Signals: [{ Type: '$SAA_SignalType_Biological;', Count: 1 }],
        ...fields,
      });
    const tracker = track(
      logged({
        event: 'FSDJump',
        StarSystem: system,
        SystemAddress: 9,
        StarPos: [8580, 655, 2337],
      }),
      star(9, system, { BodyName: system, Luminosity: 'Vab' }),
      planet,
      bodySignals('FSSBodySignals'),
    );
    const before = tracker.snapshot(true).survey?.bodies.find((body) => body.bodyId === 2);
    expect(
      before?.possibleGenuses?.map((genus) => [genus.name, genus.minValue, genus.maxValue]),
    ).toEqual([
      ['Bacterium', 1_000_000 * FIRST_FOOTFALL_BONUS, 1_000_000 * FIRST_FOOTFALL_BONUS],
      ['Stratum', 19_010_800 * FIRST_FOOTFALL_BONUS, 19_010_800 * FIRST_FOOTFALL_BONUS],
    ]);

    tracker.apply(
      bodySignals('SAASignalsFound', {
        Genuses: [{ Genus: '$Codex_Ent_Stratum_Genus_Name;', Genus_Localised: 'Stratum' }],
      }),
    );
    const [stratum] =
      tracker.snapshot(true).survey?.bodies.find((body) => body.bodyId === 2)?.genuses ?? [];
    expect(stratum).toMatchObject({
      minValue: 19_010_800 * FIRST_FOOTFALL_BONUS,
      maxValue: 19_010_800 * FIRST_FOOTFALL_BONUS,
      candidates: [{ name: 'Stratum Tectonicas', colours: ['Lime'], newSpecies: true }],
    });
  });

  it('logs analysed organics since the last sale, with the jumps between them', () => {
    const organic = (ScanType: string, address: number, species: string, genus: string) =>
      logged({
        event: 'ScanOrganic',
        ScanType,
        Genus: `$Codex_Ent_${genus}_Genus_Name;`,
        Species: `$Codex_Ent_${species}_Name;`,
        Species_Localised: species,
        SystemAddress: address,
        Body: 1,
      });
    const analyse = (address: number, species: string, genus: string) =>
      ['Log', 'Sample', 'Sample', 'Analyse'].map((type) => organic(type, address, species, genus));
    const signals = (address: number, system: string) =>
      logged({
        event: 'SAASignalsFound',
        BodyName: `${system} 1`,
        SystemAddress: address,
        BodyID: 1,
        Signals: [{ Type: '$SAA_SignalType_Biological;', Count: 2 }],
        Genuses: [
          { Genus: '$Codex_Ent_Bacterial_Genus_Name;', Genus_Localised: 'Bacterium' },
          { Genus: '$Codex_Ent_Stratum_Genus_Name;', Genus_Localised: 'Stratum' },
        ],
      });
    const sell = (species: string) =>
      logged({
        event: 'SellOrganicData',
        MarketID: 1,
        BioData: [{ Genus: 'g', Species: `$Codex_Ent_${species}_Name;`, Value: 1000000, Bonus: 0 }],
      });

    const tracker = track(
      jump(1, 'Alpha'),
      hmc(1, 'Alpha', 1),
      signals(1, 'Alpha'),
      ...analyse(1, 'Bacterial_04', 'Bacterial'),
      jump(2, 'Beta'),
      jump(3, 'Gamma'),
      jump(4, 'Delta'),
      hmc(4, 'Delta', 1, { WasFootfalled: false }),
      signals(4, 'Delta'),
      ...analyse(4, 'Bacterial_04', 'Bacterial'),
      ...analyse(4, 'Stratum_07', 'Stratum'),
    );
    let snapshot = tracker.snapshot(true);
    expect(
      snapshot.exobiology.entries.map((entry) => [
        entry.systemName,
        entry.name,
        entry.jump,
        entry.newSpecies,
        entry.value,
      ]),
    ).toEqual([
      ['Alpha', 'Bacterial_04', 1, true, 1000000],
      ['Delta', 'Bacterial_04', 4, false, 1000000 * FIRST_FOOTFALL_BONUS],
      ['Delta', 'Stratum_07', 4, true, 19010800 * FIRST_FOOTFALL_BONUS],
    ]);
    expect(snapshot.exobiology.jumps).toBe(4);
    expect(snapshot.survey?.bodies[0]?.genuses).toEqual([
      {
        code: '$Codex_Ent_Bacterial_Genus_Name;',
        name: 'Bacterium',
        minValue: 1000000 * FIRST_FOOTFALL_BONUS,
        maxValue: 8418000 * FIRST_FOOTFALL_BONUS,
        newGenus: false,
        colonyDistance: 500,
        // An airless body gives the spawn rules nothing to go on, so every species stays priced.
        candidates: [],
      },
      {
        code: '$Codex_Ent_Stratum_Genus_Name;',
        name: 'Stratum',
        minValue: 1362000 * FIRST_FOOTFALL_BONUS,
        maxValue: 19010800 * FIRST_FOOTFALL_BONUS,
        newGenus: false,
        colonyDistance: 500,
        candidates: [],
      },
    ]);
    expect(snapshot.survey?.bodies[0]?.possibleGenuses).toEqual([]);

    // Selling one species keeps the rest; a death after that keeps what was lost until a sale.
    tracker.apply(sell('Bacterial_04'));
    tracker.apply(jump(5, 'Epsilon'));
    tracker.apply(logged({ event: 'Died' }));
    snapshot = tracker.snapshot(true);
    expect(snapshot.exobiology.lastSale).toMatchObject({ value: 1000000, species: 1 });
    expect(snapshot.exobiology.entries.map((entry) => [entry.systemName, entry.status])).toEqual([
      ['Delta', 'lost'],
      ['Delta', 'lost'],
    ]);
    expect(snapshot.ledger.exobiology).toEqual({ value: 0, sessionValue: 0, species: 0 });

    tracker.apply(jump(6, 'Zeta'));
    tracker.apply(hmc(6, 'Zeta', 1));
    tracker.apply(signals(6, 'Zeta'));
    tracker.apply(sell('Bacterial_04'));
    snapshot = tracker.snapshot(true);
    expect(snapshot.exobiology.entries).toEqual([]);
    expect(snapshot.exobiology.jumps).toBe(6);
  });

  it('keeps each commander to themselves', () => {
    const bounty = logged({
      event: 'Bounty',
      Target: 'viper',
      VictimFaction: 'Pirates',
      TotalReward: 1000,
    });
    const tracker = track(logged({ event: 'Commander', FID: 'F1', Name: 'One' }), bounty);
    tracker.apply(logged({ event: 'Commander', FID: 'F2', Name: 'Two' }));
    expect(tracker.snapshot(true).ledger).toMatchObject({ commander: 'Two', bounties: 0 });
    tracker.apply(
      logged({
        event: 'LoadGame',
        FID: 'F1',
        Commander: 'One',
        Horizons: true,
        Odyssey: true,
        Credits: 0,
        Loan: 0,
      }),
    );
    expect(tracker.snapshot(true).ledger).toMatchObject({ commander: 'One', bounties: 1000 });
  });

  it('counts versions only for events that matter', () => {
    const tracker = new HistoryTracker();
    expect(tracker.apply(logged({ event: 'Music', MusicTrack: 'Exploration' }))).toBe(false);
    expect(tracker.version).toBe(0);
    expect(tracker.apply(jump(1, 'Alpha'))).toBe(true);
    expect(tracker.snapshot(false)).toMatchObject({ version: 1, ready: false });
  });
});
