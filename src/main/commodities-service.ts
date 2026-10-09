import { readFile } from 'node:fs/promises';
import { basename, dirname } from 'node:path';

import { app, BrowserWindow, dialog, ipcMain } from 'electron';

import { IpcChannel, type Outcome } from '../shared/api';
import {
  type CommoditySearchRequest,
  type CommoditySearchResult,
  type CommoditySellRequest,
  type CommoditySellResult,
  commodityKey,
  DEFAULT_MARKET_FILTERS,
  type GamePurchase,
  journalCommodityName,
  knownCommodityNames,
  type MarketFilters,
  missingNeeds,
  type PlanRequest,
  type PinnedPlan,
  type PlanResult,
  type SellPlanRequest,
  parseShoppingCsv,
  recordPlanPurchase,
  recordPurchase,
  type ShoppingItem,
  type ShoppingList,
  type ShoppingNeed,
  type SystemMarkets,
} from '../shared/commodities';
import { sameSystem } from '../shared/csv-route';
import type { MarketEvent } from '../shared/journal-events.generated';
import { broadcast } from './broadcast';
import {
  commodityNames,
  localMarket,
  searchMarkets,
  searchSellMarkets,
  systemMarkets,
  withLocalMarket,
} from './commodities/market-search';
import { planSelling, planShopping } from './commodities/planner';
import { type Look, readScreenshots } from './commodities/screenshots';
import type { JournalReader } from './journal';
import { SpanshClient } from './spansh/client';
import { type Position, positionOf, referenceFor } from './spansh/reference';
import type { PinnedPlanStore, ShoppingListStore } from './store/shopping-list-store';

/** Stations per page on the Search and Sell pages. */
const SEARCH_PAGE_SIZE = 25;

/** Reading a handful of screenshots takes the model seconds; much longer and something is stuck. */
const READ_TIMEOUT_MS = 180_000;

export interface CommoditiesService {
  /** Call once `reader` has replayed the session: purchases from then on count as bought. */
  markLive(): void;
}

/**
 * The Commodities tab: keeps the shopping list (in the database), counts what is bought in the
 * game against it, and asks Spansh for markets. Purchases come from the session reader, and only
 * live ones: replaying the session must not count them again.
 */
export function startCommoditiesService(
  reader: JournalReader,
  options: {
    store?: ShoppingListStore;
    pinnedStore?: PinnedPlanStore;
    /** The commander's current system, for searches from "here". */
    here: () => string | undefined;
    client?: SpanshClient;
    /** The assistant's model, for reading colonisation panel screenshots; set once it is up. */
    look?: () => Look | undefined;
  },
): CommoditiesService {
  const { store, pinnedStore } = options;
  const client = options.client ?? new SpanshClient();
  let nextId = 0;
  const newId = () => `item-${++nextId}`;
  let items: ShoppingItem[] = [];
  try {
    items = (store?.load() ?? []).map((item) => ({ ...item, id: newId() }));
  } catch (error) {
    console.error('[commodities] failed to read the shopping list', error);
  }
  let pinned: PinnedPlan | undefined;
  try {
    pinned = pinnedStore?.load();
  } catch (error) {
    console.error('[commodities] failed to read the pinned plan', error);
  }
  const setPinned = (next: PinnedPlan | undefined): void => {
    pinned = next;
    try {
      if (next) pinnedStore?.save(next);
      else pinnedStore?.clear();
    } catch (error) {
      console.error('[commodities] failed to save the pinned plan', error);
    }
    broadcast(IpcChannel.CommoditiesPinnedChanged, pinned ?? null);
  };
  let live = false;
  /** Where the commander is, from the journal, for systems Spansh doesn't know. */
  let position: Position | undefined;
  let lastFolder: string | undefined;
  let planning: AbortController | undefined;
  let sellPlanning: AbortController | undefined;
  /** The last market opened in the game (Market.json), fresher than Spansh's for that station. */
  let lastMarket: MarketEvent | undefined;
  reader.onCompanion('Market', (event) => {
    lastMarket = event;
  });

  const list = (): ShoppingList => ({ items });
  const update = (next: ShoppingItem[]): void => {
    items = next;
    try {
      store?.save(items);
    } catch (error) {
      console.error('[commodities] failed to save the shopping list', error);
    }
    broadcast(IpcChannel.CommoditiesListChanged, list());
  };

  reader.onAny((event) => {
    const arrived = positionOf(event);
    if (arrived) {
      position = arrived;
      return;
    }
    if (!live || event.event !== 'MarketBuy') return;
    // Payloads aren't checked against their types.
    const bought: unknown = event.Count;
    if (typeof event.Type !== 'string' || typeof bought !== 'number' || !(bought > 0)) return;
    const localised = typeof event.Type_Localised === 'string' ? event.Type_Localised : undefined;
    const names = [journalCommodityName(event.Type, localised), ...(localised ? [localised] : [])];
    const next = recordPurchase(items, names, bought);
    if (next) update(next);
    const marketId = event.MarketID as unknown;
    const purchase: GamePurchase = {
      ...((typeof marketId === 'number' || typeof marketId === 'bigint') && {
        marketId: String(marketId),
      }),
      names,
      count: bought,
    };
    const plan =
      pinned && recordPlanPurchase(pinned.plan, purchase.marketId, purchase.names, purchase.count);
    if (pinned && plan) setPinned({ ...pinned, plan });
    // The Plan page's results live in the window, which counts it against them itself.
    broadcast(IpcChannel.CommoditiesPurchase, purchase);
  });

  /** Where distances are measured from: a named system, else the commander's own position. */
  const reference = (filters: MarketFilters) =>
    referenceFor(filters.near, options.here(), position);

  ipcMain.handle(IpcChannel.CommoditiesList, () => list());
  ipcMain.handle(IpcChannel.CommoditiesPinned, () => pinned ?? null);
  ipcMain.handle(IpcChannel.CommoditiesPin, (_event, next: PinnedPlan | null) => {
    setPinned(next ?? undefined);
  });
  ipcMain.handle(IpcChannel.CommoditiesSetList, (_event, next: unknown) => {
    update(sanitize(next, newId));
  });
  ipcMain.handle(IpcChannel.CommoditiesNames, async (): Promise<string[]> => {
    try {
      const names = await commodityNames(client);
      if (names.length > 0) return names;
    } catch (error) {
      console.error('[commodities] failed to fetch commodity names', error);
    }
    return knownCommodityNames();
  });
  ipcMain.handle(
    IpcChannel.CommoditiesPickCsv,
    async (event): Promise<Outcome<{ needs: ShoppingNeed[]; fileName: string }> | undefined> => {
      const win = BrowserWindow.fromWebContents(event.sender);
      const ask: Electron.OpenDialogOptions = {
        title: 'Import a shopping list',
        defaultPath: lastFolder ?? app.getPath('downloads'),
        filters: [
          { name: 'CSV files', extensions: ['csv', 'txt', 'tsv'] },
          { name: 'All files', extensions: ['*'] },
        ],
        properties: ['openFile'],
      };
      const picked = await (win ? dialog.showOpenDialog(win, ask) : dialog.showOpenDialog(ask));
      const path = picked.filePaths[0];
      if (picked.canceled || !path) return undefined;
      lastFolder = dirname(path);
      try {
        return {
          result: {
            needs: parseShoppingCsv(await readFile(path, 'utf8')),
            fileName: basename(path),
          },
        };
      } catch (error) {
        return { error: message(error) };
      }
    },
  );
  ipcMain.handle(
    IpcChannel.CommoditiesReadScreenshots,
    async (_event, images: unknown): Promise<Outcome<ShoppingNeed[]>> => {
      const look = options.look?.();
      if (!look) return { error: "The assistant isn't running." };
      if (!Array.isArray(images) || !images.every(isImageUrl)) {
        return { error: 'Only images can be read.' };
      }
      try {
        return {
          result: await readScreenshots(look, images, AbortSignal.timeout(READ_TIMEOUT_MS)),
        };
      } catch (error) {
        return { error: message(error) };
      }
    },
  );
  ipcMain.handle(
    IpcChannel.CommoditiesSearch,
    async (_event, request: CommoditySearchRequest): Promise<Outcome<CommoditySearchResult>> => {
      try {
        const { commodities, minimums } = named(request);
        if (commodities.length === 0) return { error: 'Name a commodity to search for.' };
        const { reference: at, label } = reference(request);
        const found = await searchMarkets(client, { ...request, commodities, minimums }, at, {
          now: Date.now(),
          size: SEARCH_PAGE_SIZE,
        });
        return { result: { ...found, reference: label } };
      } catch (error) {
        return { error: message(error) };
      }
    },
  );
  ipcMain.handle(
    IpcChannel.CommoditiesSearchSell,
    async (_event, request: CommoditySellRequest): Promise<Outcome<CommoditySellResult>> => {
      try {
        const { commodities, minimums } = named(request);
        if (commodities.length === 0) return { error: 'Name a commodity to sell.' };
        const { reference: at, label } = reference(request);
        const found = await searchSellMarkets(client, { ...request, commodities, minimums }, at, {
          now: Date.now(),
          size: SEARCH_PAGE_SIZE,
        });
        return { result: { ...found, reference: label } };
      } catch (error) {
        return { error: message(error) };
      }
    },
  );
  ipcMain.handle(
    IpcChannel.CommoditiesPlan,
    async (_event, request: PlanRequest): Promise<Outcome<PlanResult>> => {
      planning?.abort();
      const controller = new AbortController();
      planning = controller;
      try {
        const needs = missingNeeds(items);
        if (needs.length === 0) return { error: 'Nothing on the shopping list is still missing.' };
        const { reference: at, label } = reference(request);
        const { plans, stations } = await planShopping(client, needs, request, at, {
          now: Date.now(),
          signal: controller.signal,
        });
        return { result: { plans, stations, reference: label, needs } };
      } catch (error) {
        return { error: controller.signal.aborted ? 'cancelled' : message(error) };
      } finally {
        if (planning === controller) planning = undefined;
      }
    },
  );
  ipcMain.handle(IpcChannel.CommoditiesPlanCancel, () => planning?.abort());
  ipcMain.handle(
    IpcChannel.CommoditiesSellPlan,
    async (_event, request: SellPlanRequest): Promise<Outcome<PlanResult>> => {
      sellPlanning?.abort();
      const controller = new AbortController();
      sellPlanning = controller;
      try {
        const needs = request.needs.flatMap((need) => {
          const commodity = typeof need.commodity === 'string' ? need.commodity.trim() : '';
          const quantity = count(need.quantity);
          return commodity !== '' && quantity > 0 ? [{ commodity, quantity }] : [];
        });
        if (needs.length === 0) return { error: 'Name a commodity to sell.' };
        const { reference: at, label } = reference(request);
        const { plans, stations } = await planSelling(client, needs, request, at, {
          now: Date.now(),
          signal: controller.signal,
        });
        return { result: { plans, stations, reference: label, needs } };
      } catch (error) {
        return { error: controller.signal.aborted ? 'cancelled' : message(error) };
      } finally {
        if (sellPlanning === controller) sellPlanning = undefined;
      }
    },
  );
  ipcMain.handle(IpcChannel.CommoditiesSellPlanCancel, () => sellPlanning?.abort());
  ipcMain.handle(IpcChannel.CommoditiesHere, async (): Promise<Outcome<SystemMarkets>> => {
    try {
      const wanted = [
        ...new Map(
          items
            .map((item) => item.commodity.trim())
            .filter(Boolean)
            .map((name) => [commodityKey(name), name]),
        ).values(),
      ];
      if (wanted.length === 0) return { error: 'The shopping list is empty.' };
      const { reference: at, label: system } = reference({ ...DEFAULT_MARKET_FILTERS, near: '' });
      const found = await systemMarkets(client, system, wanted, at);
      // Market.json is only this system's while the commander is still in it.
      const local =
        lastMarket && sameSystem(lastMarket.StarSystem, system)
          ? localMarket(lastMarket, wanted)
          : undefined;
      return {
        result: {
          system,
          stations: withLocalMarket(found, local),
          checkedAt: new Date().toISOString(),
          ...(local && local.offers.length > 0 && { localMarketId: local.marketId }),
        },
      };
    } catch (error) {
      return { error: message(error) };
    }
  });

  return {
    markLive() {
      live = true;
    },
  };
}

/** The commodities a search names, trimmed, each with its own minimum still beside it. */
function named(request: { commodities: string[]; minimums?: number[] }): {
  commodities: string[];
  minimums: number[];
} {
  const pairs = request.commodities.flatMap((name, index) => {
    const trimmed = typeof name === 'string' ? name.trim() : '';
    return trimmed === '' ? [] : [[trimmed, request.minimums?.[index] ?? 1] as const];
  });
  return {
    commodities: pairs.map(([name]) => name),
    minimums: pairs.map(([, minimum]) => minimum),
  };
}

/** The list as the window sent it, with whole, non-negative numbers. */
function sanitize(value: unknown, newId: () => string): ShoppingItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry: unknown) => {
    if (typeof entry !== 'object' || entry === null) return [];
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- each field is checked below
    const { id, commodity, needed, bought } = entry as Record<string, unknown>;
    if (typeof commodity !== 'string') return [];
    return [
      {
        id: typeof id === 'string' && id !== '' ? id : newId(),
        commodity,
        needed: count(needed),
        bought: count(bought),
      },
    ];
  });
}

function isImageUrl(value: unknown): value is string {
  return typeof value === 'string' && /^data:image\/(png|jpeg|webp|gif);base64,/.test(value);
}

function count(value: unknown): number {
  const number = Math.floor(Number(value));
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
