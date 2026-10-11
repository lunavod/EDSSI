import { type FormEvent, useEffect, useState } from 'react';

import {
  missingNeeds,
  type PinnedPlan,
  type PlanResult,
  recordPlanPurchase,
  type ShoppingList,
  type ShoppingPlan,
} from '../../../shared/commodities';
import { useEdssi } from '../api/context';
import { Glyph } from '../hud/Glyph';
import { formatNumber } from '../journal/format';
import { MarketFields } from './MarketFields';
import { PlanCard, type Whereabouts } from './PlanCard';
import { useMarketFilters } from './useCommodities';

/**
 * Ways to buy what the shopping list is still missing, from the markets Spansh knows around a
 * system: a few that buy as much as they can at each stop, each starting somewhere else, and one
 * that buys everything where it is cheapest.
 */
export function ShoppingPlanView({
  list,
  where,
  pinned,
}: {
  list: ShoppingList | undefined;
  where: Whereabouts;
  pinned: PinnedPlan | undefined;
}) {
  const edssi = useEdssi();
  const [filters, setFilters] = useMarketFilters('edssi.commodities.plan');
  const [result, setResult] = useState<PlanResult>();
  const [problem, setProblem] = useState<string>();
  const [busy, setBusy] = useState(false);

  // What is bought in the game counts against every plan shown, not only the pinned one, so a
  // plan can be followed straight from the results.
  useEffect(
    () =>
      edssi.commodities.onPurchase(({ marketId, names, count }) =>
        setResult((current) =>
          current
            ? {
                ...current,
                plans: current.plans.map(
                  (plan) => recordPlanPurchase(plan, marketId, names, count) ?? plan,
                ),
              }
            : current,
        ),
      ),
    [edssi],
  );

  const pin = (plan: ShoppingPlan, title: string) =>
    void edssi.commodities.pin({
      plan,
      title,
      reference: result?.reference ?? '',
      pinnedAt: new Date().toISOString(),
    });

  const missing = missingNeeds(list?.items ?? []);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (busy || missing.length === 0) return;
    setBusy(true);
    setProblem(undefined);
    void edssi.commodities
      .plan(filters)
      .then((outcome) => {
        if ('error' in outcome) {
          if (outcome.error !== 'cancelled') setProblem(outcome.error);
        } else setResult(outcome.result);
      })
      .finally(() => setBusy(false));
  };

  const tonnes = missing.reduce((sum, need) => sum + need.quantity, 0);
  return (
    <div className="comm-page">
      {/* The number inputs clamp themselves when they are left. */}
      <form className="panel pad" style={{ flex: 'none' }} onSubmit={submit} noValidate>
        <div className="row" style={{ gap: 14, marginBottom: 10 }}>
          <span
            className="sec-title"
            style={{ fontSize: 19 }}
            title={missing
              .map((need) => `${need.commodity} ${formatNumber(need.quantity, 0)} t`)
              .join('\n')}
          >
            {missing.length === 0
              ? 'Nothing missing'
              : `Missing ${formatNumber(tonnes, 0)} t of ${missing.length}`}
          </span>
          <span className="sp" />
          {busy && (
            <span className="form-status">
              Asking Spansh about {missing.length * 2 + 1} searches…
            </span>
          )}
        </div>
        <MarketFields filters={filters} onChange={setFilters} here={where.system} minimise>
          {busy ? (
            <button
              type="button"
              className="btn danger"
              onClick={() => void edssi.commodities.cancelPlan()}
            >
              <span className="ic-w">
                <Glyph name="stop" />
              </span>
              Stop
            </button>
          ) : (
            <button type="submit" className="btn primary" disabled={missing.length === 0}>
              <span className="ic-w">
                <Glyph name="route" />
              </span>
              Plan
            </button>
          )}
        </MarketFields>
      </form>
      {problem && (
        <p className="note danger comm-problem" role="alert">
          <span className="ic-w">
            <Glyph name="warning" />
          </span>
          {problem}
        </p>
      )}
      {result &&
        (result.plans.length === 0 ? (
          <p className="comm-empty">
            None of the {result.stations} markets found sells any of it. Try further out, older
            markets or carriers.
          </p>
        ) : (
          <div className="plans">
            <p className="plans-note">
              From {result.reference}, over {formatNumber(result.stations, 0)} markets. Stock is as
              last reported; check it on arrival.
            </p>
            {result.plans.map((plan, index) => (
              <PlanCard
                key={`${plan.kind} ${plan.stops.map((stop) => stop.station.marketId).join()}`}
                plan={plan}
                title={planTitle(plan, index)}
                where={where}
                action={
                  pinned && samePlan(pinned.plan, plan) ? (
                    <span className="tag solid" title="This is the plan docked under the list">
                      Pinned
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="btn ghost sm"
                      title="Dock this plan under the shopping list, counting what you buy along it"
                      onClick={() => pin(plan, planTitle(plan, index))}
                    >
                      {pinned ? 'Pin instead' : 'Pin'}
                    </button>
                  )
                }
              />
            ))}
          </div>
        ))}
    </div>
  );
}

/**
 * Whether two plans are the same one: the same kind, stopping at the same markets for the same
 * goods. Purchases counted along the pinned copy since don't make it another plan.
 */
function samePlan(a: ShoppingPlan, b: ShoppingPlan): boolean {
  return planShape(a) === planShape(b);
}

/** A plan's kind, and the goods it buys at each market, as one string. */
function planShape(plan: ShoppingPlan): string {
  return `${plan.kind} ${plan.stops
    .map(
      (stop) =>
        `${stop.station.marketId}:${stop.purchases.map((buy) => `${buy.commodity}=${buy.quantity}`).join(',')}`,
    )
    .join(' ')}`;
}

function planTitle(plan: ShoppingPlan, index: number): string {
  if (plan.kind === 'cheapest') return 'Cheapest';
  const stops = `${plan.stops.length} ${plan.stops.length === 1 ? 'stop' : 'stops'}`;
  const title = index === 0 ? 'Fewest stops' : `Option ${index + 1}`;
  return plan.cheapest ? `${title} · cheapest · ${stops}` : `${title} · ${stops}`;
}
