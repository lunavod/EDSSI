import {
  CARRIER_FUEL_CAPACITY,
  type CarrierUpkeep,
  type CarrierSpace,
  type CarrierView,
} from '../../../shared/carriers';
import { Glyph } from '../hud/Glyph';
import { countdown } from '../hud/SidePanel';
import { useNow } from '../hud/useNow';
import {
  formatCompact,
  formatNumber,
  formatShortDate,
  formatShortDateTime,
} from '../journal/format';
import { join } from '../journal/summaries';
import { carrierKindLabel, carrierTitle, dockingAccessLabel } from './carriers';

/** A carrier: where it is and is going, its tritium, its space and what it holds. */
export function CarrierDetail({ carrier }: { carrier: CarrierView }) {
  const fuel = carrier.fuel;
  return (
    <>
      <header className="sh-head">
        <div className="col">
          <h2 className="sh-name">{carrierTitle(carrier)}</h2>
          <div className="sh-sub">
            {join(carrierKindLabel(carrier.kind), carrier.name ? carrier.callsign : undefined)}
          </div>
        </div>
        <span className="sp" />
        {carrier.jump && <span className="tag solid">Jump scheduled</span>}
        {carrier.decommissionAt !== undefined && (
          <span className="tag danger">
            Decommissioning {formatShortDateTime(carrier.decommissionAt)}
          </span>
        )}
      </header>

      <Where carrier={carrier} />

      <div className="sh-stats">
        {fuel && (
          <div className="stat cr-fuel">
            <span className="k">Tritium{fuel.estimated ? ' (est.)' : ''}</span>
            <span className="v">
              {formatNumber(fuel.level, 0)}
              <small>/ {formatNumber(CARRIER_FUEL_CAPACITY, 0)} t</small>
            </span>
            <span
              className={
                carrier.jumpsLeft !== undefined && carrier.jumpsLeft < 2 ? 'bar warn' : 'bar'
              }
              aria-hidden="true"
            >
              <i
                style={{ width: `${Math.min(100, (fuel.level / CARRIER_FUEL_CAPACITY) * 100)}%` }}
              />
            </span>
          </div>
        )}
        {carrier.jumpsLeft !== undefined && (
          <div className="stat">
            <span className="k">Full jumps left</span>
            <span className="v">{carrier.jumpsLeft}</span>
            <span className="d">
              {formatNumber(carrier.rangeLy, 0)} ly
              {carrier.fullJumpFuel !== undefined && <>, {carrier.fullJumpFuel} t each</>}
            </span>
          </div>
        )}
        {carrier.space && (
          <>
            <div className="stat">
              <span className="k">Cargo</span>
              <span className="v">
                {formatNumber(carrier.space.cargo, 0)}
                <small>t</small>
              </span>
            </div>
            <div className="stat">
              <span className="k">Free</span>
              <span className="v">
                {formatNumber(carrier.space.free, 0)}
                <small>t</small>
              </span>
            </div>
          </>
        )}
        {carrier.finance && (
          <div className="stat">
            <span className="k">Balance{carrier.upkeep?.balanceEstimated ? ' (est.)' : ''}</span>
            <span className="v">
              {formatCompact(carrier.upkeep?.balance ?? carrier.finance.balance)}
              <small>CR</small>
            </span>
            {!carrier.upkeep?.balanceEstimated &&
              carrier.finance.available !== carrier.finance.balance && (
                <span className="d">{formatCompact(carrier.finance.available)} CR available</span>
              )}
          </div>
        )}
      </div>

      <FuelNote carrier={carrier} />

      <Cargo carrier={carrier} />

      {carrier.space && <Space space={carrier.space} />}

      {carrier.upkeep && <Upkeep carrier={carrier} upkeep={carrier.upkeep} />}

      {!carrier.upkeep && (carrier.services.length > 0 || carrier.dockingAccess !== undefined) && (
        <section className="sec" aria-label="Services">
          <div className="sec-head">
            <h3 className="sec-title">Services</h3>
            {carrier.dockingAccess !== undefined && (
              <div className="sec-meta">
                <span>
                  Docking: <b>{dockingAccessLabel(carrier.dockingAccess)}</b>
                  {carrier.allowNotorious && ', notorious allowed'}
                </span>
              </div>
            )}
          </div>
          {carrier.services.length > 0 && (
            <div className="cr-tags">
              {carrier.services.map((service) => (
                <span
                  key={service.role}
                  className={service.state === 'active' ? 'tag' : 'tag ghost'}
                >
                  {service.name}
                </span>
              ))}
            </div>
          )}
        </section>
      )}

      <footer className="sh-foot">
        <span>
          {carrier.statsAt === undefined
            ? 'Open the carrier’s management screen in the game once for its fuel, space and balance.'
            : `Exact as of the management screen, ${formatShortDateTime(carrier.statsAt)}; moves since are from the journal.`}
        </span>
      </footer>
    </>
  );
}

/** What it costs a week, service by service, and how long the balance pays for it. */
function Upkeep({ carrier, upkeep }: { carrier: CarrierView; upkeep: CarrierUpkeep }) {
  const short = upkeep.weeksCovered <= 1;
  return (
    <section className="sec" aria-label="Services and upkeep">
      <div className="sec-head">
        <h3 className="sec-title">Services and upkeep</h3>
        {carrier.dockingAccess !== undefined && (
          <div className="sec-meta">
            <span>
              Docking: <b>{dockingAccessLabel(carrier.dockingAccess)}</b>
              {carrier.allowNotorious && ', notorious allowed'}
            </span>
          </div>
        )}
      </div>
      <div className="sh-stats">
        <div className="stat">
          <span className="k">A week</span>
          <span className="v">
            {formatCompact(upkeep.weekly)}
            <small>CR</small>
          </span>
          <span className="d">+ {formatCompact(upkeep.perJump)} CR a jump</span>
        </div>
        <div className="stat">
          <span className="k">Next charge</span>
          <span className="v">
            {formatCompact(upkeep.nextCharge)}
            <small>CR</small>
          </span>
          <span className="d">
            {formatShortDateTime(upkeep.nextChargeAt)}
            {upkeep.jumpsThisWeek > 0 &&
              `, ${upkeep.jumpsThisWeek} ${upkeep.jumpsThisWeek === 1 ? 'jump' : 'jumps'}`}
          </span>
        </div>
        <div className="stat">
          <span className="k">Balance lasts</span>
          <span className={short ? 'v warn' : 'v'}>
            {upkeep.weeksCovered}
            <small>{upkeep.weeksCovered === 1 ? 'week' : 'weeks'}</small>
          </span>
          <span className="d">In debt from {formatShortDate(upkeep.debtAt)}</span>
        </div>
      </div>
      <table className="tbl compact cr-upkeep">
        <tbody>
          <tr>
            <td>Base fee</td>
            <td className="dim" title="Bridge crew, market and tritium depot">
              Core crew
            </td>
            <td className="v">{formatNumber(upkeep.base, 0)}</td>
          </tr>
          {carrier.services.map((service) => (
            <tr key={service.role} className={service.state === 'suspended' ? 'past' : undefined}>
              <td>{service.name}</td>
              <td className="dim">{service.state === 'suspended' ? 'Suspended' : 'Running'}</td>
              <td className="v">
                {service.weekly === undefined ? '?' : formatNumber(service.weekly, 0)}
              </td>
            </tr>
          ))}
          {upkeep.jumpsThisWeek > 0 && (
            <tr>
              <td>Jump maintenance</td>
              <td className="dim">
                {upkeep.jumpsThisWeek} × {formatNumber(upkeep.perJump, 0)} since last Thursday
              </td>
              <td className="v">{formatNumber(upkeep.jumpsThisWeek * upkeep.perJump, 0)}</td>
            </tr>
          )}
        </tbody>
      </table>
      <p className="hint">
        Costs from the Elite Dangerous wiki, taken every Thursday at 07:00 UTC; takings from tariffs
        aren’t in the journal, so the balance only goes down here.
        {upkeep.balanceEstimated &&
          ` The balance is the last reading (${formatShortDateTime(carrier.finance?.readAt ?? upkeep.nextChargeAt)}) less the upkeep taken since.`}
        {upkeep.unknownServices.length > 0 &&
          ` The cost of ${upkeep.unknownServices.join(', ')} isn’t known, so it isn’t counted.`}
      </p>
    </section>
  );
}

/** Where it is, how far that is, and the jump it has scheduled. */
function Where({ carrier }: { carrier: CarrierView }) {
  return (
    <div className="cr-where">
      <div className="cr-place">
        <span className="kicker">Location</span>
        <span className="cr-system">{carrier.system ?? 'Unknown'}</span>
        <span className="micro">
          {join(
            carrier.body,
            carrier.distanceLy === undefined
              ? undefined
              : carrier.distanceLy < 0.01
                ? 'in your system'
                : `${formatNumber(carrier.distanceLy, 1)} ly from you`,
            carrier.arrivedAt === undefined
              ? undefined
              : `since ${formatShortDateTime(carrier.arrivedAt)}`,
          )}
        </span>
      </div>
      {carrier.jump && <Jump jump={carrier.jump} />}
    </div>
  );
}

function Jump({ jump }: { jump: NonNullable<CarrierView['jump']> }) {
  const now = useNow();
  const left = Date.parse(jump.departs) - now;
  return (
    <div className="cr-place cr-jump">
      <span className="kicker">Jumping to</span>
      <span className="cr-system">{jump.system}</span>
      <span className="micro">
        {join(
          jump.body,
          jump.distanceLy === undefined ? undefined : `${formatNumber(jump.distanceLy, 1)} ly`,
          jump.fuel === undefined ? undefined : `about ${jump.fuel} t of tritium`,
        )}
      </span>
      <span className={left < 60_000 ? 'cr-countdown warn' : 'cr-countdown'}>
        {left > 0 ? `Departs in ${countdown(left)}` : 'Departing'}
      </span>
    </div>
  );
}

function FuelNote({ carrier }: { carrier: CarrierView }) {
  const fuel = carrier.fuel;
  if (!fuel) return null;
  if (fuel.uncounted > 0) {
    return (
      <p className="note">
        <span className="ic-w">
          <Glyph name="warning" />
        </span>
        <span>
          {fuel.uncounted === 1 ? 'One jump' : `${fuel.uncounted} jumps`} since the last reading (
          {formatShortDateTime(fuel.readAt)}) couldn’t be counted, as a system on the way has no
          known position. Open the carrier’s management screen for the real figure.
        </span>
      </p>
    );
  }
  if (!fuel.estimated) return null;
  return (
    <p className="note info">
      <span className="ic-w">
        <Glyph name="fuel" />
      </span>
      <span>
        Tritium read at {formatShortDateTime(fuel.readAt)}, less what the jumps since burned by the
        game’s formula.
      </span>
    </p>
  );
}

function Cargo({ carrier }: { carrier: CarrierView }) {
  const { cargo, unaccounted } = carrier;
  const listed = cargo.reduce((sum, item) => sum + item.count, 0);
  return (
    <section className="sec" aria-label="Cargo">
      <div className="sec-head">
        <h3 className="sec-title">Cargo</h3>
        <div className="sec-meta">
          <span>
            <b>{formatNumber(listed, 0)}</b> t in {cargo.length}{' '}
            {cargo.length === 1 ? 'commodity' : 'commodities'}
          </span>
        </div>
      </div>
      {unaccounted !== undefined && (
        <p className="note">
          <span className="ic-w">
            <Glyph name="warning" />
          </span>
          <span>
            {unaccounted > 0
              ? `${formatNumber(unaccounted, 0)} t more is aboard than this list shows: trades at its market by others, or ${carrier.kind === 'squadron' ? 'cargo the rest of the squadron moved' : 'moves from before the journals on this PC'}.`
              : `The carrier holds ${formatNumber(-unaccounted, 0)} t less than this list: something left it that the journal didn’t record, likely bought at its market by others.`}
          </span>
        </p>
      )}
      {cargo.length > 0 ? (
        <table className="tbl compact cr-cargo">
          <tbody>
            {cargo.map((item) => (
              <tr key={item.type}>
                <td>{item.name}</td>
                <td className="v">{formatNumber(item.count, 0)} t</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        unaccounted === undefined && (
          <p className="hint">Nothing moved aboard in the journals EDSSI has read.</p>
        )
      )}
    </section>
  );
}

/** How the capacity is taken, as one bar and its parts. */
function Space({ space }: { space: CarrierSpace }) {
  const parts: [string, number, string][] = [
    ['Crew', space.crew, 'cr-crew'],
    ['Cargo', space.cargo, 'cr-cargo-part'],
    ['Buy orders', space.reserved, 'cr-reserved'],
    ['Ship packs', space.shipPacks, 'cr-packs'],
    ['Module packs', space.modulePacks, 'cr-packs'],
  ];
  const used = space.capacity - space.free;
  const other = used - parts.reduce((sum, [, tonnes]) => sum + tonnes, 0);
  // A squadron carrier's management screen lists less than it uses; the rest shows as other.
  if (other > 0) parts.push(['Other', other, 'cr-other']);
  const shown = parts.filter(([, tonnes]) => tonnes > 0);
  return (
    <section className="sec" aria-label="Space">
      <div className="sec-head">
        <h3 className="sec-title">Space</h3>
        <div className="sec-meta">
          <span>
            <b>{formatNumber(used, 0)}</b> of {formatNumber(space.capacity, 0)} t used
          </span>
        </div>
      </div>
      <div className="cr-space" aria-hidden="true">
        {shown.map(([label, tonnes, className]) => (
          <i
            key={label}
            className={className}
            style={{ width: `${(tonnes / space.capacity) * 100}%` }}
            title={`${label}: ${formatNumber(tonnes, 0)} t`}
          />
        ))}
      </div>
      <div className="cr-legend">
        {shown.map(([label, tonnes, className]) => (
          <span key={label}>
            <i className={className} /> {label} <b>{formatNumber(tonnes, 0)} t</b>
          </span>
        ))}
        <span>
          <i className="cr-free" /> Free <b>{formatNumber(space.free, 0)} t</b>
        </span>
      </div>
    </section>
  );
}
