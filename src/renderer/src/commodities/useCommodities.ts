import { createContext, useContext, useEffect, useState } from 'react';

import { DEFAULT_MARKET_FILTERS, type MarketFilters } from '../../../shared/commodities';
import type { PinnedPlan, ShoppingList } from '../../../shared/commodities';

/** The shopping list, kept up to date as it is edited and as the game buys. */
export function useShoppingList(): ShoppingList | undefined {
  const [list, setList] = useState<ShoppingList>();

  useEffect(() => {
    let active = true;
    let changed = false;
    // Subscribe first; a change that lands before the answer is newer than it.
    const unsubscribe = window.edssi.commodities.onListChange((next) => {
      changed = true;
      setList(next);
    });
    window.edssi.commodities.getList().then(
      (current) => {
        if (active && !changed) setList(current);
      },
      (error: unknown) => console.error('[commodities] failed to load the list', error),
    );
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  return list;
}

/** The plan pinned on the Plan page, kept up to date as purchases are counted along it. */
export function usePinnedPlan(): PinnedPlan | undefined {
  const [pinned, setPinned] = useState<PinnedPlan>();

  useEffect(() => {
    let active = true;
    let changed = false;
    const unsubscribe = window.edssi.commodities.onPinnedChange((next) => {
      changed = true;
      setPinned(next ?? undefined);
    });
    window.edssi.commodities.getPinned().then(
      (current) => {
        if (active && !changed) setPinned(current ?? undefined);
      },
      (error: unknown) => console.error('[commodities] failed to load the pinned plan', error),
    );
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  return pinned;
}

/** The names `useCommodityNames` fetched, handed down to every commodity input on the tab. */
export const CommodityNames = createContext<readonly string[]>([]);

/** Every commodity name the markets use, as the tab fetched them. */
export function useCommodityNameList(): readonly string[] {
  return useContext(CommodityNames);
}

/** Every commodity name the markets use, for the inputs' suggestions. Fetched once. */
export function useCommodityNames(): string[] {
  const [names, setNames] = useState<string[]>([]);
  useEffect(() => {
    let active = true;
    window.edssi.commodities.names().then(
      (found) => {
        if (active) setNames(found);
      },
      (error: unknown) => console.error('[commodities] failed to load names', error),
    );
    return () => {
      active = false;
    };
  }, []);
  return names;
}

/** A page's market filters, remembered between runs in this window's storage. */
export function useMarketFilters(
  key: string,
): [MarketFilters, (patch: Partial<MarketFilters>) => void] {
  const [filters, setFilters] = useState<MarketFilters>(() => {
    try {
      const saved = localStorage.getItem(key);
      if (saved) {
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- written below; merged over the defaults
        const read = JSON.parse(saved) as Omit<MarketFilters, 'planetary'> & {
          planetary: MarketFilters['planetary'] | boolean;
        };
        const planetary =
          typeof read.planetary === 'boolean'
            ? read.planetary
              ? 'yes'
              : 'no'
            : (read.planetary ?? DEFAULT_MARKET_FILTERS.planetary);
        return { ...DEFAULT_MARKET_FILTERS, ...read, planetary };
      }
    } catch {
      // Storage can be unavailable or hold something unreadable; the defaults do.
    }
    return DEFAULT_MARKET_FILTERS;
  });
  const update = (patch: Partial<MarketFilters>) =>
    setFilters((current) => {
      const next = { ...current, ...patch };
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {
        // Only a convenience.
      }
      return next;
    });
  return [filters, update];
}
