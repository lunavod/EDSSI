import type { CarrierAlertSettings } from '../shared/settings';
import {
  alertLine,
  CarrierAlerts,
  carrierSearch,
  readCarriers,
  repairStationSearch,
  searchRange,
} from './carriers/alert';
import type { SettingsStore } from './config/store';
import type { JournalReader } from './journal';
import { type Coords, field, SpanshClient } from './spansh/client';

export interface CarrierAlertService {
  /** Call once `reader` has replayed the session, so only jumps made from now on are looked into. */
  markLive(): void;
  stop(): void;
}

/**
 * After each jump, asks Spansh which fleet carriers are within the configured jumps and tells the
 * commander about any not mentioned before. `reader` is the current session's reader; its replay
 * teaches the service the ship's range and nothing more.
 */
export function startCarrierAlertService(options: {
  reader: JournalReader;
  settings: SettingsStore;
  notify: (text: string) => void;
  spansh?: SpanshClient;
}): CarrierAlertService {
  const spansh = options.spansh ?? new SpanshClient();
  const alerts = new CarrierAlerts();
  let live = false;
  let jumpRangeLy: number | undefined;
  /** The search for the last jump; a newer jump makes it moot. */
  let pending: AbortController | undefined;

  const unsubscribe = options.reader.onAny((event) => {
    if (event.event === 'Loadout') {
      const range = event.MaxJumpRange;
      if (typeof range === 'number' && Number.isFinite(range) && range > 0) jumpRangeLy = range;
      return;
    }
    if (event.event !== 'FSDJump' || !live) return;
    // Riding a shuttle or in someone else's ship, a nearby carrier is no use.
    if (event.Taxi || event.Multicrew) return;
    const settings = options.settings.current().carrier_alert;
    const coords = toCoords(event.StarPos);
    if (!settings.enabled || !coords || !jumpRangeLy) return;

    pending?.abort();
    const controller = new AbortController();
    pending = controller;
    look(settings, coords, jumpRangeLy, event.StarSystem, controller.signal)
      .then((line) => {
        if (line && !controller.signal.aborted) options.notify(line);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) console.warn('[carrier-alert] search failed', error);
      })
      .finally(() => {
        if (pending === controller) pending = undefined;
      });
  });

  async function look(
    settings: CarrierAlertSettings,
    coords: Coords,
    jumpRange: number,
    here: string,
    signal: AbortSignal,
  ): Promise<string | undefined> {
    const range = searchRange(settings, jumpRange);
    const [carriers, nearStation] = await Promise.all([
      spansh
        .search('stations', carrierSearch(coords, range, settings.max_age_days), signal)
        .then(readCarriers),
      settings.quiet_near_stations ? repairStationNear(coords, range, signal) : false,
    ]);
    // In populated space carriers are everywhere, and so are stations; and those carriers aren't
    // marked as told, so leaving for the black still brings them up.
    if (nearStation) return undefined;
    return alertLine(alerts.select(carriers), jumpRange, here, {
      sayCallsign: settings.say_callsign,
    });
  }

  async function repairStationNear(
    coords: Coords,
    range: number,
    signal: AbortSignal,
  ): Promise<boolean> {
    const values = field(await spansh.fieldValues('stations', 'type', signal), 'values');
    const types = Array.isArray(values)
      ? values.filter((value): value is string => typeof value === 'string')
      : [];
    if (types.length === 0) return false;
    const result = await spansh.search(
      'stations',
      repairStationSearch(coords, range, types),
      signal,
    );
    const rows = field(result, 'results');
    return Array.isArray(rows) && rows.length > 0;
  }

  return {
    markLive() {
      live = true;
    },
    stop() {
      unsubscribe();
      pending?.abort();
    },
  };
}

function toCoords(position: unknown): Coords | undefined {
  if (!Array.isArray(position) || position.length !== 3) return undefined;
  const [x, y, z] = position.map(Number);
  return [x, y, z].every(Number.isFinite) ? { x: x!, y: y!, z: z! } : undefined;
}
