import { gunzipSync } from 'node:zlib';

import { describe, expect, it, vi } from 'vitest';

import type { CompanionName, JournalEvent } from '../../shared/journal';
import { EddnApi, type EddnEntry, eddnEncoder } from './eddn';
import { type GameState, initialGameState, updateGameState } from './game-state';

// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test lines are partial on purpose
const line = (fields: Record<string, unknown>) => fields as unknown as JournalEvent;

const PRU = {
  StarSystem: 'Pru Aihm VY-R c4-35',
  SystemAddress: 9715853695786,
  StarPos: [6706.21875, 164.125, 10672.15625],
};
const NEXT = {
  StarSystem: 'Pru Aihm CL-O c6-30',
  SystemAddress: 8341397052218,
  StarPos: [6672.40625, 164.65625, 10739.3125],
};

const start = [
  line({
    timestamp: '2026-09-17T12:55:00Z',
    event: 'Fileheader',
    part: 1,
    gameversion: '4.4.1.1',
    build: 'r332841/r0 ',
  }),
  line({
    timestamp: '2026-09-17T12:55:09Z',
    event: 'LoadGame',
    Commander: 'PROCRATSTINATOR',
    FID: 'F1',
    Horizons: true,
    Odyssey: true,
    gameversion: '4.4.1.1',
    build: 'r332841/r0 ',
  }),
  line({ timestamp: '2026-09-17T12:55:19Z', event: 'Location', Docked: false, ...PRU }),
];

/** Feeds lines through an encoder the way the uploads do, collecting what comes out. */
function run(lines: JournalEvent[], companions: Partial<Record<CompanionName, unknown>> = {}) {
  const encoder = eddnEncoder({ readCompanion: (name) => companions[name] });
  let state: GameState = initialGameState();
  const sent: EddnEntry[] = [];
  for (const event of [...start, ...lines]) {
    state = updateGameState(state, event);
    const encoded = encoder.encode(event, state, true);
    if ('payloads' in encoded) sent.push(...encoded.payloads);
  }
  return sent;
}

const messages = (sent: EddnEntry[], schema: string) =>
  sent.filter((entry) => entry.schema === schema).map((entry) => entry.message);

describe('eddnEncoder', () => {
  it('sends a jump without what is personal, with the game flags and header', () => {
    const sent = run([
      line({
        timestamp: '2026-09-17T13:07:29Z',
        event: 'FSDJump',
        ...NEXT,
        SystemEconomy: '$economy_None;',
        SystemEconomy_Localised: 'None',
        JumpDist: 75.19,
        FuelUsed: 6.6,
        FuelLevel: 121.3,
        Factions: [{ Name: 'A', MyReputation: 12, HomeSystem: true, Influence: 0.5 }],
      }),
    ]);
    const jump = messages(sent, 'journal/1').find((message) => message['event'] === 'FSDJump');
    expect(jump).toEqual({
      timestamp: '2026-09-17T13:07:29Z',
      event: 'FSDJump',
      ...NEXT,
      SystemEconomy: '$economy_None;',
      Factions: [{ Name: 'A', Influence: 0.5 }],
      horizons: true,
      odyssey: true,
    });
    expect(sent[0]!.header).toEqual({
      uploaderID: 'PROCRATSTINATOR',
      gameversion: '4.4.1.1',
      gamebuild: 'r332841/r0 ',
    });
  });

  it('adds the position to a docking only in the system the commander is known to be in', () => {
    const docked = {
      event: 'Docked',
      StationName: 'T4B-BHB',
      StationType: 'FleetCarrier',
      MarketID: 3710010368,
      Wanted: false,
      ActiveFine: false,
    };
    const here = run([line({ timestamp: '2026-09-17T12:56:00Z', ...docked, ...omitPos(PRU) })]);
    expect(messages(here, 'journal/1').at(-1)).toMatchObject({
      event: 'Docked',
      StarPos: PRU.StarPos,
    });
    expect(messages(here, 'journal/1').at(-1)).not.toHaveProperty('Wanted');

    // A docking elsewhere means a jump went missing; it isn't sent with the wrong position.
    const lost = run([line({ timestamp: '2026-09-17T12:56:00Z', ...docked, ...omitPos(NEXT) })]);
    expect(messages(lost, 'journal/1').map((message) => message['event'])).toEqual(['Location']);
  });

  it('sends a run of signals as one message, dropping mission targets', () => {
    const signal = (name: string, extra = {}) =>
      line({
        timestamp: '2026-09-17T13:07:30Z',
        event: 'FSSSignalDiscovered',
        SystemAddress: NEXT.SystemAddress,
        SignalName: name,
        ...extra,
      });
    // As Odyssey writes them: the signals first, then the jump that brought them.
    const sent = run([
      signal('Theophania T4B-BHB', { SignalType: 'FleetCarrier', IsStation: true }),
      signal('$USS;', { USSType: '$USS_Type_MissionTarget;', TimeRemaining: 100 }),
      signal('$USS;', { USSType: '$USS_Type_Salvage;', USSType_Localised: 'X', TimeRemaining: 9 }),
      line({ timestamp: '2026-09-17T13:07:30Z', event: 'FSDJump', ...NEXT }),
      line({ timestamp: '2026-09-17T13:07:40Z', event: 'Music', MusicTrack: 'Exploration' }),
    ]);
    expect(messages(sent, 'fsssignaldiscovered/1')).toEqual([
      {
        event: 'FSSSignalDiscovered',
        timestamp: '2026-09-17T13:07:30Z',
        SystemAddress: NEXT.SystemAddress,
        StarSystem: NEXT.StarSystem,
        StarPos: NEXT.StarPos,
        signals: [
          {
            timestamp: '2026-09-17T13:07:30Z',
            SignalName: 'Theophania T4B-BHB',
            SignalType: 'FleetCarrier',
            IsStation: true,
          },
          { timestamp: '2026-09-17T13:07:30Z', SignalName: '$USS;', USSType: '$USS_Type_Salvage;' },
        ],
        horizons: true,
        odyssey: true,
      },
    ]);
  });

  it('keeps only the keys a strict schema allows', () => {
    const sent = run([
      line({
        timestamp: '2026-09-17T12:58:00Z',
        event: 'FSSDiscoveryScan',
        Progress: 0.23,
        BodyCount: 8,
        NonBodyCount: 0,
        SystemName: PRU.StarSystem,
        SystemAddress: PRU.SystemAddress,
      }),
      line({
        timestamp: '2026-09-17T12:58:10Z',
        event: 'FSSBodySignals',
        BodyName: 'Pru Aihm VY-R c4-35 2 a',
        BodyID: 3,
        SystemAddress: PRU.SystemAddress,
        Signals: [{ Type: '$Mining;', Type_Localised: 'Mining', Count: 22 }],
      }),
      line({
        timestamp: '2026-09-17T12:58:20Z',
        event: 'CodexEntry',
        EntryID: 1100301,
        Name: '$Codex_Ent_A_Type_Name;',
        Name_Localised: 'A Type Star',
        SubCategory: '$Codex_SubCategory_Stars;',
        Category: '$Codex_Category_StellarBodies;',
        Region: '$Codex_RegionName_10;',
        System: PRU.StarSystem,
        SystemAddress: PRU.SystemAddress,
        BodyID: 0,
        IsNewEntry: true,
      }),
    ]);
    expect(messages(sent, 'fssdiscoveryscan/1')).toEqual([
      {
        timestamp: '2026-09-17T12:58:00Z',
        event: 'FSSDiscoveryScan',
        SystemName: PRU.StarSystem,
        SystemAddress: PRU.SystemAddress,
        BodyCount: 8,
        NonBodyCount: 0,
        StarPos: PRU.StarPos,
        horizons: true,
        odyssey: true,
      },
    ]);
    expect(messages(sent, 'fssbodysignals/1')[0]).toMatchObject({
      StarSystem: PRU.StarSystem,
      Signals: [{ Type: '$Mining;', Count: 22 }],
    });
    const codex = messages(sent, 'codexentry/1')[0]!;
    expect(codex).toMatchObject({ EntryID: 1100301, StarPos: PRU.StarPos, BodyID: 0 });
    expect(Object.keys(codex)).not.toContain('IsNewEntry');
    expect(Object.keys(codex)).not.toContain('Name_Localised');
  });

  it("makes the market from Market.json, once per change, and only from this line's version", () => {
    const market = {
      timestamp: '2026-09-17T12:57:00Z',
      event: 'Market',
      MarketID: 3710010368,
      StationName: 'T4B-BHB',
      StationType: 'FleetCarrier',
      CarrierDockingAccess: 'all',
      StarSystem: PRU.StarSystem,
      Items: [
        {
          id: 1,
          Name: '$titanium_name;',
          Name_Localised: 'Titanium',
          Category: '$MARKET_category_metals;',
          BuyPrice: 4446,
          SellPrice: 0,
          MeanPrice: 0,
          StockBracket: 0,
          DemandBracket: 0,
          Stock: 10,
          Demand: 0,
          Consumer: false,
          Producer: false,
          Rare: false,
        },
        {
          id: 2,
          Name: '$drones_name;',
          Category: '$MARKET_category_nonmarketable;',
          BuyPrice: 101,
          SellPrice: 0,
          MeanPrice: 0,
          StockBracket: 3,
          DemandBracket: 0,
          Stock: 999,
          Demand: 0,
        },
      ],
    };
    const opened = line({
      timestamp: market.timestamp,
      event: 'Market',
      MarketID: market.MarketID,
    });
    const sent = run([opened, opened], { Market: market });
    expect(messages(sent, 'commodity/3')).toEqual([
      {
        timestamp: market.timestamp,
        systemName: PRU.StarSystem,
        stationName: 'T4B-BHB',
        marketId: 3710010368,
        stationType: 'FleetCarrier',
        carrierDockingAccess: 'all',
        commodities: [
          {
            name: 'titanium',
            meanPrice: 0,
            buyPrice: 4446,
            stock: 10,
            stockBracket: 0,
            sellPrice: 0,
            demand: 0,
            demandBracket: 0,
          },
        ],
        horizons: true,
        odyssey: true,
      },
    ]);

    const stale = run([line({ ...opened, timestamp: '2026-09-17T13:00:00Z' })], { Market: market });
    expect(messages(stale, 'commodity/3')).toEqual([]);
  });

  it('lists outfitting as EDMC does, and ships by type', () => {
    const at = '2026-09-17T12:57:00Z';
    const station = { MarketID: 42, StationName: 'Port', StarSystem: PRU.StarSystem };
    const sent = run(
      [
        line({ timestamp: at, event: 'Outfitting', ...station }),
        line({ timestamp: at, event: 'Shipyard', ...station }),
      ],
      {
        Outfitting: {
          timestamp: at,
          event: 'Outfitting',
          ...station,
          Horizons: true,
          Items: [
            { id: 1, Name: 'hpt_pulselaser_fixed_small', BuyPrice: 1 },
            { id: 2, Name: 'int_planetapproachsuite', BuyPrice: 1 },
            { id: 3, Name: 'sidewinder_armour_grade1', BuyPrice: 1 },
            { id: 4, Name: 'paintjob_cobramkiii_default', BuyPrice: 1 },
          ],
        },
        Shipyard: {
          timestamp: at,
          event: 'Shipyard',
          ...station,
          Horizons: true,
          AllowCobraMkIV: false,
          PriceList: [{ id: 0, ShipType: 'krait_light', ShipType_Localised: 'Krait Phantom' }],
        },
      },
    );
    expect(messages(sent, 'outfitting/2')[0]).toMatchObject({
      marketId: 42,
      modules: ['Hpt_pulselaser_fixed_small', 'sidewinder_Armour_grade1'],
      horizons: true,
    });
    expect(messages(sent, 'shipyard/2')[0]).toMatchObject({ ships: ['krait_light'] });
    expect(messages(sent, 'shipyard/2')[0]).not.toHaveProperty('AllowCobraMkIV');
  });

  it('sends nothing from before the cursor, but still learns where the commander is', () => {
    const encoder = eddnEncoder({ readCompanion: () => undefined });
    let state = initialGameState();
    const sent: EddnEntry[] = [];
    for (const event of start) {
      state = updateGameState(state, event);
      const encoded = encoder.encode(event, state, false);
      if ('payloads' in encoded) sent.push(...encoded.payloads);
    }
    const scan = line({
      timestamp: '2026-09-17T13:00:00Z',
      event: 'Scan',
      BodyName: 'Pru Aihm VY-R c4-35 1',
      StarSystem: PRU.StarSystem,
      SystemAddress: PRU.SystemAddress,
      BodyID: 1,
    });
    const encoded = encoder.encode(scan, updateGameState(state, scan), true);
    expect(sent).toEqual([]);
    expect('payloads' in encoded && encoded.payloads[0]?.message).toMatchObject({
      event: 'Scan',
      StarPos: PRU.StarPos,
    });
  });
});

const entry = (event: string): EddnEntry => ({
  schema: 'journal/1',
  header: { uploaderID: 'Cmdr', gameversion: '4.4.1.1', gamebuild: 'r1 ' },
  message: { event, timestamp: '2026-09-17T13:00:00Z', SystemAddress: 12345678901234567890n },
});

describe('EddnApi', () => {
  it('posts each message gzipped, and lets a refused one go', async () => {
    const statuses = [200, 400, 200];
    const bodies: unknown[] = [];
    const fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the sender passes a Buffer
      bodies.push(JSON.parse(gunzipSync(init!.body as Buffer).toString()));
      const status = statuses.shift()!;
      return new Response(status === 200 ? 'OK' : 'FAIL: Schema Validation: bad', { status });
    });
    const api = new EddnApi({ software: { name: 'EDSSI', version: '1.0.0' }, fetch });
    const result = await api.send([entry('FSDJump'), entry('Scan'), entry('Docked')]);

    expect(result).toEqual({
      kind: 'sent',
      accepted: 2,
      refused: [{ event: 'Scan', code: 400, message: 'FAIL: Schema Validation: bad' }],
    });
    expect(bodies[0]).toEqual({
      $schemaRef: 'https://eddn.edcd.io/schemas/journal/1',
      header: {
        uploaderID: 'Cmdr',
        gameversion: '4.4.1.1',
        gamebuild: 'r1 ',
        softwareName: 'EDSSI',
        softwareVersion: '1.0.0',
      },
      message: {
        event: 'FSDJump',
        timestamp: '2026-09-17T13:00:00Z',
        SystemAddress: 12345678901234567000,
      },
    });
  });

  it('stops at an outage, keeping the rest for later', async () => {
    const statuses = [200, 503];
    const fetch = vi.fn(async () => new Response('', { status: statuses.shift() ?? 200 }));
    const api = new EddnApi({ software: { name: 'EDSSI', version: '1' }, fetch });
    expect(await api.send([entry('A'), entry('B'), entry('C')])).toMatchObject({
      kind: 'sent',
      accepted: 1,
      consumed: 1,
      holdMs: 60_000,
    });
    expect(await api.send([entry('B')])).toEqual({ kind: 'sent', accepted: 1, refused: [] });

    const down = vi.fn(async () => Promise.reject(new Error('ECONNREFUSED')));
    const offline = new EddnApi({ software: { name: 'EDSSI', version: '1' }, fetch: down });
    expect(await offline.send([entry('A')])).toMatchObject({ kind: 'retry', afterMs: 60_000 });
  });
});

function omitPos({ StarSystem, SystemAddress }: typeof PRU) {
  return { StarSystem, SystemAddress };
}
