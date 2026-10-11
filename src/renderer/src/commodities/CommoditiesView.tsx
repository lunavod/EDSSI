import { useMemo, useState } from 'react';

import type { CarriersSnapshot } from '../../../shared/carriers';
import { remaining, sellableHold, type ShoppingList } from '../../../shared/commodities';
import type { CargoEvent } from '../../../shared/journal-events.generated';
import { useEdssi } from '../api/context';
import { Tabs } from '../hud/Tabs';
import { formatNumber } from '../journal/format';
import { checkHere, type HereCheck, HereActions, InThisSystemView } from './InThisSystemView';
import { MarketSearchView } from './MarketSearchView';
import { PinnedDock, type Whereabouts } from './PlanCard';
import type { HoldSource } from './SellImport';
import { ShoppingListView } from './ShoppingListView';
import { ShoppingPlanView } from './ShoppingPlanView';
import { CommodityNames, useCommodityNames, usePinnedPlan } from './useCommodities';

type SubTab = 'list' | 'here' | 'search' | 'sell' | 'plan';

/** Commodities on the list still to buy: the count on the module's tab and the list's. */
export function commoditiesLeft(list: ShoppingList | undefined): number {
  return (
    list?.items.filter((item) => item.commodity.trim() !== '' && remaining(item) > 0).length ?? 0
  );
}

/**
 * The holds the Sell page can sell from: the ship's, from Cargo.json (while it is the ship's, not
 * the SRV's), and each carrier's, as far as the journal has followed it.
 */
export function holdSources(
  cargo: CargoEvent | undefined,
  carriers: CarriersSnapshot | undefined,
): HoldSource[] {
  const ship: HoldSource = {
    id: 'ship',
    label: 'Ship',
    items: cargo?.Vessel === 'Ship' ? sellableHold(cargo.Inventory ?? []) : [],
    ...(cargo &&
      cargo.Vessel !== 'Ship' && { note: "In the SRV; the ship's hold shows once back aboard." }),
  };
  const fleet = (carriers?.carriers ?? []).map((carrier): HoldSource => {
    const off = carrier.unaccounted ?? 0;
    return {
      id: carrier.carrierId,
      label: carrier.name ?? (carrier.kind === 'own' ? 'Carrier' : 'Squadron carrier'),
      items: sellableHold(
        carrier.cargo.map((item) => ({
          Name: item.type,
          Name_Localised: item.name,
          Count: item.count,
        })),
      ),
      ...(off !== 0 && {
        note: `Only what your own journals moved; ${formatNumber(Math.abs(off), 0)} t ${
          off > 0 ? 'more are aboard' : 'of these have gone'
        } that they don't account for.`,
      }),
    };
  });
  return [ship, ...fleet];
}

/**
 * The Commodities module: a shopping list (bought counts go up as the game buys), the markets in
 * this system, searches of the markets that sell commodities and of those that buy them, and a
 * plan for buying what the list still misses. A pinned plan is docked under the list and this system's markets.
 */
export function CommoditiesView({
  list,
  where,
  cargo,
  carriers,
}: {
  list: ShoppingList | undefined;
  where: Whereabouts;
  /** Cargo.json, for selling from the ship's hold. */
  cargo?: CargoEvent;
  carriers?: CarriersSnapshot;
}) {
  const edssi = useEdssi();
  const [tab, setTab] = useState<SubTab>('list');
  const [hereCheck, setHereCheck] = useState<HereCheck>({ busy: false });
  const names = useCommodityNames();
  const pinned = usePinnedPlan();
  const left = commoditiesLeft(list);
  const dock = <PinnedDock pinned={pinned} where={where} />;
  const holds = useMemo(() => holdSources(cargo, carriers), [cargo, carriers]);
  const listed = list?.items.some((item) => item.commodity.trim() !== '') ?? false;
  return (
    <CommodityNames.Provider value={names}>
      <Tabs
        tabs={[
          { id: 'list', label: 'Shopping list', badge: left > 0 ? `${left} left` : undefined },
          { id: 'here', label: 'In this system' },
          { id: 'search', label: 'Search' },
          { id: 'sell', label: 'Sell' },
          { id: 'plan', label: 'Shopping plan', badge: pinned ? 'pinned' : undefined },
        ]}
        active={tab}
        onSelect={setTab}
        sub
        ariaLabel="Commodities"
        actions={
          tab === 'here' && (
            <HereActions
              check={hereCheck}
              canCheck={listed}
              onCheck={() => checkHere(edssi, setHereCheck)}
            />
          )
        }
      />
      {/* All stay mounted, so each page keeps its form and results. */}
      <div className="comm-page" hidden={tab !== 'list'}>
        <ShoppingListView list={list} onPlan={() => setTab('plan')} dock={dock} />
      </div>
      <div className="comm-page" hidden={tab !== 'here'}>
        <InThisSystemView list={list} here={where.system} check={hereCheck} dock={dock} />
      </div>
      <div className="comm-page" hidden={tab !== 'search'}>
        <MarketSearchView where={where} side="buy" />
      </div>
      <div className="comm-page" hidden={tab !== 'sell'}>
        <MarketSearchView where={where} side="sell" holds={holds} />
      </div>
      <div className="comm-page" hidden={tab !== 'plan'}>
        <ShoppingPlanView list={list} where={where} pinned={pinned} />
      </div>
    </CommodityNames.Provider>
  );
}
