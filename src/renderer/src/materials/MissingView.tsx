import { useMemo, useState } from 'react';

import {
  familyLabel,
  isTradeable,
  type MaterialNeed,
  materialNeeds,
  materialOrder,
  needGroup,
  type NeedGroup,
  type PlannedTrade,
  planTrades,
  reservedMaterials,
  TRADED_CATEGORIES,
  type TradedCategory,
  type TradeOption,
  tradeOptions,
} from '../../../shared/crafting';
import { materialInfo, type MaterialsSnapshot, materialName } from '../../../shared/materials';
import type { ViewOptionValue } from '../../../shared/view-options';
import { Switch } from '../hud/Controls';
import { Glyph } from '../hud/Glyph';
import { setViewOptions, useViewOption } from '../hud/useViewOption';
import { formatNumber } from '../journal/format';

const NO_INVENTORY: Readonly<Record<string, number>> = {};

/** Trades shown at first for each material; the rest behind "more". */
const FIRST_OPTIONS = 3;

const GROUPS: readonly { id: NeedGroup; title: string; hint?: string }[] = [
  { id: 'Raw', title: 'Raw' },
  { id: 'Manufactured', title: 'Manufactured' },
  { id: 'Encoded', title: 'Encoded' },
  { id: 'Cargo', title: 'Commodities', hint: 'Bought at a market, or collected' },
  { id: 'Locker', title: 'Ship locker', hint: 'Collected on foot, or bought from a bartender' },
];

/**
 * The Materials module's Missing page: every material the to-dos take against what the commander
 * has, by trader. Each shortfall lists what a material trader could make it from, spending only
 * what the to-dos don't hold back.
 */
export function MissingView({
  snapshot,
  onFindTrader,
}: {
  snapshot: MaterialsSnapshot | undefined;
  /** Opens the Traders page, searching for this kind. */
  onFindTrader: (category: TradedCategory) => void;
}) {
  // Shared, so the assistant can change them and every window shows the same.
  const [showCovered, setShowCovered] = useViewOption('materials.missing_show_covered');
  const [planning, setPlanning] = useState(false);
  const [sortKey] = useViewOption('materials.missing_sort');
  const [descending] = useViewOption('materials.missing_descending');
  const sort: NeedSort = { by: sortKey, descending };
  const sortBy = (by: NeedSortKey) =>
    setViewOptions({
      'materials.missing_sort': by,
      'materials.missing_descending':
        sort.by === by
          ? !sort.descending
          : // Most of it first for counts; lowest grade first, as the game lists them.
            by === 'have' || by === 'need' || by === 'short',
    });
  const inventory = snapshot?.inventory ?? NO_INVENTORY;
  const todos = snapshot?.todos;
  const standings = snapshot?.engineers;
  const { needs, reserved } = useMemo(
    () => ({
      needs: materialNeeds(todos ?? [], inventory, standings ?? []),
      reserved: reservedMaterials(todos ?? [], standings ?? []),
    }),
    [todos, inventory, standings],
  );
  // Worked out from the stock as it is, so each trade made drops off by itself.
  const plan = useMemo(
    () => (planning ? planTrades(needs, inventory, reserved) : undefined),
    [planning, needs, inventory, reserved],
  );
  const tradeable = needs.some((need) => need.short > 0 && isTradeable(need.info));

  if (!snapshot?.ready) return <p className="mat-empty">Reading journals…</p>;
  if (needs.length === 0) {
    return (
      <p className="mat-empty">
        Nothing to find. Put blueprints or syntheses on their to-do lists, and what they take shows
        up here.
      </p>
    );
  }
  const short = needs.filter((need) => need.short > 0);
  return (
    <>
      <div className="mat-bar">
        <p className="miss-sum">
          {short.length === 0 ? (
            <>
              <span className="ic-w good">
                <Glyph name="check" />
              </span>
              You have everything the to-dos take.
            </>
          ) : (
            <>
              <b>{short.length}</b> of {needs.length} materials short ·{' '}
              <b>
                {formatNumber(
                  short.reduce((sum, need) => sum + need.short, 0),
                  0,
                )}
              </b>{' '}
              units in all
            </>
          )}
        </p>
        <span className="sp" />
        {tradeable && (
          <button
            type="button"
            className={planning ? 'btn sm' : 'btn primary sm'}
            aria-pressed={planning}
            title="Trades that make up every shortfall they can, spending spare stock only once"
            onClick={() => setPlanning(!planning)}
          >
            <span className="ic-w">
              <Glyph name={planning ? 'close' : 'swap'} />
            </span>
            {planning ? 'Hide the plan' : 'Plan trades'}
          </button>
        )}
        <Switch
          checked={showCovered}
          label="Show what I have enough of"
          onChange={setShowCovered}
        />
      </div>
      <div className="mat-scroll">
        {plan && <TradePlanView plan={plan} onFindTrader={onFindTrader} />}
        {GROUPS.map((group) => {
          const all = needs.filter((need) => needGroup(need.info) === group.id);
          const shown = sortNeeds(showCovered ? all : all.filter((need) => need.short > 0), sort);
          if (shown.length === 0) return null;
          const shortHere = all.filter((need) => need.short > 0).length;
          const traded = TRADED_CATEGORIES.find((category) => category === group.id);
          return (
            <section key={group.id} className="sec" aria-label={group.title}>
              <div className="sec-head">
                <h2 className="sec-title">{group.title}</h2>
                <div className="sec-meta">
                  <span>
                    <b>{shortHere}</b> short
                  </span>
                  {group.hint && <span>{group.hint}</span>}
                  {traded && shortHere > 0 && (
                    <button
                      type="button"
                      className="btn ghost sm"
                      onClick={() => onFindTrader(traded)}
                    >
                      <span className="ic-w">
                        <Glyph name="station" />
                      </span>
                      Find {traded === 'Encoded' ? 'an' : 'a'} {traded.toLowerCase()} trader
                    </button>
                  )}
                </div>
              </div>
              <table className="tbl miss-tbl">
                <thead>
                  <tr>
                    <SortHeader by="order" sort={sort} onSort={sortBy} label="Material" />
                    <SortHeader by="grade" sort={sort} onSort={sortBy} label="Grade" />
                    <SortHeader by="have" sort={sort} onSort={sortBy} label="Have" right />
                    <SortHeader by="need" sort={sort} onSort={sortBy} label="Need" right />
                    <SortHeader by="short" sort={sort} onSort={sortBy} label="Short" right />
                  </tr>
                </thead>
                <tbody>
                  {shown.map((need) => (
                    <NeedRow
                      key={need.name}
                      need={need}
                      options={
                        traded ? tradeOptions(need.name, need.short, inventory, reserved) : []
                      }
                      traded={traded !== undefined}
                    />
                  ))}
                </tbody>
              </table>
            </section>
          );
        })}
      </div>
    </>
  );
}

/**
 * The trades that make up the shortfalls together, a table per trader: what to give and what it
 * brings. Those no trade can make up are listed after.
 */
function TradePlanView({
  plan,
  onFindTrader,
}: {
  plan: ReturnType<typeof planTrades>;
  onFindTrader: (category: TradedCategory) => void;
}) {
  const byTrader = TRADED_CATEGORIES.map((category) => ({
    category,
    trades: plan.trades.filter((trade) => materialInfo(trade.to)?.category === category),
  })).filter((group) => group.trades.length > 0);
  return (
    <section className="sec trade-plan" aria-label="Trade plan">
      <div className="sec-head">
        <h2 className="sec-title">Trade plan</h2>
        <div className="sec-meta">
          <span>
            <b>{plan.trades.length}</b> {plan.trades.length === 1 ? 'trade' : 'trades'}
          </span>
          {byTrader.length > 0 && (
            <span>
              at <b>{byTrader.length}</b> {byTrader.length === 1 ? 'trader' : 'traders'}
            </span>
          )}
        </div>
      </div>
      {byTrader.length === 0 ? (
        <p className="mat-empty">Nothing spare to trade for what is short.</p>
      ) : (
        <div className="plan-traders">
          {byTrader.map(({ category, trades }) => (
            <div key={category} className="plan-trader">
              <div className="plan-trader-head">
                <span className="plan-trader-name">{category} trader</span>
                <span className="sp" />
                <button
                  type="button"
                  className="btn ghost sm"
                  onClick={() => onFindTrader(category)}
                >
                  <span className="ic-w">
                    <Glyph name="station" />
                  </span>
                  Find one
                </button>
              </div>
              <ol className="plan-rows">
                {groupByTarget(trades).map(([to, group]) => (
                  <PlanRow key={to} to={to} trades={group} />
                ))}
              </ol>
            </div>
          ))}
        </div>
      )}
      {plan.unmet.length > 0 && (
        <div className="plan-trader plan-unmet">
          <div className="plan-trader-head">
            <span className="ic-w">
              <Glyph name="warning" />
            </span>
            <span className="plan-trader-name">Not enough spare to trade for</span>
            <span className="sp" />
            <span className="micro">Collect these, or free up stock the to-dos hold back</span>
          </div>
          <table className="tbl compact plan-unmet-tbl">
            <thead>
              <tr>
                <th scope="col">Material</th>
                <th scope="col">Grade</th>
                <th scope="col">Family</th>
                <th scope="col">Trader</th>
                <th scope="col">Short</th>
              </tr>
            </thead>
            <tbody>
              {plan.unmet.map((left) => {
                const info = materialInfo(left.name);
                return (
                  <tr key={left.name}>
                    <td>{materialName(left.name)}</td>
                    <td>
                      {info?.grade !== undefined && <span className="rc-grade">G{info.grade}</span>}
                    </td>
                    <td className="dim">{info?.family ? familyLabel(info.family) : ''}</td>
                    <td className="dim">{info?.category ?? ''}</td>
                    <td className="miss-short">{formatNumber(left.short, 0)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/** Trades by the material they bring, in the order they came. */
function groupByTarget(trades: readonly PlannedTrade[]): [string, PlannedTrade[]][] {
  const byTarget = new Map<string, PlannedTrade[]>();
  for (const trade of trades) {
    const group = byTarget.get(trade.to) ?? [];
    group.push(trade);
    byTarget.set(trade.to, group);
  }
  return [...byTarget];
}

/** A material the plan brings, and the trades that make it up. */
function PlanRow({ to, trades }: { to: string; trades: readonly PlannedTrade[] }) {
  const info = materialInfo(to);
  const total = trades.reduce((sum, trade) => sum + trade.receive, 0);
  return (
    <li className="plan-row">
      <span className="plan-get">
        <b>{formatNumber(total, 0)}</b> {materialName(to)}
        {info?.grade !== undefined && (
          <>
            {' '}
            <span className="dim">G{info.grade}</span>
          </>
        )}
      </span>
      <span className="trades">
        {trades.map((trade) => {
          const from = materialInfo(trade.from);
          return (
            <span
              key={trade.from}
              className="trade"
              title={`Give ${trade.give} ${materialName(trade.from)} for ${trade.receive} ${materialName(to)}`}
            >
              <span className="trade-give">
                {formatNumber(trade.give, 0)} {materialName(trade.from)}
                {from?.grade !== undefined && (
                  <>
                    {' '}
                    <span className="dim">G{from.grade}</span>
                  </>
                )}
              </span>
              <span className="trade-arrow" aria-hidden>
                →
              </span>
              <b>{formatNumber(trade.receive, 0)}</b>
            </span>
          );
        })}
      </span>
    </li>
  );
}

type NeedSortKey = ViewOptionValue<'materials.missing_sort'>;

interface NeedSort {
  by: NeedSortKey;
  descending: boolean;
}

/** Needs in the order asked for; ties keep the game's order. */
function sortNeeds(needs: readonly MaterialNeed[], sort: NeedSort): MaterialNeed[] {
  const value = (need: MaterialNeed): number => {
    switch (sort.by) {
      case 'order':
        return 0;
      case 'grade':
        return need.info?.grade ?? 0;
      default:
        return need[sort.by];
    }
  };
  const sign = sort.descending ? -1 : 1;
  const sorted = needs.toSorted(
    (a, b) => sign * (value(a) - value(b)) || materialOrder(a.name) - materialOrder(b.name),
  );
  return sort.by === 'order' && sort.descending ? sorted.toReversed() : sorted;
}

/** A column heading that sorts by it; pressed again, the other way. */
function SortHeader({
  by,
  sort,
  onSort,
  label,
  right = false,
}: {
  by: NeedSortKey;
  sort: NeedSort;
  onSort: (by: NeedSortKey) => void;
  label: string;
  right?: boolean;
}) {
  const active = sort.by === by;
  return (
    <th
      scope="col"
      className={right ? 'v' : undefined}
      aria-sort={active ? (sort.descending ? 'descending' : 'ascending') : 'none'}
    >
      <button
        type="button"
        className={active ? 'sort-head active' : 'sort-head'}
        title={`Sort by ${label.toLowerCase()}`}
        onClick={() => onSort(by)}
      >
        {label}
        <span className={sort.descending ? 'sort-chev down' : 'sort-chev'} aria-hidden>
          {active && <Glyph name="chevronDown" />}
        </span>
      </button>
    </th>
  );
}

function NeedRow({
  need,
  options,
  traded,
}: {
  need: MaterialNeed;
  options: TradeOption[];
  traded: boolean;
}) {
  const [all, setAll] = useState(false);
  const covered = need.short === 0;
  const shown = all ? options : options.slice(0, FIRST_OPTIONS);
  // Trades, or why there are none, on a line of their own under a material that is short.
  const trades =
    covered || !traded ? null : !isTradeable(need.info) ? (
      <span className="dim">Traders won&apos;t deal in it: collect it</span>
    ) : options.length === 0 ? (
      <span className="warn">Nothing spare to trade from</span>
    ) : (
      <span className="trades">
        {shown.map((option) => (
          <Trade key={option.from} option={option} />
        ))}
        {options.length > FIRST_OPTIONS && (
          <button type="button" className="link" onClick={() => setAll(!all)}>
            {all ? 'fewer' : `${options.length - FIRST_OPTIONS} more`}
          </button>
        )}
      </span>
    );
  const rowClass = [covered && 'past', trades && 'has-trades'].filter(Boolean).join(' ');
  return (
    <>
      <tr className={rowClass || undefined}>
        <td>
          <div className="miss-name">
            <span>{materialName(need.name)}</span>
            {need.info?.family && (
              <span className="miss-family">{familyLabel(need.info.family)}</span>
            )}
          </div>
        </td>
        <td>
          {need.info?.grade !== undefined && <span className="rc-grade">G{need.info.grade}</span>}
        </td>
        <td className="v">{formatNumber(need.have, 0)}</td>
        <td className="v">{formatNumber(need.need, 0)}</td>
        <td className={covered ? 'v' : 'v miss-short'}>
          {covered ? (
            <span className="ic-w good" title="Enough">
              <Glyph name="check" />
            </span>
          ) : (
            formatNumber(need.short, 0)
          )}
        </td>
      </tr>
      {trades && (
        <tr className="miss-trade-row">
          <td colSpan={5}>{trades}</td>
        </tr>
      )}
    </>
  );
}

function Trade({ option }: { option: TradeOption }) {
  const info = materialInfo(option.from);
  const title = [
    `Give ${option.give} ${materialName(option.from)} for ${option.receive}`,
    option.sameFamily ? 'Same family' : 'Another family: dearer',
    `Leaves ${option.spareLeft} spare`,
    !option.covers && 'Not enough spare to cover it all',
  ]
    .filter(Boolean)
    .join('\n');
  return (
    <span className={option.covers ? 'trade' : 'trade partial'} title={title}>
      <span className="trade-give">
        {option.give} {materialName(option.from)}
        {info?.grade !== undefined && (
          <>
            {' '}
            <span className="dim">G{info.grade}</span>
          </>
        )}
      </span>
      <span className="trade-arrow" aria-hidden>
        →
      </span>
      <b>{option.receive}</b>
    </span>
  );
}
