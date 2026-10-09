import { ipcMain } from 'electron';

import { IpcChannel } from '../shared/api';
import type { CarrierWebhookSettings } from '../shared/settings';
import {
  type CarrierIdentity,
  DEFAULT_CARRIER_NAME,
  DEFAULT_CARRIER_SERIAL,
  jumpCancelledPayload,
  jumpScheduledPayload,
  postWebhook,
  testPayload,
} from './carriers/discord';
import type { SettingsStore } from './config/store';
import type { JournalReader } from './journal';

export interface CarrierWebhookService {
  /** Call once `reader` has replayed the session, so only jumps scheduled from now on are posted. */
  markLive(): void;
  stop(): void;
}

/**
 * Posts the commander's carrier jumps to a Discord webhook, as the SWS Carrier Tracker EDMC plugin
 * does (`carriers/discord.ts`). `reader` is the current session's; `historyReader` replays every
 * journal, for the name and callsign of each carrier from its `CarrierStats`, used where the
 * settings don't name them.
 */
export function startCarrierWebhookService(options: {
  reader: JournalReader;
  historyReader: JournalReader;
  settings: SettingsStore;
}): CarrierWebhookService {
  const known = new Map<string, { name: string; callsign: string; squadron: boolean }>();
  let live = false;
  let beta = false;
  let commander: string | undefined;

  const unsubscribeHistory = options.historyReader.onAny((event) => {
    if (event.event !== 'CarrierStats') return;
    if (typeof event.Name !== 'string' || typeof event.Callsign !== 'string') return;
    const id = String(event.CarrierID);
    // Latest last, so the test button picks the carrier seen most recently.
    known.delete(id);
    known.set(id, {
      name: event.Name,
      callsign: event.Callsign,
      squadron: event.CarrierType === 'SquadronCarrier',
    });
  });

  const unsubscribe = options.reader.onAny((event) => {
    switch (event.event) {
      case 'Fileheader':
        // Never sent from a beta, as with the uploads: its carriers aren't the live galaxy's.
        beta = /beta/i.test(`${event.gameversion} ${event.build}`);
        return;
      case 'Commander':
        if (typeof event.Name === 'string') commander = event.Name;
        return;
      case 'LoadGame':
        if (typeof event.Commander === 'string') commander = event.Commander;
        return;
      case 'CarrierJumpRequest':
      case 'CarrierJumpCancelled':
        break;
      default:
        return;
    }
    if (!live || beta) return;
    const settings = options.settings.current().carrier_webhook;
    if (!settings.enabled || !settings.webhook_url) return;
    const carrier = identity(settings, String(event.CarrierID));
    const payload =
      event.event === 'CarrierJumpRequest'
        ? jumpScheduledPayload(
            carrier,
            commander ?? 'Unknown',
            typeof event.SystemName === 'string' ? event.SystemName : 'Unknown System',
            settings.image_url,
          )
        : jumpCancelledPayload(carrier, settings.image_url);
    postWebhook(settings.webhook_url, payload).catch((error: unknown) => {
      console.warn('[carrier-webhook] Discord dispatch error', errorMessage(error));
    });
  });

  /** The settings' name and serial, else the journal's for that carrier, else the plugin's own. */
  function identity(settings: CarrierWebhookSettings, carrierId?: string): CarrierIdentity {
    const fromJournal = carrierId === undefined ? ownCarrier() : known.get(carrierId);
    return {
      name: settings.carrier_name ?? fromJournal?.name ?? DEFAULT_CARRIER_NAME,
      serial: settings.carrier_serial ?? fromJournal?.callsign ?? DEFAULT_CARRIER_SERIAL,
    };
  }

  /** The fleet carrier seen last, for the test post; a squadron carrier only if there's no other. */
  function ownCarrier() {
    const carriers = [...known.values()].toReversed();
    return carriers.find((carrier) => !carrier.squadron) ?? carriers[0];
  }

  ipcMain.handle(
    IpcChannel.CarrierWebhookTest,
    async (_event, draft: Partial<CarrierWebhookSettings>): Promise<string> => {
      const settings = { ...options.settings.current().carrier_webhook, ...clean(draft) };
      if (!settings.webhook_url) return 'Missing Webhook URL';
      try {
        await postWebhook(
          settings.webhook_url,
          testPayload(identity(settings), settings.image_url),
        );
        return 'Success';
      } catch (error) {
        return `Error: ${errorMessage(error)}`;
      }
    },
  );

  return {
    markLive() {
      live = true;
    },
    stop() {
      unsubscribe();
      unsubscribeHistory();
      ipcMain.removeHandler(IpcChannel.CarrierWebhookTest);
    },
  };
}

/** The draft's text fields as the settings would read them: trimmed, and empty as unset. */
function clean(draft: Partial<CarrierWebhookSettings>): Partial<CarrierWebhookSettings> {
  const result: Partial<CarrierWebhookSettings> = {};
  for (const key of ['webhook_url', 'image_url', 'carrier_name', 'carrier_serial'] as const) {
    if (!(key in draft)) continue;
    const value = draft[key];
    result[key] = typeof value === 'string' ? value.trim() || undefined : undefined;
  }
  return result;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
