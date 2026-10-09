import { type FormEvent, useEffect, useRef, useState } from 'react';

import {
  DEFAULT_TRADER_FILTERS,
  TRADED_CATEGORIES,
  type TradedCategory,
  type TraderFilters,
  type TraderSearchRequest,
  type TraderStation,
} from '../../../shared/crafting';
import { ageText, lyText } from '../commodities/MarketFields';
import { NumberField } from '../hud/Controls';
import { CopyButton } from '../hud/CopyButton';
import { Glyph } from '../hud/Glyph';
import { formatNumber } from '../journal/format';

const STORAGE_KEY = 'edssi.materials.traders';

const PADS: readonly { id: TraderFilters['pad']; label: string }[] = [
  { id: 'any', label: 'Any' },
  { id: 'medium', label: 'Medium+' },
  { id: 'large', label: 'Large' },
];

interface Results {
  request: TraderSearchRequest;
  stations: TraderStation[];
  total: number;
  reference: string;
}

/** A search asked for from elsewhere on the tab: these traders, around where the commander is. */
export interface TraderAsk {
  types: TradedCategory[];
  /** Goes up with each ask, so asking twice for the same searches twice. */
  seq: number;
}

function savedFilters(): TraderFilters {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- written below; merged over the defaults
      const read = JSON.parse(saved) as Partial<TraderFilters>;
      return { ...DEFAULT_TRADER_FILTERS, ...read };
    }
  } catch {
    // Storage can be unavailable or hold something unreadable; the defaults do.
  }
  return DEFAULT_TRADER_FILTERS;
}

/**
 * The Materials module's Traders page: stations with a material trader, nearest first, from
 * Spansh. Searches on first showing, and whenever the Missing page asks for a kind of trader.
 */
export function TradersView({
  here,
  shown,
  ask,
}: {
  here: string | undefined;
  /** Whether the page is the one showing. */
  shown: boolean;
  ask: TraderAsk | undefined;
}) {
  const [filters, setFilters] = useState(savedFilters);
  const [results, setResults] = useState<Results>();
  const [problem, setProblem] = useState<string>();
  const [busy, setBusy] = useState(false);
  const searched = useRef(false);

  const change = (patch: Partial<TraderFilters>) =>
    setFilters((current) => {
      const next = { ...current, ...patch };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Only a convenience.
      }
      return next;
    });

  const run = async (request: TraderSearchRequest, append: boolean) => {
    searched.current = true;
    setBusy(true);
    setProblem(undefined);
    try {
      const outcome = await window.edssi.materials.searchTraders(request);
      if ('error' in outcome) {
        setProblem(outcome.error);
        return;
      }
      const { stations, total, reference } = outcome.result;
      setResults((current) => ({
        request,
        stations: append && current ? [...current.stations, ...stations] : stations,
        total,
        reference,
      }));
    } finally {
      setBusy(false);
    }
  };

  // The first time the page is looked at, look around where the commander is.
  useEffect(() => {
    if (shown && !searched.current && (here !== undefined || filters.near.trim() !== '')) {
      void run({ ...filters, page: 0 }, false);
    }
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- only on showing, not on every edit
  }, [shown, here]);

  useEffect(() => {
    if (!ask) return;
    const next = { ...filters, types: ask.types, near: '' };
    change({ types: ask.types, near: '' });
    void run({ ...next, page: 0 }, false);
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- once per ask
  }, [ask?.seq]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!busy) void run({ ...filters, page: 0 }, false);
  };

  const toggleType = (type: TradedCategory) => {
    const types = filters.types.includes(type)
      ? filters.types.filter((known) => known !== type)
      : [...filters.types, type];
    change({ types: types.length === TRADED_CATEGORIES.length ? [] : types });
  };

  const more = results && results.stations.length < results.total;
  return (
    <>
      <form className="panel pad todo-form" onSubmit={submit} noValidate>
        <div className="todo-row">
          <div className="field" style={{ flex: '1 1 240px' }}>
            <label htmlFor="trader-near">Near</label>
            <div className="input">
              <span className="ic-w">
                <Glyph name="target" />
              </span>
              <input
                id="trader-near"
                value={filters.near}
                placeholder={here ?? 'Here'}
                spellCheck={false}
                onChange={(event) => change({ near: event.target.value })}
              />
              <button
                type="button"
                className="link"
                style={{ fontSize: 13 }}
                title="Search around where you are"
                onClick={() => change({ near: '' })}
              >
                Here
              </button>
            </div>
          </div>
          <div style={{ width: 150 }}>
            <NumberField
              label="Within"
              unit="ly"
              value={filters.maxDistanceLy}
              min={10}
              max={20_000}
              onChange={(maxDistanceLy) => change({ maxDistanceLy })}
            />
          </div>
          <div style={{ width: 170 }}>
            <NumberField
              label="Max arrival"
              unit="ls"
              title="Leave out stations further than this from the arrival point; 0 for any distance"
              value={filters.maxArrivalLs}
              min={0}
              max={1_000_000}
              onChange={(maxArrivalLs) => change({ maxArrivalLs })}
            />
          </div>
          <button type="submit" className="btn primary todo-submit" disabled={busy}>
            <span className="ic-w">
              <Glyph name="search" />
            </span>
            {busy ? 'Searching…' : 'Search'}
          </button>
        </div>
        <div className="todo-row">
          <fieldset className="field" style={{ border: 0, margin: 0, padding: 0 }}>
            <legend className="label">Trader</legend>
            <div className="chips lg" style={{ marginTop: 6 }}>
              <button
                type="button"
                className="chip"
                aria-pressed={filters.types.length === 0}
                onClick={() => change({ types: [] })}
              >
                All
              </button>
              {TRADED_CATEGORIES.map((type) => (
                <button
                  key={type}
                  type="button"
                  className="chip"
                  aria-pressed={filters.types.includes(type)}
                  onClick={() => toggleType(type)}
                >
                  {type}
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset className="field" style={{ border: 0, margin: 0, padding: 0 }}>
            <legend className="label">Landing pad</legend>
            <div className="seg lg" style={{ marginTop: 6 }}>
              {PADS.map((pad) => (
                <button
                  key={pad.id}
                  type="button"
                  aria-pressed={filters.pad === pad.id}
                  onClick={() => change({ pad: pad.id })}
                >
                  {pad.label}
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset className="field" style={{ border: 0, margin: 0, padding: 0 }}>
            <legend className="label">Planetary</legend>
            <div className="seg lg" style={{ marginTop: 6 }}>
              <button
                type="button"
                aria-pressed={filters.planetary}
                onClick={() => change({ planetary: true })}
              >
                Include
              </button>
              <button
                type="button"
                aria-pressed={!filters.planetary}
                title="Leave out planetary ports and settlements"
                onClick={() => change({ planetary: false })}
              >
                Exclude
              </button>
            </div>
          </fieldset>
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
      <div className="mat-scroll">
        {!results ? (
          !busy && (
            <p className="mat-empty">
              {here === undefined
                ? 'Where you are isn’t known yet; name a system to search around.'
                : 'Search for the material traders near you.'}
            </p>
          )
        ) : results.stations.length === 0 ? (
          <p className="mat-empty">
            No material trader within {lyText(results.request.maxDistanceLy)}.
          </p>
        ) : (
          <>
            <p className="plans-note">
              {formatNumber(results.total, 0)} {results.total === 1 ? 'station' : 'stations'} from{' '}
              {results.reference} · showing {results.stations.length}
            </p>
            <table className="tbl roomy">
              <thead>
                <tr>
                  <th scope="col">Station</th>
                  <th scope="col">Trader</th>
                  <th scope="col">System</th>
                  <th scope="col" className="v">
                    Distance
                  </th>
                  <th scope="col" className="v">
                    Arrival
                  </th>
                </tr>
              </thead>
              <tbody>
                {results.stations.map((station) => {
                  const inSystem =
                    here !== undefined && station.system.toLowerCase() === here.toLowerCase();
                  return (
                    <tr key={station.marketId} className={inSystem ? 'sel' : undefined}>
                      <td>
                        <div className="st-name">{station.name}</div>
                        <div className="st-meta">
                          {station.type.replace(/ Starport$/, '')}
                          {station.pad && ` · ${station.pad} pad`}
                          {station.updatedAt && ` · seen ${ageText(station.updatedAt)}`}
                        </div>
                      </td>
                      <td>
                        <span className={`tag trader-${station.trader.toLowerCase()}`}>
                          {station.trader}
                        </span>
                      </td>
                      <td>
                        <span className="row" style={{ gap: 6 }}>
                          {station.system}
                          <CopyButton text={station.system} />
                        </span>
                      </td>
                      <td className="v">{inSystem ? 'Here' : lyText(station.distanceLy)}</td>
                      <td className="v">
                        {station.arrivalLs === undefined
                          ? '—'
                          : `${formatNumber(station.arrivalLs, 0)} ls`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {more && (
              <button
                type="button"
                className="btn ghost sm trader-more"
                disabled={busy}
                onClick={() =>
                  void run({ ...results.request, page: results.request.page + 1 }, true)
                }
              >
                {busy ? 'Loading…' : 'Show more'}
              </button>
            )}
          </>
        )}
      </div>
    </>
  );
}
