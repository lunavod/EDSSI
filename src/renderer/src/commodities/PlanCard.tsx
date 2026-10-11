import type { ReactNode } from 'react';

import {
  type PinnedPlan,
  planProgress,
  purchaseLeft,
  type ShoppingPlan,
} from '../../../shared/commodities';
import { useEdssi } from '../api/context';
import { CopyButton } from '../hud/CopyButton';
import { Glyph } from '../hud/Glyph';
import { Icon } from '../hud/Icon';
import { ICONS } from '../hud/icons';
import {
  formatCompact,
  formatCompactParts,
  formatNumber,
  formatShortDateTime,
} from '../journal/format';
import { useInVr } from '../vr/in-vr';
import { ageText, isStale, lyText, stationKind } from './MarketFields';

/** Where the commander is, for marking the stop they are at. */
export interface Whereabouts {
  system?: string;
  station?: string;
}

function sameName(a: string | undefined, b: string | undefined): boolean {
  return a !== undefined && b !== undefined && a.toLowerCase() === b.toLowerCase();
}

/** "12.1M" with its unit after it, in the plan's figures. */
function Credits({ value }: { value: number }) {
  const { value: figure, unit } = formatCompactParts(value);
  return (
    <span className="plan-fig" title={`${formatNumber(value, 0)} CR`}>
      <b>
        {figure}
        {unit}
      </b>{' '}
      CR
    </span>
  );
}

/**
 * One plan, its stops in the order to fly them. Once anything is bought along it (or it is the
 * pinned one), it says how much, and what has been bought is struck through. A `selling` plan's
 * purchases are sales, and its cost what they bring in.
 */
export function PlanCard({
  plan,
  title,
  action,
  pinned = false,
  where,
  titleNote,
  selling = false,
}: {
  plan: ShoppingPlan;
  title: string;
  action?: ReactNode;
  pinned?: boolean;
  where: Whereabouts;
  /** More about where the plan came from, on hover over its title. */
  titleNote?: string;
  selling?: boolean;
}) {
  const { bought, left, leftCost } = planProgress(plan);
  const counting = pinned || bought > 0;
  return (
    <section className={pinned ? 'plan panel brk pinned' : 'plan panel'} aria-label={title}>
      <header className="plan-head">
        {pinned && (
          <span className="plan-pin">
            <Glyph name="pin" />
          </span>
        )}
        <span className="plan-title" title={titleNote ?? title}>
          {title}
        </span>
        <span className="sp" />
        {counting ? (
          <>
            <span className="plan-fig">
              <b>{formatNumber(bought, 0)}</b> of {formatNumber(bought + left, 0)} t bought
            </span>
            <span className="plan-fig" title={`${formatNumber(leftCost, 0)} CR`}>
              <b>{formatCompact(leftCost)}</b> CR to go
            </span>
          </>
        ) : (
          <>
            <span className="plan-fig">
              <b>{formatNumber(plan.tonnes, 0)}</b> t
            </span>
            <Credits value={plan.cost} />
          </>
        )}
        <span className="plan-fig">
          <b>{formatNumber(plan.travelLy, plan.travelLy < 100 ? 1 : 0)}</b> ly to fly
        </span>
        {action}
      </header>
      {plan.short.length > 0 && (
        <p className="plan-short">
          <span className="ic-w">
            <Glyph name="warning" />
          </span>
          {selling ? 'No buyer for' : 'Short'}:{' '}
          {plan.short
            .map((need) => `${need.commodity} ${formatNumber(need.quantity, 0)} t`)
            .join(', ')}
        </p>
      )}
      <ol className="stops">
        {plan.stops.map((stop, index) => {
          const done = stop.purchases.every((purchase) => purchaseLeft(purchase) === 0);
          const here = sameName(stop.station.system, where.system);
          const docked = here && sameName(stop.station.name, where.station);
          const className = ['stop', here && 'cur', counting && done && 'past']
            .filter(Boolean)
            .join(' ');
          return (
            <li key={stop.station.marketId} className={className}>
              <span className="stop-n">{index + 1}</span>
              <div className="col" style={{ minWidth: 0, gap: 2 }}>
                <div className="row" style={{ gap: 10 }}>
                  <span className="stop-st" title={stop.station.name}>
                    {stop.station.name}
                  </span>
                  {here && (
                    <span title={docked ? 'Docked here' : 'In this system'}>
                      <Icon src={ICONS.marker} className="icon here-mk" />
                    </span>
                  )}
                  <span className="sp" />
                  <span className="stop-cost" title={`${formatNumber(stop.cost, 0)} CR`}>
                    {formatCompact(stop.cost)} CR
                  </span>
                </div>
                <div className="row micro stop-meta">
                  <span className="stop-sys">{stop.station.system}</span>
                  <CopyButton text={stop.station.system} />
                  <span>{lyText(stop.station.distanceLy)}</span>
                  <span>{stationKind(stop.station)}</span>
                  {stop.station.arrivalLs !== undefined && (
                    <span>{formatNumber(stop.station.arrivalLs, 0)} ls</span>
                  )}
                  <span className={isStale(stop.station.marketUpdatedAt) ? 'warn' : undefined}>
                    market {ageText(stop.station.marketUpdatedAt)}
                  </span>
                </div>
                <div className="buys">
                  {stop.purchases.map((purchase) => {
                    const still = purchaseLeft(purchase);
                    return (
                      <span
                        key={purchase.commodity}
                        className={still === 0 ? 'buy done' : 'buy'}
                        title={`${formatNumber(purchase.price, 0)} CR/t`}
                      >
                        {still === 0 && (
                          <span className="buy-ok">
                            <Glyph name="check" />
                          </span>
                        )}
                        {purchase.commodity}{' '}
                        <b>
                          {/* Once some is bought: what is still needed, then the whole in brackets. */}
                          {purchase.bought && still > 0
                            ? `${formatNumber(still, 0)} (${formatNumber(purchase.quantity, 0)}) t`
                            : `${formatNumber(purchase.quantity, 0)} t`}
                        </b>
                      </span>
                    );
                  })}
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** The pinned plan: what is left of it, with what has been bought struck through. */
export function PinnedCard({ pinned, where }: { pinned: PinnedPlan; where: Whereabouts }) {
  const edssi = useEdssi();
  // Nothing can press Unpin in a headset.
  const vr = useInVr();
  return (
    <PlanCard
      plan={pinned.plan}
      title={`Pinned · ${pinned.title}`}
      titleNote={`From ${pinned.reference}, pinned ${formatShortDateTime(pinned.pinnedAt)}`}
      pinned
      where={where}
      action={
        !vr && (
          <button type="button" className="link" onClick={() => void edssi.commodities.pin(null)}>
            Unpin
          </button>
        )
      }
    />
  );
}

/** The pinned plan docked along the bottom of a page: as tall as it needs, up to half of it. */
export function PinnedDock({
  pinned,
  where,
}: {
  pinned: PinnedPlan | undefined;
  where: Whereabouts;
}) {
  if (!pinned) return null;
  return (
    <div className="dock" aria-label="Pinned plan">
      <PinnedCard pinned={pinned} where={where} />
    </div>
  );
}
