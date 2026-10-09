import { useState } from 'react';

import type { ActivityTallies, Tally } from '../../../shared/activity';
import { DAY_START_HOUR, sameDay } from '../../../shared/days';
import {
  formatCompact,
  formatCompactParts,
  formatNumber,
  formatShortDateTime,
  formatShortTime,
} from '../journal/format';
import { formatPlayed, sourceShares } from './mission';

type Period = 'today' | 'session' | 'trip';

const LOST_TITLE =
  'Data and vouchers found in this period that went down with the ship, already taken off.';

const PERIODS: { id: Period; label: string; title: string }[] = [
  {
    id: 'today',
    label: 'Today',
    title: `Since ${DAY_START_HOUR}:00 this morning, or yesterday morning in the small hours`,
  },
  { id: 'session', label: 'Session', title: 'Since the game was launched' },
  { id: 'trip', label: 'Trip', title: 'Since the last sale of exploration or organic data' },
];

/** The sources' colours in the bar, largest first. */
const SOURCE_COLOURS = ['var(--accent)', 'var(--accent-lo)', 'var(--accent-2)', 'var(--dim)'];

/**
 * Along the bottom of the Mission tab: what today (from 06:00, as everywhere else), this game
 * session, or this trip since the last data sale has made, how fast, and how far it has gone.
 */
export function SessionStrip({
  tallies,
  periods = true,
}: {
  tallies: ActivityTallies | undefined;
  /**
   * Whether to offer the period buttons. The VR cockpit turns them off: there is no pointer in a
   * headset, so they are a row of controls nobody can press.
   */
  periods?: boolean;
}) {
  const [period, setPeriod] = useState<Period>('today');
  const tally = tallies?.[period];
  const since =
    period === 'trip' && tallies && !tallies.trip.sinceSale
      ? 'since the first journal'
      : tally && `since ${formatSince(tally.from)}`;
  return (
    <section
      className={periods ? 'strip2 panel' : 'strip2 panel no-periods'}
      aria-label="Session totals"
    >
      {periods && (
        <fieldset className="seg vert strip2-seg">
          <legend className="visually-hidden">Period</legend>
          {PERIODS.map(({ id, label, title }) => (
            <button
              key={id}
              type="button"
              aria-pressed={period === id}
              title={title}
              onClick={() => setPeriod(id)}
            >
              {label}
            </button>
          ))}
        </fieldset>
      )}
      {!tallies?.ready ? (
        <p className="strip2-empty">Reading journals…</p>
      ) : !tally ? (
        <p className="strip2-empty">No game session yet.</p>
      ) : (
        <TallyCells tally={tally} since={since} />
      )}
    </section>
  );
}

function TallyCells({ tally, since }: { tally: Tally; since: string | undefined }) {
  const shares = sourceShares(tally).filter((share) => share.value > 0);
  const made = formatCompactParts(tally.earned);
  return (
    <>
      <div className="s2">
        <span className="k">Made</span>
        <span className="v">
          {made.value}
          <small>{made.unit ? `${made.unit} CR` : 'CR'}</small>
        </span>
        {tally.lost > 0 ? (
          <span className="d warn" title={LOST_TITLE}>
            {formatCompact(tally.lost)} lost
          </span>
        ) : (
          <span className="d">
            {tally.perHour === undefined ? '— / h' : `${formatCompact(tally.perHour)} / h`}
          </span>
        )}
      </div>
      <div className="s2">
        <span className="k">Played</span>
        <span className="v">{formatPlayed(tally.minutesPlayed)}</span>
        <span className="d">{since}</span>
      </div>
      <div className="s2">
        <span className="k">Travelled</span>
        <span className="v">
          {formatNumber(tally.jumps, 0)}
          <small>{tally.jumps === 1 ? 'jump' : 'jumps'}</small>
        </span>
        <span className="d">{formatNumber(tally.distanceLy, 0)} ly</span>
      </div>
      <div className="s2 s2-src">
        <span className="k">From</span>
        {shares.length === 0 ? (
          <span className="d">nothing yet</span>
        ) : (
          <>
            <div className="stack" style={{ margin: '10px 0' }}>
              {shares.map((share, index) => (
                <i
                  key={share.source}
                  style={{
                    flex: Math.max(share.share, 0.01),
                    background: SOURCE_COLOURS[Math.min(index, SOURCE_COLOURS.length - 1)],
                  }}
                  title={`${share.label}: ${formatNumber(share.share * 100, 0)}%`}
                />
              ))}
            </div>
            <div className="s2-legend">
              {shares.slice(0, 2).map((share, index) => (
                <Legend
                  key={share.source}
                  label={share.label}
                  value={share.value}
                  colour={SOURCE_COLOURS[index]!}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </>
  );
}

function Legend({ label, value, colour }: { label: string; value: number; colour: string }) {
  return (
    <>
      <span>
        <i className="sw" style={{ background: colour }} />
        {label}
      </span>
      <b>{formatCompact(value)}</b>
    </>
  );
}

/**
 * "06:00" if it was today (from 06:00, as the commander counts it), "17 Sep, 03:53" if not: to
 * the minute, as the strip has little room.
 */
function formatSince(ms: number): string {
  return sameDay(new Date(), new Date(ms)) ? formatShortTime(ms) : formatShortDateTime(ms);
}
