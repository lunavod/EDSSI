/**
 * EDDN (eddn.edcd.io), the network that carries the journal to Spansh, Inara's market data, EDSM's
 * stations and everything else that listens. Nobody has an account: each message is posted on its
 * own, and the relay passes it on to every listener.
 *
 * What goes on which schema, and what has to be taken out or added first, follows EDDN's own
 * schema READMEs (github.com/EDCD/EDDN, `schemas/`) and EDMarketConnector's `plugins/eddn.py`, the
 * reference sender. Most schemas refuse a key they don't list, so those messages are built from a
 * list of the keys each allows rather than by removing what is known to be wrong: a field a game
 * update adds can't get them refused.
 */

import { gzipSync } from 'node:zlib';

import type { CompanionName, JournalEvent } from '../../shared/journal';
import type { RefusedEvent } from '../../shared/uploads';
import { USER_AGENT } from '../edsm';
import type { SendResult } from './batcher';
import type { GameState } from './game-state';
import { toJson } from './json';
import type { LoggedEvent } from './log';
import type { Encoder } from './uploads';

export const EDDN_UPLOAD_URL = 'https://eddn.edcd.io:4430/upload/';
const SCHEMA_BASE = 'https://eddn.edcd.io/schemas/';
const TIMEOUT_MS = 20_000;
/** EDDN asks senders to wait at least a minute before trying a failed message again. */
const RETRY_AFTER_MS = 60_000;

type Json = Record<string, unknown>;
type StarPos = [number, number, number];

/** One message, less what the sender adds: the software's name and version. */
export interface EddnEntry {
  /** e.g. `journal/1`, `commodity/3`. */
  schema: string;
  header: { uploaderID: string; gameversion: string; gamebuild: string };
  message: Json;
}

export interface EddnEncoderOptions {
  /**
   * The companion file as it is on disk now, parsed, or undefined. Market, outfitting, shipyard,
   * route and carrier material messages are made from the file the journal line announces.
   */
  readCompanion: (name: CompanionName) => unknown;
}

/** Where the commander is, from the last `Location`, `FSDJump` or `CarrierJump` only. */
interface Location {
  address: string;
  name: string;
  starPos: StarPos | undefined;
}

/** Journal events sent as they are on the `journal/1` schema, less what is personal. */
const JOURNAL_EVENTS = new Set([
  'Docked',
  'FSDJump',
  'Scan',
  'Location',
  'SAASignalsFound',
  'CarrierJump',
]);
/** Keys `journal/1` refuses anywhere at the top of a message. */
const JOURNAL_DISALLOWED = [
  'ActiveFine',
  'CockpitBreach',
  'BoostUsed',
  'FuelLevel',
  'FuelUsed',
  'JumpDist',
  'Latitude',
  'Longitude',
  'Wanted',
  'IsNewEntry',
  'NewTraitsDiscovered',
  'Traits',
  'VoucherAmount',
];
/** What each faction in a jump or location says about this commander in particular. */
const FACTION_PERSONAL = ['HappiestSystem', 'HomeSystem', 'MyReputation', 'SquadronFaction'];

const SIGNAL_KEYS = [
  'timestamp',
  'SignalName',
  'SignalType',
  'IsStation',
  'USSType',
  'SpawningState',
  'SpawningFaction',
  'SpawningPower',
  'OpposingPower',
  'ThreatLevel',
];

/** Outfitting items that belong to a station rather than to the commander. */
const MODULE_NAME = /^hpt_|^int_|_armour_/i;

/**
 * Turns the journal into EDDN messages. It keeps where the commander is, which game they run, the
 * signals waiting to be sent together, and the last market, outfitting and shipyard sent, so an
 * unchanged one isn't sent again.
 */
export function eddnEncoder(options: EddnEncoderOptions): Encoder<EddnEntry> {
  let location: Location | undefined;
  let horizons: boolean | undefined;
  let odyssey: boolean | undefined;
  let gameVersion: string | undefined;
  let gameBuild: string | undefined;
  /** `FSSSignalDiscovered` lines since the last other line; EDDN wants a run as one message. */
  let signals: { event: Json; fresh: boolean }[] = [];
  /** The last station data sent, by schema, so a screen opened twice sends it once. */
  const lastSent = new Map<string, string>();

  const flags = (): Json => ({
    ...(horizons === undefined ? {} : { horizons }),
    ...(odyssey === undefined ? {} : { odyssey }),
  });

  /** The system name and position for an event that names only the system's address. */
  const here = (address: unknown): Location | undefined =>
    location && idText(address) === location.address ? location : undefined;

  function flushSignals(): Json | undefined {
    const run = signals;
    signals = [];
    const first = run.find((signal) => signal.fresh)?.event;
    if (!first) return undefined;
    // The game writes them just before (Odyssey) or just after (Horizons) the arrival; either way
    // the location is the one tracked by now, and a signal from anywhere else is dropped.
    const system = here(first['SystemAddress']);
    if (!system?.starPos) return undefined;
    const kept = run
      .filter(
        ({ event, fresh }) =>
          fresh &&
          idText(event['SystemAddress']) === system.address &&
          event['USSType'] !== '$USS_Type_MissionTarget;',
      )
      .map(({ event }) => pick(event, SIGNAL_KEYS));
    if (kept.length === 0) return undefined;
    return {
      event: 'FSSSignalDiscovered',
      timestamp: first['timestamp'],
      SystemAddress: first['SystemAddress'],
      StarSystem: system.name,
      StarPos: system.starPos,
      signals: kept,
      ...flags(),
    };
  }

  function encodeEvent(event: Json): { schema: string; message: Json } | undefined {
    const name = event['event'];
    if (typeof name === 'string' && JOURNAL_EVENTS.has(name)) {
      const message = journalMessage(event);
      return message && { schema: 'journal/1', message };
    }
    switch (name) {
      case 'FSSDiscoveryScan':
        return withStarPos('fssdiscoveryscan/1', event, [
          'timestamp',
          'event',
          'SystemName',
          'SystemAddress',
          'BodyCount',
          'NonBodyCount',
        ]);
      case 'FSSAllBodiesFound':
        return withStarPos('fssallbodiesfound/1', event, [
          'timestamp',
          'event',
          'SystemName',
          'SystemAddress',
          'Count',
        ]);
      case 'NavBeaconScan':
        return withStarPos(
          'navbeaconscan/1',
          event,
          ['timestamp', 'event', 'SystemAddress', 'NumBodies'],
          true,
        );
      case 'FSSBodySignals': {
        const result = withStarPos(
          'fssbodysignals/1',
          event,
          ['timestamp', 'event', 'SystemAddress', 'BodyID', 'BodyName'],
          true,
        );
        if (result) result.message['Signals'] = pickEach(event['Signals'], ['Type', 'Count']);
        return result;
      }
      case 'ScanBaryCentre': {
        const result = withStarPos('scanbarycentre/1', event, [
          'timestamp',
          'event',
          'StarSystem',
          'SystemAddress',
          'BodyID',
          'SemiMajorAxis',
          'Eccentricity',
          'OrbitalInclination',
          'Periapsis',
          'OrbitalPeriod',
          'AscendingNode',
          'MeanAnomaly',
        ]);
        if (result && typeof result.message['StarSystem'] !== 'string') {
          result.message['StarSystem'] = here(event['SystemAddress'])?.name;
        }
        return result;
      }
      case 'CodexEntry':
        return codexEntry(event);
      case 'ApproachSettlement':
        return approachSettlement(event);
      case 'DockingGranted':
        return {
          schema: 'dockinggranted/1',
          message: {
            ...pick(event, [
              'timestamp',
              'event',
              'MarketID',
              'StationName',
              'StationType',
              'LandingPad',
            ]),
            ...flags(),
          },
        };
      case 'DockingDenied':
        return {
          schema: 'dockingdenied/1',
          message: {
            ...pick(event, [
              'timestamp',
              'event',
              'MarketID',
              'StationName',
              'StationType',
              'Reason',
            ]),
            ...flags(),
          },
        };
      case 'Market':
        return commodities(event);
      case 'Outfitting':
        return outfitting(event);
      case 'Shipyard':
        return shipyard(event);
      case 'NavRoute':
        return navRoute(event);
      case 'FCMaterials':
        return carrierMaterials(event);
      default:
        return undefined;
    }
  }

  /** `journal/1`: the event less what is personal, with the system's name and position added. */
  function journalMessage(event: Json): Json | undefined {
    if (event['SystemAddress'] === undefined) return undefined;
    const message = withoutLocalised(event);
    for (const key of JOURNAL_DISALLOWED) delete message[key];
    if (Array.isArray(message['Factions'])) {
      message['Factions'] = message['Factions'].map((faction: unknown) =>
        isObject(faction) ? omit(faction, FACTION_PERSONAL) : faction,
      );
    }
    // Only a line from the system the commander is known to be in may be filled in: a delayed
    // scan, or a journal the game stopped writing for a while, would put it in the wrong place.
    if (typeof message['StarSystem'] !== 'string') {
      const system = here(message['SystemAddress']);
      if (!system) return undefined;
      message['StarSystem'] = system.name;
    }
    if (!Array.isArray(message['StarPos'])) {
      const system = here(message['SystemAddress']);
      if (!system?.starPos) return undefined;
      message['StarPos'] = system.starPos;
    }
    return { ...message, ...flags() };
  }

  /** The listed keys, plus `StarPos` (and `StarSystem`) of the system the event names. */
  function withStarPos(
    schema: string,
    event: Json,
    keys: readonly string[],
    addName = false,
  ): { schema: string; message: Json } | undefined {
    const system = here(event['SystemAddress']);
    if (!system?.starPos) return undefined;
    return {
      schema,
      message: {
        ...pick(event, keys),
        ...(addName ? { StarSystem: system.name } : {}),
        StarPos: system.starPos,
        ...flags(),
      },
    };
  }

  function codexEntry(event: Json): { schema: string; message: Json } | undefined {
    const result = withStarPos('codexentry/1', event, [
      'timestamp',
      'event',
      'System',
      'SystemAddress',
      'Name',
      'Region',
      'EntryID',
      'Category',
      'SubCategory',
      'Latitude',
      'Longitude',
      'NearestDestination',
      'VoucherAmount',
      'Traits',
      'BodyID',
      'BodyName',
    ]);
    // The schema wants these filled in; EDMC drops the entry when the game leaves one empty.
    const filled = ['System', 'Name', 'Region', 'Category', 'SubCategory'].every(
      (key) => typeof result?.message[key] === 'string' && result.message[key] !== '',
    );
    return filled ? result : undefined;
  }

  function approachSettlement(event: Json): { schema: string; message: Json } | undefined {
    // Logging in at a settlement writes one without a position, and the schema requires it.
    const required = ['Name', 'BodyID', 'BodyName', 'Latitude', 'Longitude'];
    if (required.some((key) => event[key] === undefined)) return undefined;
    const result = withStarPos(
      'approachsettlement/1',
      event,
      [
        'timestamp',
        'event',
        'SystemAddress',
        'Name',
        'MarketID',
        'BodyID',
        'BodyName',
        'Latitude',
        'Longitude',
        'StationGovernment',
        'StationAllegiance',
        'StationServices',
        'StationEconomy',
      ],
      true,
    );
    if (!result) return undefined;
    if (Array.isArray(event['StationEconomies'])) {
      result.message['StationEconomies'] = pickEach(event['StationEconomies'], [
        'Name',
        'Proportion',
      ]);
    }
    if (isObject(event['StationFaction'])) {
      result.message['StationFaction'] = pick(event['StationFaction'], ['Name', 'FactionState']);
    }
    return result;
  }

  /** The companion file the line announces, if it is the version written with this line. */
  function companion(name: CompanionName, event: Json): Json | undefined {
    const file = options.readCompanion(name);
    if (!isObject(file) || file['timestamp'] !== event['timestamp']) return undefined;
    if (event['MarketID'] !== undefined && idText(file['MarketID']) !== idText(event['MarketID'])) {
      return undefined;
    }
    return file;
  }

  /** Whether this station data differs from what was last sent on the schema. */
  function changed(schema: string, key: unknown): boolean {
    const text = toJson(key);
    if (lastSent.get(schema) === text) return false;
    lastSent.set(schema, text);
    return true;
  }

  function commodities(event: Json): { schema: string; message: Json } | undefined {
    const file = companion('Market', event);
    if (!file || !Array.isArray(file['Items'])) return undefined;
    const items = file['Items']
      .filter(isObject)
      .filter(
        (item) =>
          typeof item['Name'] === 'string' &&
          !(typeof item['Category'] === 'string' && /nonmarketable/i.test(item['Category'])) &&
          !item['legality'],
      )
      .map((item) => ({
        name: String(item['Name']).replace(/^\$(.+)_name;$/i, '$1'),
        meanPrice: item['MeanPrice'],
        buyPrice: item['BuyPrice'],
        stock: item['Stock'],
        stockBracket: item['StockBracket'],
        sellPrice: item['SellPrice'],
        demand: item['Demand'],
        demandBracket: item['DemandBracket'],
      }))
      .toSorted((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    // An empty list still goes: a carrier that has cleared its orders needs to say so.
    if (!changed('commodity', [file['MarketID'], items])) return undefined;
    return {
      schema: 'commodity/3',
      message: {
        timestamp: file['timestamp'],
        systemName: file['StarSystem'],
        stationName: file['StationName'],
        marketId: file['MarketID'],
        ...(typeof file['StationType'] === 'string' ? { stationType: file['StationType'] } : {}),
        ...(typeof file['CarrierDockingAccess'] === 'string' && file['CarrierDockingAccess']
          ? { carrierDockingAccess: file['CarrierDockingAccess'] }
          : {}),
        commodities: items,
        ...flags(),
      },
    };
  }

  function outfitting(event: Json): { schema: string; message: Json } | undefined {
    const file = companion('Outfitting', event);
    if (!file || !Array.isArray(file['Items'])) return undefined;
    const names = file['Items']
      .filter(isObject)
      .map((item) => item['Name'])
      .filter(
        (name): name is string =>
          typeof name === 'string' &&
          MODULE_NAME.test(name) &&
          name.toLowerCase() !== 'int_planetapproachsuite',
      )
      // EDMC capitalises the prefix, and listeners compare against what it sends.
      .map((name) => name.replace(/^hpt_|^int_|armour_/i, (prefix) => capitalise(prefix)));
    const modules = [...new Set(names)].toSorted();
    const fileHorizons = typeof file['Horizons'] === 'boolean' ? file['Horizons'] : horizons;
    if (modules.length === 0 || !changed('outfitting', [file['MarketID'], fileHorizons, modules])) {
      return undefined;
    }
    return {
      schema: 'outfitting/2',
      message: {
        ...stationOf(file),
        modules,
        ...flags(),
        ...(fileHorizons === undefined ? {} : { horizons: fileHorizons }),
      },
    };
  }

  function shipyard(event: Json): { schema: string; message: Json } | undefined {
    const file = companion('Shipyard', event);
    if (!file || !Array.isArray(file['PriceList'])) return undefined;
    const ships = [
      ...new Set(
        file['PriceList']
          .filter(isObject)
          .map((ship) => ship['ShipType'])
          .filter((type): type is string => typeof type === 'string' && type !== ''),
      ),
    ].toSorted();
    const fileHorizons = typeof file['Horizons'] === 'boolean' ? file['Horizons'] : horizons;
    if (ships.length === 0 || !changed('shipyard', [file['MarketID'], fileHorizons, ships])) {
      return undefined;
    }
    return {
      schema: 'shipyard/2',
      message: {
        ...stationOf(file),
        ships,
        ...flags(),
        ...(fileHorizons === undefined ? {} : { horizons: fileHorizons }),
      },
    };
  }

  function navRoute(event: Json): { schema: string; message: Json } | undefined {
    const file = companion('NavRoute', event);
    if (!file || !Array.isArray(file['Route']) || file['Route'].length === 0) return undefined;
    return {
      schema: 'navroute/1',
      message: {
        timestamp: file['timestamp'],
        event: 'NavRoute',
        Route: pickEach(file['Route'], ['StarSystem', 'SystemAddress', 'StarPos', 'StarClass']),
        ...flags(),
      },
    };
  }

  function carrierMaterials(event: Json): { schema: string; message: Json } | undefined {
    const file = companion('FCMaterials', event);
    if (!file || !Array.isArray(file['Items'])) return undefined;
    const items = pickEach(file['Items'], ['id', 'Name', 'Price', 'Stock', 'Demand']);
    if (!changed('fcmaterials', [file['MarketID'], items])) return undefined;
    return {
      schema: 'fcmaterials_journal/1',
      message: {
        ...pick(file, ['timestamp', 'event', 'MarketID', 'CarrierName', 'CarrierID']),
        Items: items,
        ...flags(),
      },
    };
  }

  return {
    encode(journalEvent: JournalEvent, state: GameState, fresh: boolean) {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- read as JSON, field by field
      const event = journalEvent as unknown as Json;
      const name = event['event'];

      // The header takes the build exactly as the game wrote it, trailing space and all.
      if (name === 'Fileheader') {
        gameVersion = stringOr(event['gameversion'], gameVersion);
        gameBuild = stringOr(event['build'], gameBuild);
        // A new game hasn't said where it is yet; a later part of the same one carries on.
        if (event['part'] === 1) location = undefined;
      }
      if (name === 'LoadGame') {
        horizons = typeof event['Horizons'] === 'boolean' ? event['Horizons'] : undefined;
        odyssey = typeof event['Odyssey'] === 'boolean' ? event['Odyssey'] : undefined;
        gameVersion = stringOr(event['gameversion'], gameVersion);
        gameBuild = stringOr(event['build'], gameBuild);
      }
      if (name === 'Location' || name === 'FSDJump' || name === 'CarrierJump') {
        const address = idText(event['SystemAddress']);
        const system = event['StarSystem'];
        location =
          address !== undefined && typeof system === 'string'
            ? { address, name: system, starPos: starPosOf(event['StarPos']) }
            : undefined;
      }

      const messages: { schema: string; message: Json }[] = [];
      if (name === 'FSSSignalDiscovered') {
        signals.push({ event, fresh });
      } else if (signals.length > 0) {
        const message = flushSignals();
        if (message) messages.push({ schema: 'fsssignaldiscovered/1', message });
      }
      if (fresh) {
        const encoded = encodeEvent(event);
        if (encoded) messages.push(encoded);
      }

      const commander = state.commander;
      if (!commander || messages.length === 0) return { payloads: [], urgent: false };
      const header = {
        uploaderID: commander,
        gameversion: gameVersion ?? state.gameVersion ?? '',
        gamebuild: gameBuild ?? '',
      };
      return {
        payloads: messages.map(({ schema, message }) => ({ schema, header, message })),
        // Nothing is gained by waiting: every message is its own request.
        urgent: true,
      };
    },
    describe: describeEddnEntry,
  };
}

export function describeEddnEntry(entry: EddnEntry): LoggedEvent {
  const { message } = entry;
  const event =
    typeof message['event'] === 'string'
      ? message['event']
      : ({ 'commodity/3': 'Market', 'outfitting/2': 'Outfitting', 'shipyard/2': 'Shipyard' }[
          entry.schema
        ] ?? entry.schema);
  const system = [
    message['StarSystem'],
    message['systemName'],
    message['SystemName'],
    message['System'],
  ].find((value): value is string => typeof value === 'string');
  return { event, system };
}

export interface EddnApiOptions {
  software: { name: string; version: string };
  fetch?: typeof fetch;
  /** Appends `/test` to every schema, for trying the sender out without feeding listeners. */
  test?: boolean;
}

export class EddnApi {
  readonly #options: EddnApiOptions;
  readonly #fetch: typeof fetch;

  constructor(options: EddnApiOptions) {
    this.#options = options;
    this.#fetch = options.fetch ?? fetch;
  }

  /**
   * Posts each message in turn. A message EDDN refuses (400, 426) or finds too large (413) is not
   * sent again, as EDDN asks; one that couldn't be delivered ends the batch there, so it and those
   * after it are tried again later.
   */
  async send(batch: readonly EddnEntry[]): Promise<SendResult> {
    let accepted = 0;
    const refused: RefusedEvent[] = [];
    for (const [index, entry] of batch.entries()) {
      const body = gzipSync(
        toJson({
          $schemaRef: `${SCHEMA_BASE}${entry.schema}${this.#options.test ? '/test' : ''}`,
          header: {
            ...entry.header,
            softwareName: this.#options.software.name,
            softwareVersion: this.#options.software.version,
          },
          message: entry.message,
        }),
      );

      let failure: string | undefined;
      try {
        const response = await this.#fetch(EDDN_UPLOAD_URL, {
          method: 'POST',
          headers: {
            'User-Agent': USER_AGENT,
            'Content-Type': 'application/json',
            'Content-Encoding': 'gzip',
          },
          body,
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (response.ok) {
          accepted += 1;
          continue;
        }
        const text = (await response.text().catch(() => '')).trim();
        if (
          response.status >= 400 &&
          response.status < 500 &&
          ![408, 429].includes(response.status)
        ) {
          const event = describeEddnEntry(entry).event;
          console.warn('[uploads] EDDN refused', entry.schema, event, response.status, text);
          refused.push({ event, code: response.status, message: text.slice(0, 500) });
          continue;
        }
        failure = `EDDN answered HTTP ${response.status}${text ? `: ${text.slice(0, 200)}` : ''}`;
      } catch (error) {
        failure = `Couldn't reach EDDN: ${error instanceof Error ? error.message : String(error)}`;
      }

      if (index === 0) return { kind: 'retry', message: failure, afterMs: RETRY_AFTER_MS };
      return {
        kind: 'sent',
        accepted,
        consumed: index,
        refused,
        holdMs: RETRY_AFTER_MS,
        message: failure,
      };
    }
    return { kind: 'sent', accepted, refused };
  }
}

/** A 64-bit journal id (a number, or a bigint when it doesn't fit one) as text, for comparing. */
function idText(value: unknown): string | undefined {
  return typeof value === 'number' || typeof value === 'bigint' || typeof value === 'string'
    ? String(value)
    : undefined;
}

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function pick(source: Json, keys: readonly string[]): Json {
  const result: Json = {};
  for (const key of keys) if (source[key] !== undefined) result[key] = source[key];
  return result;
}

function pickEach(value: unknown, keys: readonly string[]): Json[] {
  return Array.isArray(value) ? value.filter(isObject).map((item) => pick(item, keys)) : [];
}

function omit(source: Json, keys: readonly string[]): Json {
  const result = { ...source };
  for (const key of keys) delete result[key];
  return result;
}

/** A copy with every `…_Localised` key taken out, however deep. */
export function withoutLocalised(value: Json): Json {
  const strip = (item: unknown): unknown =>
    Array.isArray(item) ? item.map(strip) : isObject(item) ? withoutLocalised(item) : item;
  const result: Json = {};
  for (const [key, item] of Object.entries(value)) {
    if (!key.endsWith('_Localised')) result[key] = strip(item);
  }
  return result;
}

function stationOf(file: Json): Json {
  return {
    timestamp: file['timestamp'],
    systemName: file['StarSystem'],
    stationName: file['StationName'],
    marketId: file['MarketID'],
  };
}

function starPosOf(value: unknown): StarPos | undefined {
  return Array.isArray(value) && value.length === 3 && value.every(Number.isFinite)
    ? // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- checked just above
      (value as StarPos)
    : undefined;
}

function stringOr(value: unknown, fallback: string | undefined): string | undefined {
  return typeof value === 'string' ? value : fallback;
}

function capitalise(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}
