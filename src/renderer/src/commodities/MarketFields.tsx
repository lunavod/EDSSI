import type { ReactNode } from 'react';

import type {
  MarketFilters,
  MarketPlace,
  PadNeed,
  PlanetaryMode,
} from '../../../shared/commodities';
import { NumberField, Switch } from '../hud/Controls';
import { Glyph } from '../hud/Glyph';
import { formatNumber } from '../journal/format';

const PLANETARY: readonly { id: PlanetaryMode; label: string; help: string }[] = [
  { id: 'yes', label: 'Yes', help: 'Planetary ports and settlements count like any market' },
  {
    id: 'minimise',
    label: 'Minimise',
    help: 'Buy everything orbital markets have there, and only the rest on planets',
  },
  { id: 'no', label: 'No', help: 'Leave out planetary ports and settlements' },
];

const PADS: readonly { id: PadNeed; label: string }[] = [
  { id: 'any', label: 'Any' },
  { id: 'medium', label: 'Medium+' },
  { id: 'large', label: 'Large' },
];

/**
 * Where to search around, how far, and which markets count: the same on Search and Plan.
 * `children` go at the end of the second row: the Plan page's button.
 */
export function MarketFields({
  filters,
  onChange,
  here,
  minimise = false,
  children,
}: {
  filters: MarketFilters;
  onChange: (patch: Partial<MarketFilters>) => void;
  here: string | undefined;
  /** Offer to use planetary markets only for what orbital ones lack (the Plan page). */
  minimise?: boolean;
  children?: ReactNode;
}) {
  return (
    <>
      <div className="mf">
        <div className="field">
          <label htmlFor="market-near">Near</label>
          <div className="input">
            <span className="ic-w">
              <Glyph name="target" />
            </span>
            <input
              id="market-near"
              value={filters.near}
              placeholder={here ?? 'Here'}
              spellCheck={false}
              onChange={(event) => onChange({ near: event.target.value })}
            />
            <button
              type="button"
              className="link"
              style={{ fontSize: 13 }}
              title="Search around where you are"
              onClick={() => onChange({ near: '' })}
            >
              Here
            </button>
          </div>
        </div>
        <NumberField
          label="Within"
          unit="ly"
          value={filters.maxDistanceLy}
          min={50}
          max={20_000}
          onChange={(maxDistanceLy) => onChange({ maxDistanceLy })}
        />
        <NumberField
          label="Max arrival"
          unit="ls"
          title="Leave out stations further than this from the arrival point; 0 for any distance"
          value={filters.maxArrivalLs}
          min={0}
          max={1_000_000}
          onChange={(maxArrivalLs) => onChange({ maxArrivalLs })}
        />
        <NumberField
          label="Market age"
          unit="days"
          title="Leave out markets nobody has reported for longer; 0 for any age"
          value={filters.maxAgeDays}
          min={0}
          max={3650}
          onChange={(maxAgeDays) => onChange({ maxAgeDays })}
        />
      </div>
      <div className="mf2">
        <fieldset className="field" style={{ border: 0, margin: 0, padding: 0 }}>
          <legend className="label">Landing pad</legend>
          <div className="seg lg" style={{ marginTop: 6 }}>
            {PADS.map((pad) => (
              <button
                key={pad.id}
                type="button"
                aria-pressed={filters.pad === pad.id}
                onClick={() => onChange({ pad: pad.id })}
              >
                {pad.label}
              </button>
            ))}
          </div>
        </fieldset>
        <fieldset className="field" style={{ border: 0, margin: 0, padding: 0 }}>
          <legend className="label">Planetary</legend>
          <div className="seg lg" style={{ marginTop: 6 }}>
            {minimise ? (
              PLANETARY.map((mode) => (
                <button
                  key={mode.id}
                  type="button"
                  title={mode.help}
                  aria-pressed={filters.planetary === mode.id}
                  onClick={() => onChange({ planetary: mode.id })}
                >
                  {mode.label}
                </button>
              ))
            ) : (
              <>
                <button
                  type="button"
                  title="Planetary ports and settlements count like any market"
                  aria-pressed={filters.planetary !== 'no'}
                  onClick={() => onChange({ planetary: 'yes' })}
                >
                  Include
                </button>
                <button
                  type="button"
                  title="Leave out planetary ports and settlements"
                  aria-pressed={filters.planetary === 'no'}
                  onClick={() => onChange({ planetary: 'no' })}
                >
                  Exclude
                </button>
              </>
            )}
          </div>
        </fieldset>
        <div className="field">
          <span className="label">Fleet carriers</span>
          <Switch
            checked={filters.carriers}
            title="Carriers open to all; their stock and prices change at their owners' whim"
            onChange={(carriers) => onChange({ carriers })}
          />
        </div>
        {children && <div className="go">{children}</div>}
      </div>
    </>
  );
}

const DAY_MS = 24 * 60 * 60_000;

/** "today", "3 d ago", "5 mo ago": how old a market's data is. */
export function ageText(iso: string | undefined, now = Date.now()): string {
  if (!iso) return '—';
  const days = (now - Date.parse(iso)) / DAY_MS;
  if (!Number.isFinite(days)) return '—';
  if (days < 1) return 'today';
  if (days < 60) return `${Math.floor(days)} d ago`;
  if (days < 730) return `${Math.floor(days / 30)} mo ago`;
  return `${Math.floor(days / 365)} y ago`;
}

/** Old enough that the stock may well have gone. */
export function isStale(iso: string | undefined, now = Date.now()): boolean {
  return !iso || now - Date.parse(iso) > 7 * DAY_MS;
}

/** A station's type, shortened for a table cell, with its pad. */
export function stationKind(station: MarketPlace): string {
  const type = station.carrier ? 'Carrier' : station.type.replace(/ Starport$/, '');
  return station.pad ? `${type} · ${station.pad}` : type;
}

export function lyText(ly: number): string {
  return `${formatNumber(ly, ly < 100 ? 1 : 0)} ly`;
}
