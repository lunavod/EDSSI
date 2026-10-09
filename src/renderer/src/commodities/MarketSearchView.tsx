import { type FormEvent, Fragment, useId, useState } from 'react';

import {
  type CommoditySearchRequest,
  type MarketPlace,
  type PlanResult,
  sameCommodity,
  type ShoppingPlan,
} from '../../../shared/commodities';
import { NumberInput } from '../hud/Controls';
import { CopyButton } from '../hud/CopyButton';
import { Glyph } from '../hud/Glyph';
import { Icon } from '../hud/Icon';
import { ICONS } from '../hud/icons';
import { Suggest } from '../hud/Suggest';
import { formatNumber } from '../journal/format';
import { ageText, isStale, lyText, MarketFields, stationKind } from './MarketFields';
import { PlanCard, type Whereabouts } from './PlanCard';
import { type HoldSource, SellImport } from './SellImport';
import { useCommodityNameList, useMarketFilters } from './useCommodities';

/** Buying from the markets, or selling to them. */
export type MarketSide = 'buy' | 'sell';

/** Both sides ask the same: commodities, each with the least supply or demand that will do. */
type Request = CommoditySearchRequest;

/** A commodity asked about, and the tonnes: the least supply buying, what is to be sold selling. */
interface Wanted {
  name: string;
  tonnes: number;
}

/** A commodity's price at a station, and its supply (buying) or demand (selling). */
interface Deal {
  commodity: string;
  price: number;
  amount: number;
}

interface Row {
  station: MarketPlace;
  deals: Deal[];
}

interface Results {
  request: Request;
  rows: Row[];
  total: number;
  reference: string;
}

const SIDES = {
  buy: {
    storageKey: 'edssi.commodities.search',
    amount: 'Supply',
    tonnes: '≥',
    tonnesTitle: 'Markets must have at least this many tonnes in stock',
    best: 'Cheapest',
    bestTitle: "By the first commodity's price",
    button: 'Search',
    empty: 'No market within reach sells all of that.',
    total: 'Costs',
    totalTitle: 'The price times the tonnes asked for',
  },
  sell: {
    storageKey: 'edssi.commodities.sell',
    amount: 'Demand',
    tonnes: '',
    tonnesTitle: 'Tonnes to sell: markets must want at least this many',
    best: 'Best price',
    bestTitle: "By the first commodity's price, the highest first",
    button: 'Find buyers',
    empty: 'No market within reach buys all of that.',
    total: 'Brings in',
    totalTitle: 'The price times the tonnes to sell',
  },
} as const;

const NO_HOLDS: HoldSource[] = [];

/** One page of results from Spansh, for either side, as rows of deals. */
async function fetchPage(
  side: MarketSide,
  request: Request,
): Promise<{ error: string } | { result: Omit<Results, 'request'> }> {
  if (side === 'buy') {
    const outcome = await window.edssi.commodities.search(request);
    if ('error' in outcome) return outcome;
    const { stations, total, reference } = outcome.result;
    return {
      result: {
        rows: stations.map(({ offers, ...station }) => ({
          station,
          deals: offers.map((offer) => ({
            commodity: offer.commodity,
            price: offer.buyPrice,
            amount: offer.supply,
          })),
        })),
        total,
        reference,
      },
    };
  }
  const outcome = await window.edssi.commodities.searchSell(request);
  if ('error' in outcome) return outcome;
  const { stations, total, reference } = outcome.result;
  return {
    result: {
      rows: stations.map(({ bids, ...station }) => ({
        station,
        deals: bids.map((bid) => ({
          commodity: bid.commodity,
          price: bid.sellPrice,
          amount: bid.demand,
        })),
      })),
      total,
      reference,
    },
  };
}

/**
 * Markets that sell every commodity asked for (or, selling, buy every one), from Spansh, nearest
 * first or best price first: what Inara's commodity search does. Each commodity carries its own
 * tonnes: the least supply that will do, or what is to be sold (which the market must want). Selling,
 * they can be picked from the ship's or a carrier's hold (`holds`). Where more than a tonne is asked
 * for, each market says what it all costs or brings in there.
 */
export function MarketSearchView({
  where,
  side,
  holds = NO_HOLDS,
}: {
  where: Whereabouts;
  side: MarketSide;
  holds?: HoldSource[];
}) {
  const text = SIDES[side];
  const names = useCommodityNameList();
  const inputId = useId();
  const [filters, setFilters] = useMarketFilters(text.storageKey);
  const [wanted, setWanted] = useState<Wanted[]>([]);
  const [typed, setTyped] = useState('');
  const [importing, setImporting] = useState(false);
  const [sort, setSort] = useState<'distance' | 'price'>('distance');
  const [results, setResults] = useState<Results>();
  const [problem, setProblem] = useState<string>();
  const [busy, setBusy] = useState(false);
  /** Selling: ways to sell it all across several markets, when asked for. */
  const [plan, setPlan] = useState<PlanResult>();
  const [planning, setPlanning] = useState(false);
  /** Which answer is below the form: the markets buying everything, or the plans. */
  const [view, setView] = useState<'markets' | 'plan'>('markets');

  /** Adds a name, once; the list with it, for a search started in the same breath. */
  const add = (raw: string): Wanted[] => {
    const name = raw.trim();
    setTyped('');
    if (name === '' || wanted.some((known) => sameCommodity(known.name, name))) return wanted;
    const next = [...wanted, { name, tonnes: 1 }];
    setWanted(next);
    return next;
  };
  const remove = (name: string) => setWanted(wanted.filter((known) => known.name !== name));
  const setTonnes = (name: string, tonnes: number) =>
    setWanted(wanted.map((known) => (known.name === name ? { name, tonnes } : known)));

  const run = async (request: Request, append: boolean) => {
    setBusy(true);
    setProblem(undefined);
    try {
      const outcome = await fetchPage(side, request);
      if ('error' in outcome) {
        setProblem(outcome.error);
        return;
      }
      const { rows, total, reference } = outcome.result;
      setResults((current) => ({
        request,
        rows: append && current ? [...current.rows, ...rows] : rows,
        total,
        reference,
      }));
    } finally {
      setBusy(false);
    }
  };

  /** Ways to sell everything asked for across as many markets as it takes. */
  const split = () => {
    const asked = add(typed);
    if (asked.length === 0 || planning) return;
    setView('plan');
    setPlanning(true);
    setProblem(undefined);
    void window.edssi.commodities
      .sellPlan({
        ...filters,
        needs: asked.map((known) => ({ commodity: known.name, quantity: known.tonnes })),
      })
      .then((outcome) => {
        if ('error' in outcome) {
          if (outcome.error !== 'cancelled') setProblem(outcome.error);
        } else setPlan(outcome.result);
      })
      .finally(() => setPlanning(false));
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const asked = add(typed);
    if (asked.length === 0 || busy) return;
    setView('markets');
    void run(
      {
        ...filters,
        commodities: asked.map((known) => known.name),
        minimums: asked.map((known) => known.tonnes),
        sort,
        page: 0,
      },
      false,
    );
  };

  const shown = results?.request.commodities ?? [];
  const minimums = results?.request.minimums ?? [];
  const single = shown.length === 1;
  /** More than a tonne asked for: what it all comes to at each market. */
  const totals = minimums.some((tonnes) => tonnes > 1);
  return (
    <div className="comm-page">
      {/* The number inputs clamp themselves when they are left. */}
      <form className="panel pad" style={{ flex: 'none' }} onSubmit={submit} noValidate>
        <div className="search-row">
          <div className="field" style={{ flex: '1 1 520px' }}>
            <label className="label" htmlFor={inputId}>
              Commodities
            </label>
            <div className="input lg chips">
              {wanted.map((known) => (
                <span key={known.name} className="tagin">
                  <span className="tagin-name">{known.name}</span>
                  <span className="tagin-qty" title={text.tonnesTitle}>
                    {text.tonnes !== '' && <span>{text.tonnes}</span>}
                    <NumberInput
                      unit="t"
                      size="sm"
                      label={`${text.amount} of ${known.name}, in tonnes`}
                      value={known.tonnes}
                      min={1}
                      max={1_000_000}
                      onChange={(tonnes) => setTonnes(known.name, tonnes)}
                    />
                  </span>
                  <button
                    type="button"
                    aria-label={`Remove ${known.name}`}
                    title="Remove"
                    onClick={() => remove(known.name)}
                  >
                    <Glyph name="close" />
                  </button>
                </span>
              ))}
              <Suggest
                id={inputId}
                value={typed}
                suggestions={names}
                placeholder={wanted.length ? 'and…' : 'e.g. Steel'}
                spellCheck={false}
                onChange={setTyped}
                onPick={add}
                onKeyDown={(event) => {
                  // Enter with a name adds it; Enter on an empty input searches.
                  if (event.key === 'Enter' && typed.trim() !== '') {
                    event.preventDefault();
                    add(typed);
                  }
                  const last = wanted.at(-1);
                  if (event.key === 'Backspace' && typed === '' && last) remove(last.name);
                }}
              />
              {(wanted.length > 0 || typed !== '') && (
                <button
                  type="button"
                  className="ibtn sm chips-clear"
                  aria-label="Clear all commodities"
                  title="Clear all"
                  onClick={() => {
                    setWanted([]);
                    setTyped('');
                  }}
                >
                  <Glyph name="close" />
                </button>
              )}
            </div>
          </div>
          {side === 'sell' && (
            <button
              type="button"
              className="btn ghost lg"
              title="Pick what to sell from the ship's hold or a carrier's"
              onClick={() => setImporting(true)}
            >
              <span className="ic-w">
                <Glyph name="cargo" />
              </span>
              From hold
            </button>
          )}
          <fieldset className="field" style={{ border: 0, margin: 0, padding: 0 }}>
            <legend className="label">Sort</legend>
            <div className="seg lg" style={{ marginTop: 6 }}>
              <button
                type="button"
                aria-pressed={sort === 'distance'}
                onClick={() => setSort('distance')}
              >
                Nearest
              </button>
              <button
                type="button"
                aria-pressed={sort === 'price'}
                title={text.bestTitle}
                onClick={() => setSort('price')}
              >
                {text.best}
              </button>
            </div>
          </fieldset>
          <button
            type="submit"
            className="btn primary lg"
            disabled={busy || (wanted.length === 0 && typed.trim() === '')}
          >
            <span className="ic-w">
              <Glyph name="search" />
            </span>
            {busy ? 'Searching…' : text.button}
          </button>
          {side === 'sell' &&
            (planning ? (
              <button
                type="button"
                className="btn danger lg"
                onClick={() => void window.edssi.commodities.cancelSellPlan()}
              >
                <span className="ic-w">
                  <Glyph name="stop" />
                </span>
                Stop
              </button>
            ) : (
              <button
                type="button"
                className="btn ghost lg"
                title="For when no one market buys it all: ways to sell it across several"
                disabled={wanted.length === 0 && typed.trim() === ''}
                onClick={split}
              >
                <span className="ic-w">
                  <Glyph name="route" />
                </span>
                Split between markets
              </button>
            ))}
        </div>
        <div className="filters-open">
          <MarketFields filters={filters} onChange={setFilters} here={where.system} />
        </div>
      </form>
      {problem && (
        <p className="note danger comm-problem" role="alert">
          <span className="ic-w">
            <Glyph name="warning" />
          </span>
          {problem}
        </p>
      )}
      {view === 'plan' && plan && <SellPlans result={plan} where={where} />}
      {view === 'markets' &&
        results &&
        (results.rows.length === 0 ? (
          <p className="comm-empty">
            {text.empty}
            {side === 'sell' && results.request.commodities.length > 1 && (
              <>
                {' '}
                <button type="button" className="link" disabled={planning} onClick={split}>
                  Split it between markets
                </button>
              </>
            )}
          </p>
        ) : (
          <div className="results">
            <p className="plans-note">
              {formatNumber(results.total, 0)}
              {results.total >= 10_000 ? '+' : ''} markets from {results.reference} · showing{' '}
              {results.rows.length}
            </p>
            <table className="tbl roomy">
              <thead>
                <tr>
                  <th scope="col">Station</th>
                  <th scope="col">System</th>
                  <th scope="col" className="v">
                    Distance
                  </th>
                  {single ? (
                    <>
                      <th scope="col" className="v">
                        Price
                      </th>
                      <th scope="col" className="v">
                        {text.amount}
                      </th>
                    </>
                  ) : null}
                  {totals && (
                    <th scope="col" className="v" title={text.totalTitle}>
                      {text.total}
                    </th>
                  )}
                  <th scope="col">
                    <span className="visually-hidden">Here</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {results.rows.map(({ station, deals }) => {
                  const offers = shown.map((name) => ({
                    name,
                    offer: deals.find((known) => sameCommodity(known.commodity, name)),
                  }));
                  const first = offers[0]?.offer;
                  const total = offers.every(({ offer }) => offer)
                    ? offers.reduce(
                        (sum, { offer }, index) =>
                          sum + (offer?.price ?? 0) * (minimums[index] ?? 1),
                        0,
                      )
                    : undefined;
                  const here =
                    where.system !== undefined &&
                    station.system.toLowerCase() === where.system.toLowerCase();
                  return (
                    <Fragment key={station.marketId}>
                      <tr
                        className={
                          [here && 'sel', !single && 'has-deals'].filter(Boolean).join(' ') ||
                          undefined
                        }
                      >
                        <td>
                          <div className="st-name">{station.name}</div>
                          <div className="st-meta">
                            {stationKind(station)}
                            {station.arrivalLs !== undefined &&
                              ` · ${formatNumber(station.arrivalLs, 0)} ls`}
                            {' · '}
                            <span className={isStale(station.marketUpdatedAt) ? 'warn' : undefined}>
                              {ageText(station.marketUpdatedAt)}
                            </span>
                          </div>
                        </td>
                        <td>
                          <span className="row" style={{ gap: 6 }}>
                            {station.system}
                            <CopyButton text={station.system} />
                          </span>
                        </td>
                        <td className="v">{lyText(station.distanceLy)}</td>
                        {single ? (
                          <>
                            <td className="v">
                              {first ? `${formatNumber(first.price, 0)} CR` : '—'}
                            </td>
                            <td className="v">
                              {first ? `${formatNumber(first.amount, 0)} t` : '—'}
                            </td>
                          </>
                        ) : null}
                        {totals && (
                          <td className="v">
                            {total === undefined ? '—' : `${formatNumber(total, 0)} CR`}
                          </td>
                        )}
                        <td style={{ width: 24 }}>
                          {here && (
                            <span title="You are here">
                              <Icon src={ICONS.marker} className="icon here-mk" />
                            </span>
                          )}
                        </td>
                      </tr>
                      {!single && (
                        // Several commodities: each one's price and amount on a line of their own.
                        <tr className={here ? 'deals sel' : 'deals'}>
                          <td colSpan={totals ? 5 : 4}>
                            <div className="offers">
                              {offers.map(({ name, offer }) => (
                                <span key={name} className="where">
                                  <b>{name}</b>
                                  {offer
                                    ? `${formatNumber(offer.price, 0)} CR · ${formatNumber(offer.amount, 0)} t`
                                    : '—'}
                                </span>
                              ))}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
            {results.rows.length < results.total && (
              <button
                type="button"
                className="btn ghost"
                style={{ alignSelf: 'center' }}
                disabled={busy}
                onClick={() =>
                  void run({ ...results.request, page: results.request.page + 1 }, true)
                }
              >
                {busy ? 'Loading…' : 'More'}
              </button>
            )}
          </div>
        ))}
      {importing && (
        <SellImport
          sources={holds}
          onImport={(picks) => {
            setWanted(picks.map((pick) => ({ name: pick.commodity, tonnes: pick.tonnes })));
            setTyped('');
          }}
          onClose={() => setImporting(false)}
        />
      )}
    </div>
  );
}

/**
 * Ways to sell a load across several markets: a few that sell as much as they can at each stop,
 * each starting somewhere else, and one that sells each commodity where it pays most.
 */
function SellPlans({ result, where }: { result: PlanResult; where: Whereabouts }) {
  if (result.plans.length === 0) {
    return (
      <p className="comm-empty">
        None of the {result.stations} markets found buys any of it. Try further out, older markets
        or carriers.
      </p>
    );
  }
  const tonne = result.needs.every((need) => need.quantity <= 1);
  return (
    <div className="plans">
      <p className="plans-note">
        From {result.reference}, over {formatNumber(result.stations, 0)} markets. Demand is as last
        reported; check it on arrival.
        {tonne && ' Set the tonnes on each commodity to plan the whole load.'}
      </p>
      {result.plans.map((plan, index) => (
        <PlanCard
          key={`${plan.kind} ${plan.stops.map((stop) => stop.station.marketId).join()}`}
          plan={plan}
          title={sellPlanTitle(plan, index)}
          where={where}
          selling
        />
      ))}
    </div>
  );
}

function sellPlanTitle(plan: ShoppingPlan, index: number): string {
  if (plan.kind === 'cheapest') return 'Best price';
  const stops = `${plan.stops.length} ${plan.stops.length === 1 ? 'stop' : 'stops'}`;
  const title = index === 0 ? 'Fewest stops' : `Option ${index + 1}`;
  return plan.cheapest ? `${title} · best price · ${stops}` : `${title} · ${stops}`;
}
