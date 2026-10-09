import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';

import { IpcChannel } from '../shared/api';
import type { LoadoutEvent } from '../shared/journal';
import type {
  HullSummary,
  ShipCatalog,
  ShipExportTarget,
  ShipsSnapshot,
  ShipView,
  StockFit,
} from '../shared/ships';
import { broadcast } from './broadcast';
import type { JournalReader } from './journal';
import type { ShipCatalogSource } from './ships/catalog';
import { loadoutUrl, shipCsv, shipCsvName } from './ships/export';
import { shipSlots, stockFit } from './ships/layout';
import { type ShipRecord, ShipsTracker } from './ships/tracker';

/** Live events can come in bursts (a round of outfitting); windows hear at most this often. */
const BROADCAST_INTERVAL_MS = 250;

export interface ShipsService {
  /** Call once `reader` has replayed the older journals. */
  markReady(): void;
  snapshot(): ShipsSnapshot;
  /**
   * A hull as the shipyard sells it (the journal's ship name, any case: `PantherMkII`), from EDSY;
   * undefined for a hull EDSY doesn't list or before its tables are in.
   */
  stockFit(ship: string): StockFit | undefined;
  /** Every hull EDSY lists, by name. */
  hulls(): HullSummary[];
  /** Every ship the commander owns, the one being flown first, with its last loadout. */
  owned(): OwnedShip[];
}

/** A ship the commander owns, as `ShipsService.owned` lists it. */
export interface OwnedShip {
  shipId: number;
  /** "Panther Clipper Mk II". */
  type: string;
  name?: string;
  ident?: string;
  current: boolean;
  /** Where it is kept, when it isn't the ship being flown. */
  where?: string;
  /** Unset while the journal hasn't shown it. */
  loadout?: LoadoutEvent;
}

/**
 * Every ship the commander owns, slot by slot, from every journal (`reader` must replay them all)
 * and EDSY's slot tables from `catalog`.
 */
export function startShipsService(reader: JournalReader, catalog: ShipCatalogSource): ShipsService {
  const tracker = new ShipsTracker();
  let ready = false;
  // A newer EDSY database changes the snapshot without the journal moving.
  let catalogChanges = 0;
  let timer: NodeJS.Timeout | undefined;

  const snapshot = (): ShipsSnapshot => ({
    version: tracker.version + catalogChanges,
    ready,
    ...(tracker.commander !== undefined && { commander: tracker.commander }),
    ships: shipViews(tracker, catalog.current()),
    hulls: hulls(catalog.current()),
    catalog: catalog.status(),
  });
  const send = () => {
    clearTimeout(timer);
    timer = undefined;
    broadcast(IpcChannel.ShipsChanged, snapshot());
  };
  const changed = () => {
    if (ready) timer ??= setTimeout(send, BROADCAST_INTERVAL_MS);
  };

  reader.onAny((event) => {
    if (tracker.apply(event)) changed();
  });
  catalog.onChange(() => {
    catalogChanges++;
    changed();
  });

  ipcMain.handle(IpcChannel.ShipsSnapshot, snapshot);
  ipcMain.handle(IpcChannel.ShipsRefreshCatalog, () => catalog.refresh());
  ipcMain.handle(IpcChannel.ShipsStockFit, (_event, ship: unknown) =>
    typeof ship === 'string' ? stockFit(ship, catalog.current()) : undefined,
  );
  ipcMain.handle(
    IpcChannel.ShipsExport,
    async (event, shipId: unknown, target: unknown): Promise<string | undefined> => {
      const record = tracker.ships().find((ship) => ship.shipId === shipId);
      if (!record || !isTarget(target)) return 'No such ship.';
      if (!record.loadout) return "The journal hasn't shown this ship's loadout yet.";
      if (target !== 'csv') {
        await shell.openExternal(loadoutUrl(target, record.loadout));
        return undefined;
      }
      const view = shipView(record, record.shipId === tracker.current, catalog.current());
      const window = BrowserWindow.fromWebContents(event.sender);
      const options = {
        title: 'Save the ship as CSV',
        defaultPath: join(app.getPath('documents'), shipCsvName(view)),
        filters: [{ name: 'CSV', extensions: ['csv'] }],
      };
      const chosen = await (window
        ? dialog.showSaveDialog(window, options)
        : dialog.showSaveDialog(options));
      if (chosen.canceled || chosen.filePath === undefined) return undefined;
      try {
        await writeFile(chosen.filePath, shipCsv(view));
        return undefined;
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    },
  );

  return {
    snapshot,
    stockFit: (ship) => stockFit(ship, catalog.current()),
    hulls: () => hulls(catalog.current()),
    owned: () => {
      const records = new Map(tracker.ships().map((record) => [record.shipId, record]));
      return shipViews(tracker, catalog.current()).map((view): OwnedShip => {
        const loadout = records.get(view.shipId)?.loadout;
        return {
          shipId: view.shipId,
          type: view.type,
          ...(view.name && { name: view.name }),
          ...(view.ident && { ident: view.ident }),
          current: view.current,
          ...(view.where !== undefined && { where: view.where }),
          ...(loadout && { loadout }),
        };
      });
    },
    markReady() {
      ready = true;
      send();
    },
  };
}

export function shipViews(
  tracker: ShipsTracker,
  catalog: ShipCatalog | undefined,
  now = Date.now(),
): ShipView[] {
  const current = tracker.current;
  const records = tracker
    .ships()
    .toSorted(
      (a, b) =>
        Number(b.shipId === current) - Number(a.shipId === current) ||
        (b.flownAt ?? '').localeCompare(a.flownAt ?? ''),
    );
  return records.map((record) => shipView(record, record.shipId === current, catalog, now));
}

function shipView(
  record: ShipRecord,
  current: boolean,
  catalog: ShipCatalog | undefined,
  now = Date.now(),
): ShipView {
  const { loadout } = record;
  // With no loadout seen, the shipyard's own fit says more than a list of nothing.
  const stock = loadout ? undefined : stockFit(record.ship, catalog);
  const { layout, slots } = stock
    ? { layout: 'stock' as const, slots: stock.slots }
    : shipSlots(record.ship, loadout, record.seen, catalog);
  const hull = catalog?.ships[record.ship];
  return {
    shipId: record.shipId,
    ship: record.ship,
    type: catalog?.ships[record.ship]?.name ?? record.type ?? record.ship,
    ...(record.name && { name: record.name }),
    ...(record.ident && { ident: record.ident }),
    current,
    ...(!current && record.where !== undefined && { where: record.where }),
    ...(!current && inTransit(record, now) && { inTransit: true }),
    ...(loadout && { seenAt: loadout.timestamp }),
    layout,
    slots,
    ...(hull && {
      prices: {
        ...(hull.hullCost !== undefined && { hull: hull.hullCost }),
        ...(hull.retail !== undefined && { retail: hull.retail }),
      },
    }),
    ...(loadout && {
      stats: {
        maxJumpRange: loadout.MaxJumpRange,
        cargoCapacity: loadout.CargoCapacity,
        fuelMain: loadout.FuelCapacity.Main,
        fuelReserve: loadout.FuelCapacity.Reserve,
        unladenMass: loadout.UnladenMass,
        rebuy: loadout.Rebuy,
        ...(loadout.HullValue !== undefined && { hullValue: loadout.HullValue }),
        ...(loadout.ModulesValue !== undefined && { modulesValue: loadout.ModulesValue }),
        hullHealth: loadout.HullHealth,
      },
    }),
  };
}

function hulls(catalog: ShipCatalog | undefined): HullSummary[] {
  return Object.entries(catalog?.ships ?? {})
    .map(([ship, hull]) => ({ ship, type: hull.name }))
    .toSorted((a, b) => a.type.localeCompare(b.type, 'en'));
}

function isTarget(value: unknown): value is ShipExportTarget {
  return value === 'edsy' || value === 'coriolis' || value === 'csv';
}

/** On its way, unless the transfer the journal ordered should have arrived by now. */
function inTransit(record: ShipRecord, now: number): boolean {
  if (record.inTransit !== true) return false;
  return record.arrivesAt === undefined || Date.parse(record.arrivesAt) > now;
}
