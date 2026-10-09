/**
 * The Commodities tab: a shopping list of commodities to buy, a search of the markets that sell
 * them (Spansh's), and a plan for buying what is still missing, in as few stops or as cheaply as
 * the markets allow.
 */

import { parseCsv } from './csv-route';
import { MATERIALS } from './recipes.generated';

/** One line of the shopping list. */
export interface ShoppingItem {
  /** Stable while the list is being edited; not kept past a restart. */
  id: string;
  /** As the market names it, e.g. "CMM Composite". */
  commodity: string;
  needed: number;
  bought: number;
}

export interface ShoppingList {
  items: ShoppingItem[];
}

/** One row of an imported CSV. */
export interface ShoppingNeed {
  commodity: string;
  quantity: number;
}

/** Names compared without case, spaces or punctuation: "Liquid oxygen" is "Liquid Oxygen". */
export function commodityKey(name: string): string {
  return name.toLowerCase().replaceAll(/[^a-z0-9]/g, '');
}

export function sameCommodity(a: string, b: string): boolean {
  return commodityKey(a) === commodityKey(b);
}

/** What is still to buy of a line. */
export function remaining(item: Pick<ShoppingItem, 'needed' | 'bought'>): number {
  return Math.max(0, item.needed - item.bought);
}

/** The lines not bought in full yet, one per commodity. */
export function missingNeeds(items: readonly ShoppingItem[]): ShoppingNeed[] {
  const needs = new Map<string, ShoppingNeed>();
  for (const item of items) {
    const left = remaining(item);
    const name = item.commodity.trim();
    if (left <= 0 || name === '') continue;
    const key = commodityKey(name);
    const known = needs.get(key);
    if (known) known.quantity += left;
    else needs.set(key, { commodity: name, quantity: left });
  }
  return [...needs.values()];
}

/** The English name of a journal commodity (`MarketBuy`'s `Type`), else its localised one. */
export function journalCommodityName(type: string, localised?: string): string {
  const known = MATERIALS[type.toLowerCase()];
  return known?.name ?? localised ?? type;
}

/** A commodity in a hold that a market will take, for the Sell page's import. */
export interface HoldItem {
  commodity: string;
  count: number;
}

/**
 * What of a hold can be sold at an ordinary market, most first: mission cargo is left out, and
 * so is stolen cargo, which only a black market takes. Items are journal names (`$steel_name;` or
 * `steel`) with their localised names, merged by commodity.
 */
export function sellableHold(
  items: readonly {
    Name?: unknown;
    Name_Localised?: unknown;
    Count?: unknown;
    Stolen?: unknown;
    MissionID?: unknown;
  }[],
): HoldItem[] {
  const merged = new Map<string, HoldItem>();
  for (const item of items) {
    if (typeof item.Name !== 'string' || item.MissionID !== undefined) continue;
    const count = Number(item.Count) - (Number(item.Stolen) || 0);
    if (!(count > 0)) continue;
    const commodity = journalCommodityName(
      item.Name.replace(/^\$/, '').replace(/_name;$/i, ''),
      typeof item.Name_Localised === 'string' ? item.Name_Localised : undefined,
    );
    const key = commodityKey(commodity);
    const known = merged.get(key);
    merged.set(key, { commodity, count: (known?.count ?? 0) + count });
  }
  return [...merged.values()].toSorted(
    (a, b) => b.count - a.count || a.commodity.localeCompare(b.commodity),
  );
}

/** Every commodity EDDiscovery knows, for when Spansh's list can't be had. */
export function knownCommodityNames(): string[] {
  return Object.values(MATERIALS)
    .filter((info) => info.category === 'Commodity')
    .map((info) => info.name)
    .toSorted((a, b) => a.localeCompare(b));
}

/**
 * Counts `count` bought against the first line of that commodity, still short if one is. Answers
 * the new list, or undefined when no line is for it.
 */
export function recordPurchase(
  items: readonly ShoppingItem[],
  names: readonly string[],
  count: number,
): ShoppingItem[] | undefined {
  const matches = (item: ShoppingItem) => names.some((name) => sameCommodity(item.commodity, name));
  const target = items.find((item) => matches(item) && remaining(item) > 0) ?? items.find(matches);
  if (!target) return undefined;
  return items.map((item) => (item === target ? { ...item, bought: item.bought + count } : item));
}

export class ShoppingCsvError extends Error {}

/**
 * Reads a CSV of two columns, commodity and quantity. A heading row is allowed (it is the one
 * whose quantity isn't a number), and so are semicolons or tabs between the columns and thousands
 * separators in the numbers. The same commodity twice is added up.
 */
export function parseShoppingCsv(text: string): ShoppingNeed[] {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const delimiter = firstLine.includes('\t')
    ? '\t'
    : !firstLine.includes(',') && firstLine.includes(';')
      ? ';'
      : ',';
  const needs: ShoppingNeed[] = [];
  const rows = parseCsv(text, delimiter).filter((row) => row.some((cell) => cell.trim() !== ''));
  for (const [index, row] of rows.entries()) {
    const commodity = (row[0] ?? '').trim();
    const quantity = parseQuantity(row[1]);
    if (quantity === undefined) {
      if (index === 0) continue;
      throw new ShoppingCsvError(
        `Line ${index + 1}: "${(row[1] ?? '').trim()}" is not a quantity.`,
      );
    }
    if (commodity === '') throw new ShoppingCsvError(`Line ${index + 1} names no commodity.`);
    const known = needs.find((need) => sameCommodity(need.commodity, commodity));
    if (known) known.quantity += quantity;
    else needs.push({ commodity, quantity });
  }
  if (needs.length === 0) {
    throw new ShoppingCsvError('It has no rows of a commodity and a quantity.');
  }
  return needs;
}

function parseQuantity(cell: string | undefined): number | undefined {
  const cleaned = (cell ?? '').replaceAll(/[\s,'_]/g, '').replace(/t$/i, '');
  if (!/^\d+$/.test(cleaned)) return undefined;
  return Number(cleaned);
}

/**
 * The list after an import: the imported lines alone, or added to what is there (a commodity
 * already listed needs that much more).
 */
export function mergeShopping(
  items: readonly ShoppingItem[],
  imported: readonly ShoppingNeed[],
  mode: 'replace' | 'add',
  newId: () => string,
): ShoppingItem[] {
  const fresh = (need: ShoppingNeed): ShoppingItem => ({
    id: newId(),
    commodity: need.commodity,
    needed: need.quantity,
    bought: 0,
  });
  if (mode === 'replace') return imported.map(fresh);
  const merged = items.map((item) => ({ ...item }));
  for (const need of imported) {
    const known = merged.find((item) => sameCommodity(item.commodity, need.commodity));
    if (known) known.needed += need.quantity;
    else merged.push(fresh(need));
  }
  return merged;
}

/**
 * Planetary ports and settlements: counted like any market, left out, or (on the Plan page) used
 * only for what no orbital market has.
 */
export type PlanetaryMode = 'yes' | 'minimise' | 'no';

/** The largest pad a ship needs; `any` asks for none. */
export type PadNeed = 'any' | 'medium' | 'large';

/** What narrows the markets searched, on both the Search and the Plan page. */
export interface MarketFilters {
  /** A system name; empty for where the commander is. */
  near: string;
  maxDistanceLy: number;
  pad: PadNeed;
  carriers: boolean;
  planetary: PlanetaryMode;
  /** Stations further than this from the arrival point are left out; 0 for any distance. */
  maxArrivalLs: number;
  /** Markets reported longer ago than this are left out; 0 for any age. */
  maxAgeDays: number;
}

export interface CommoditySearchRequest extends MarketFilters {
  /** Stations must sell all of these. */
  commodities: string[];
  /** The supply each needs, in the same order; 1 where missing. */
  minimums: number[];
  /** By price is by the first commodity's. */
  sort: 'distance' | 'price';
  page: number;
}

/** Stations that buy commodities: the Sell page's search. */
export interface CommoditySellRequest extends MarketFilters {
  /** Stations must buy all of these. */
  commodities: string[];
  /** The demand each needs (the tonnes to sell), in the same order; 1 where missing. */
  minimums: number[];
  /** By price is by the first commodity's, the best first. */
  sort: 'distance' | 'price';
  page: number;
}

export interface MarketOffer {
  commodity: string;
  buyPrice: number;
  supply: number;
}

/** What a station pays for a commodity, and how much of it it wants. */
export interface MarketBid {
  commodity: string;
  sellPrice: number;
  demand: number;
}

/** A station with a market, without what it trades. */
export interface MarketPlace {
  marketId: string;
  name: string;
  type: string;
  system: string;
  /** From the reference searched around. */
  distanceLy: number;
  arrivalLs?: number;
  pad?: 'S' | 'M' | 'L';
  planetary: boolean;
  carrier: boolean;
  coords?: [x: number, y: number, z: number];
  marketUpdatedAt?: string;
}

export interface MarketStation extends MarketPlace {
  /** Only the commodities asked about, with stock. */
  offers: MarketOffer[];
}

export interface SellStation extends MarketPlace {
  /** Only the commodities asked about, with demand. */
  bids: MarketBid[];
}

export interface CommoditySearchResult {
  stations: MarketStation[];
  /** How many match in all; Spansh stops counting at 10,000. */
  total: number;
  /** What the distances are from. */
  reference: string;
}

export interface CommoditySellResult {
  stations: SellStation[];
  /** How many match in all; Spansh stops counting at 10,000. */
  total: number;
  /** What the distances are from. */
  reference: string;
}

export type PlanRequest = MarketFilters;

/** Ways to sell `needs` (commodity and tonnes) across as many markets as it takes. */
export interface SellPlanRequest extends MarketFilters {
  needs: ShoppingNeed[];
}

export interface PlanPurchase {
  commodity: string;
  quantity: number;
  price: number;
  /** On a pinned plan, what has been bought of it in the game since it was pinned. */
  bought?: number;
}

export interface PlanStop {
  station: MarketStation;
  purchases: PlanPurchase[];
  tonnes: number;
  cost: number;
}

/** `cheapest` is the best price: the lowest buying, the highest selling. */
export type PlanKind = 'fewest-stops' | 'cheapest';

export interface ShoppingPlan {
  kind: PlanKind;
  /** A fewest-stops plan that buys at the same markets as the cheapest would, for no more. */
  cheapest?: boolean;
  /** In the order to fly them, from the reference. */
  stops: PlanStop[];
  tonnes: number;
  cost: number;
  /** Straight-line distance from the reference through every stop. */
  travelLy: number;
  /** What no market searched had enough of. */
  short: ShoppingNeed[];
}

export interface PlanResult {
  plans: ShoppingPlan[];
  reference: string;
  /** Markets looked at. */
  stations: number;
  /** What was being planned for. */
  needs: ShoppingNeed[];
}

/** The one plan kept on the Plan page, across restarts, counting what is bought along it. */
export interface PinnedPlan {
  plan: ShoppingPlan;
  /** As its card was titled when pinned, e.g. "Fewest stops · 2 stops". */
  title: string;
  /** What its distances are from. */
  reference: string;
  pinnedAt: string;
}

/** A purchase made in the game, as the window is told of it to count against its plans. */
export interface GamePurchase {
  /** The game's `MarketID`, as Spansh's `market_id` is written. */
  marketId?: string;
  /** The commodity's English name, and the journal's localised one. */
  names: string[];
  count: number;
}

/** What is still to buy of a planned purchase. */
export function purchaseLeft(purchase: PlanPurchase): number {
  return Math.max(0, purchase.quantity - (purchase.bought ?? 0));
}

/** Tonnes bought along a plan (none counted past what each purchase wanted), and what is left. */
export function planProgress(plan: ShoppingPlan): {
  bought: number;
  left: number;
  leftCost: number;
} {
  let bought = 0;
  let left = 0;
  let leftCost = 0;
  for (const stop of plan.stops) {
    for (const purchase of stop.purchases) {
      const still = purchaseLeft(purchase);
      bought += purchase.quantity - still;
      left += still;
      leftCost += still * purchase.price;
    }
  }
  return { bought, left, leftCost };
}

/**
 * Counts a purchase in the game against a plan: first against that commodity at the stop it was
 * bought at, then at the plan's other stops in order. What is left over goes on the first line
 * for it, so buying more than planned still shows. Answers the new plan, or undefined when the
 * plan doesn't buy that commodity anywhere.
 */
export function recordPlanPurchase(
  plan: ShoppingPlan,
  marketId: string | undefined,
  names: readonly string[],
  count: number,
): ShoppingPlan | undefined {
  const stops = plan.stops.map((stop) => ({
    ...stop,
    purchases: stop.purchases.map((purchase) => ({ ...purchase })),
  }));
  const lines = [
    ...stops.filter((stop) => stop.station.marketId === marketId),
    ...stops.filter((stop) => stop.station.marketId !== marketId),
  ].flatMap((stop) =>
    stop.purchases.filter((purchase) =>
      names.some((name) => sameCommodity(purchase.commodity, name)),
    ),
  );
  if (lines.length === 0) return undefined;
  let rest = count;
  for (const line of lines) {
    const take = Math.min(rest, purchaseLeft(line));
    line.bought = (line.bought ?? 0) + take;
    rest -= take;
  }
  if (rest > 0) lines[0]!.bought = (lines[0]!.bought ?? 0) + rest;
  return { ...plan, stops };
}

/** The markets in the commander's system that sell anything on the shopping list. */
export interface SystemMarkets {
  system: string;
  /** Each with its offers of commodities on the list. */
  stations: MarketStation[];
  /** When it was looked up (ISO 8601). */
  checkedAt: string;
  /** The last market opened in the game here, read from its Market.json rather than Spansh. */
  localMarketId?: string;
}

/** How many plans that start at a different market are offered for the fewest stops. */
const FEWEST_STOP_OPTIONS = 3;

/**
 * A buyer's market as a seller's, so the purchase planner plans sales: its demand stands for
 * supply and what it pays for the price.
 */
export function asOffering({ bids, ...place }: SellStation): MarketStation {
  return {
    ...place,
    offers: bids.map((bid) => ({
      commodity: bid.commodity,
      buyPrice: bid.sellPrice,
      supply: bid.demand,
    })),
  };
}

/**
 * Ways to sell `needs` at `stations` when no one market takes it all: the purchase plans, with
 * each plan's purchases being sales, its `cost` what they bring in, `short` what no market wants,
 * and the `cheapest` plan the one selling each commodity where it pays most.
 */
export function planSales(
  needs: readonly ShoppingNeed[],
  stations: readonly SellStation[],
): ShoppingPlan[] {
  return planPurchases(needs, stations.map(asOffering), { highest: true });
}

/**
 * Ways to buy `needs` at `stations`: a few plans that buy as much as they can at each stop (so the
 * fewest stops), each starting at a different market, and one that buys each commodity where it is
 * cheapest, whatever the stops. With `highest`, where it costs most: how sales are planned.
 */
export function planPurchases(
  needs: readonly ShoppingNeed[],
  stations: readonly MarketStation[],
  options: { minimisePlanetary?: boolean; highest?: boolean } = {},
): ShoppingPlan[] {
  const highest = options.highest ?? false;
  if (options.minimisePlanetary) return minimisingPlanetary(needs, stations);
  const wanted = needs.filter((need) => need.quantity > 0);
  if (wanted.length === 0) return [];

  const plans: ShoppingPlan[] = [];
  const seen = new Set<string>();
  const firsts = stations
    .map((station) => ({ station, covers: coverage(station, quantities(wanted)) }))
    .filter((candidate) => candidate.covers > 0)
    .toSorted((a, b) => b.covers - a.covers || a.station.distanceLy - b.station.distanceLy)
    .slice(0, FEWEST_STOP_OPTIONS);
  for (const { station } of firsts) {
    const plan = greedyPlan(wanted, stations, station);
    const key = marketsOf(plan);
    if (seen.has(key)) continue;
    seen.add(key);
    plans.push(plan);
  }
  plans.sort(
    (a, b) =>
      shortTonnes(a) - shortTonnes(b) || a.stops.length - b.stops.length || a.travelLy - b.travelLy,
  );

  // Not again when a plan above already buys at the same markets for no more; that one says so.
  const cheapest = cheapestPlan(wanted, stations, highest);
  const same = plans.find(
    (plan) =>
      marketsOf(plan) === marketsOf(cheapest) &&
      (highest ? plan.cost >= cheapest.cost : plan.cost <= cheapest.cost),
  );
  if (same) same.cheapest = true;
  else if (cheapest.stops.length > 0) plans.push(cheapest);
  return plans;
}

/**
 * Plans that buy all they can at orbital markets, and only what none of them has at planetary
 * ones: each orbital plan is topped up by the planetary plan of the same kind for its shortfall.
 */
function minimisingPlanetary(
  needs: readonly ShoppingNeed[],
  stations: readonly MarketStation[],
): ShoppingPlan[] {
  const orbital = stations.filter((station) => !station.planetary);
  const planetary = stations.filter((station) => station.planetary);
  const plans = planPurchases(needs, orbital);
  if (plans.length === 0) return planPurchases(needs, planetary);
  return plans.map((plan) => {
    if (plan.short.length === 0) return plan;
    const topUps = planPurchases(plan.short, planetary);
    const topUp =
      plan.kind === 'cheapest'
        ? topUps.find((candidate) => candidate.kind === 'cheapest' || candidate.cheapest)
        : topUps[0];
    if (!topUp) return plan;
    const stops = tour([...plan.stops, ...topUp.stops]);
    return {
      ...plan,
      stops,
      tonnes: plan.tonnes + topUp.tonnes,
      cost: plan.cost + topUp.cost,
      travelLy: travel(stops),
      short: topUp.short,
    };
  });
}

function marketsOf(plan: ShoppingPlan): string {
  return plan.stops
    .map((stop) => stop.station.marketId)
    .toSorted()
    .join();
}

function quantities(needs: readonly ShoppingNeed[]): Map<string, number> {
  return new Map(needs.map((need) => [commodityKey(need.commodity), need.quantity]));
}

/** Tonnes of what is still wanted a station could supply. */
function coverage(station: MarketStation, left: ReadonlyMap<string, number>): number {
  let tonnes = 0;
  for (const offer of station.offers) {
    tonnes += Math.min(offer.supply, left.get(commodityKey(offer.commodity)) ?? 0);
  }
  return tonnes;
}

/** Buys all it can at `first`, then at whichever market supplies most of the rest, and so on. */
function greedyPlan(
  needs: readonly ShoppingNeed[],
  stations: readonly MarketStation[],
  first: MarketStation,
): ShoppingPlan {
  const left = quantities(needs);
  const stops: PlanStop[] = [];
  const used = new Set<string>();
  let next: MarketStation | undefined = first;
  while (next) {
    used.add(next.marketId);
    const stop = buyAt(next, left);
    if (stop.tonnes > 0) stops.push(stop);
    next = undefined;
    let best = 0;
    for (const station of stations) {
      if (used.has(station.marketId)) continue;
      const covers = coverage(station, left);
      if (covers > best || (covers === best && covers > 0 && next && nearer(station, next))) {
        best = covers;
        next = station;
      }
    }
  }
  return finish('fewest-stops', stops, needs, left);
}

function nearer(a: MarketStation, b: MarketStation): boolean {
  return a.distanceLy < b.distanceLy;
}

/** Takes everything wanted a station has, cheapest first when it lists a commodity twice. */
function buyAt(station: MarketStation, left: Map<string, number>): PlanStop {
  const purchases: PlanPurchase[] = [];
  for (const offer of station.offers) {
    const key = commodityKey(offer.commodity);
    const quantity = Math.min(offer.supply, left.get(key) ?? 0);
    if (quantity <= 0) continue;
    left.set(key, (left.get(key) ?? 0) - quantity);
    purchases.push({ commodity: offer.commodity, quantity, price: offer.buyPrice });
  }
  return stopOf(station, purchases);
}

function stopOf(station: MarketStation, purchases: PlanPurchase[]): PlanStop {
  return {
    station,
    purchases,
    tonnes: purchases.reduce((sum, purchase) => sum + purchase.quantity, 0),
    cost: purchases.reduce((sum, purchase) => sum + purchase.quantity * purchase.price, 0),
  };
}

/**
 * Each commodity from the cheapest markets with stock (the dearest, with `highest`), nearest first
 * at the same price.
 */
function cheapestPlan(
  needs: readonly ShoppingNeed[],
  stations: readonly MarketStation[],
  highest: boolean,
): ShoppingPlan {
  const sign = highest ? -1 : 1;
  const left = quantities(needs);
  const byStation = new Map<string, { station: MarketStation; purchases: PlanPurchase[] }>();
  for (const need of needs) {
    const key = commodityKey(need.commodity);
    const offers = stations
      .flatMap((station) =>
        station.offers
          .filter((offer) => commodityKey(offer.commodity) === key && offer.supply > 0)
          .map((offer) => ({ station, offer })),
      )
      .toSorted(
        (a, b) =>
          sign * (a.offer.buyPrice - b.offer.buyPrice) ||
          a.station.distanceLy - b.station.distanceLy,
      );
    for (const { station, offer } of offers) {
      const want = left.get(key) ?? 0;
      if (want <= 0) break;
      const quantity = Math.min(want, offer.supply);
      left.set(key, want - quantity);
      const at = byStation.get(station.marketId) ?? { station, purchases: [] };
      at.purchases.push({ commodity: offer.commodity, quantity, price: offer.buyPrice });
      byStation.set(station.marketId, at);
    }
  }
  const stops = [...byStation.values()].map(({ station, purchases }) => stopOf(station, purchases));
  return finish('cheapest', stops, needs, left);
}

function finish(
  kind: PlanKind,
  stops: PlanStop[],
  needs: readonly ShoppingNeed[],
  left: ReadonlyMap<string, number>,
): ShoppingPlan {
  const ordered = tour(stops);
  return {
    kind,
    stops: ordered,
    tonnes: ordered.reduce((sum, stop) => sum + stop.tonnes, 0),
    cost: ordered.reduce((sum, stop) => sum + stop.cost, 0),
    travelLy: travel(ordered),
    short: needs.flatMap((need) => {
      const quantity = left.get(commodityKey(need.commodity)) ?? 0;
      return quantity > 0 ? [{ commodity: need.commodity, quantity }] : [];
    }),
  };
}

function shortTonnes(plan: ShoppingPlan): number {
  return plan.short.reduce((sum, need) => sum + need.quantity, 0);
}

/**
 * The stops in the order to fly them: the nearest to the reference first, then always the nearest
 * to the last. Stations in one system go together, as they are no distance apart.
 */
function tour(stops: readonly PlanStop[]): PlanStop[] {
  const left = [...stops];
  const ordered: PlanStop[] = [];
  let at: PlanStop | undefined;
  while (left.length > 0) {
    let bestIndex = 0;
    let best = Infinity;
    for (const [index, stop] of left.entries()) {
      const distance = at ? between(at.station, stop.station) : stop.station.distanceLy;
      if (distance < best) {
        best = distance;
        bestIndex = index;
      }
    }
    at = left.splice(bestIndex, 1)[0]!;
    ordered.push(at);
  }
  return ordered;
}

function travel(stops: readonly PlanStop[]): number {
  let total = 0;
  for (const [index, stop] of stops.entries()) {
    total +=
      index === 0 ? stop.station.distanceLy : between(stops[index - 1]!.station, stop.station);
  }
  return total;
}

/** Light years between two stations; without coordinates, as far as their distances differ. */
export function between(a: MarketStation, b: MarketStation): number {
  if (a.system === b.system) return 0;
  if (a.coords && b.coords) {
    return Math.hypot(
      a.coords[0] - b.coords[0],
      a.coords[1] - b.coords[1],
      a.coords[2] - b.coords[2],
    );
  }
  return Math.abs(a.distanceLy - b.distanceLy);
}

/** The Search and Plan pages start from this: within 1,000 ly of Sol. */
export const DEFAULT_MARKET_FILTERS: MarketFilters = {
  near: 'Sol',
  maxDistanceLy: 1000,
  pad: 'any',
  carriers: false,
  planetary: 'yes',
  maxArrivalLs: 0,
  maxAgeDays: 30,
};
