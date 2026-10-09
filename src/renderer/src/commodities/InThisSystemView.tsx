import type { ReactNode } from 'react';

import {
  commodityKey,
  remaining,
  type ShoppingList,
  type SystemMarkets,
} from '../../../shared/commodities';
import { Glyph } from '../hud/Glyph';
import { formatNumber, formatShortTime } from '../journal/format';
import { ageText, isStale, stationKind } from './MarketFields';

/** A look at this system's markets: what came back, or why it didn't. */
export interface HereCheck {
  result?: SystemMarkets;
  problem?: string;
  busy: boolean;
}

/**
 * Asks which markets in the current system sell anything on the list. Only when pressed: most
 * jumps are to systems with nothing to buy, and Spansh needn't be asked about each. The last
 * market opened in the game here is read from its Market.json instead.
 */
export function checkHere(set: (update: (current: HereCheck) => HereCheck) => void): void {
  set((current) => ({ ...current, busy: true, problem: undefined }));
  void window.edssi.commodities.here().then(
    (outcome) =>
      set((current) =>
        'error' in outcome
          ? { ...current, busy: false, problem: outcome.error }
          : { busy: false, result: outcome.result },
      ),
    (error: unknown) => set((current) => ({ ...current, busy: false, problem: String(error) })),
  );
}

/** "Checked 21:04 · 2 markets" and the button, for the row of pages. */
export function HereActions({
  check,
  canCheck,
  onCheck,
}: {
  check: HereCheck;
  canCheck: boolean;
  onCheck: () => void;
}) {
  const { result } = check;
  return (
    <>
      {result && (
        <span className="micro">
          Checked {formatShortTime(result.checkedAt)} · {result.stations.length}{' '}
          {result.stations.length === 1 ? 'market' : 'markets'}
        </span>
      )}
      <button
        type="button"
        className="btn ghost sm"
        disabled={check.busy || !canCheck}
        onClick={onCheck}
      >
        <span className="ic-w">
          <Glyph name="reload" />
        </span>
        {check.busy ? 'Checking…' : result ? 'Check again' : 'Check'}
      </button>
    </>
  );
}

/** Which commodities on the shopping list the markets in the current system sell. */
export function InThisSystemView({
  list,
  here,
  check,
  dock,
}: {
  list: ShoppingList | undefined;
  here: string | undefined;
  check: HereCheck;
  /** Docked along the bottom: the pinned plan. */
  dock?: ReactNode;
}) {
  const { result, problem } = check;
  const items = list?.items.filter((item) => item.commodity.trim() !== '') ?? [];
  const left = result && here !== undefined && result.system.toLowerCase() !== here.toLowerCase();
  const rows = result ? commodityRows(items, result) : [];
  const sold = rows.filter((row) => row.offers.length > 0);
  const notSold = rows.filter((row) => row.offers.length === 0);

  return (
    <div className="comm-page">
      {problem && (
        <p className="note danger comm-problem" role="alert">
          <span className="ic-w">
            <Glyph name="warning" />
          </span>
          {problem}
        </p>
      )}
      {left && (
        <p className="note comm-problem">
          <span className="ic-w">
            <Glyph name="warning" />
          </span>
          You have left {result.system} since; check again for {here}.
        </p>
      )}
      <div className="dock-top">
        {!result ? (
          <p className="comm-empty">
            {items.length === 0
              ? 'The shopping list is empty.'
              : `Check which commodities on the list the markets in ${here ?? 'this system'} sell.`}
          </p>
        ) : result.stations.length === 0 ? (
          <p className="comm-empty">No market in {result.system} sells anything on the list.</p>
        ) : (
          <>
            {sold.length > 0 && (
              <table className="tbl roomy">
                <thead>
                  <tr>
                    <th scope="col">Commodity</th>
                    <th scope="col" className="v">
                      Left
                    </th>
                    <th scope="col" style={{ width: '100%' }}>
                      Where, cheapest first
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sold.map((row) => (
                    <tr key={row.key} className={row.left === 0 ? 'past' : undefined}>
                      <td>{row.commodity}</td>
                      <td className="v">
                        {row.left === 0 ? '—' : `${formatNumber(row.left, 0)} t`}
                      </td>
                      <td>
                        <div className="offers">
                          {row.offers.map((offer) => {
                            const live =
                              offer.station.marketId === result.localMarketId &&
                              offer.station.marketUpdatedAt !== undefined;
                            return (
                              <span
                                key={offer.station.marketId}
                                className={live ? 'where live' : 'where'}
                                title={stationKind(offer.station)}
                              >
                                <b>{offer.station.name}</b>
                                {formatNumber(offer.price, 0)} CR · {formatNumber(offer.supply, 0)}{' '}
                                t
                                {offer.station.arrivalLs !== undefined &&
                                  ` · ${formatNumber(offer.station.arrivalLs, 0)} ls`}
                                {' · '}
                                {live ? (
                                  <span className="good">
                                    seen {formatShortTime(offer.station.marketUpdatedAt!)}
                                  </span>
                                ) : (
                                  <span
                                    className={
                                      isStale(offer.station.marketUpdatedAt) ? 'warn' : 'muted'
                                    }
                                  >
                                    {ageText(offer.station.marketUpdatedAt)}
                                  </span>
                                )}
                              </span>
                            );
                          })}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {notSold.length > 0 && (
              <p className="dim" style={{ fontSize: 14.5, marginTop: 8 }}>
                Not here: {notSold.map((row) => row.commodity).join(', ')}
              </p>
            )}
          </>
        )}
      </div>
      {dock}
    </div>
  );
}

interface CommodityRow {
  key: string;
  commodity: string;
  left: number;
  offers: { station: SystemMarkets['stations'][number]; price: number; supply: number }[];
}

/** One row per commodity on the list, still wanted first, with where it is sold here. */
function commodityRows(
  items: NonNullable<ShoppingList['items']>,
  result: SystemMarkets,
): CommodityRow[] {
  const rows = new Map<string, CommodityRow>();
  for (const item of items) {
    const key = commodityKey(item.commodity);
    const row = rows.get(key);
    if (row) row.left += remaining(item);
    else rows.set(key, { key, commodity: item.commodity, left: remaining(item), offers: [] });
  }
  for (const station of result.stations) {
    for (const offer of station.offers) {
      rows.get(commodityKey(offer.commodity))?.offers.push({
        station,
        price: offer.buyPrice,
        supply: offer.supply,
      });
    }
  }
  for (const row of rows.values()) row.offers.sort((a, b) => a.price - b.price);
  return [...rows.values()].toSorted((a, b) => Number(b.left > 0) - Number(a.left > 0));
}
