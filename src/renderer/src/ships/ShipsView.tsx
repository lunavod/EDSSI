import { useEffect, useState } from 'react';

import type { CarriersSnapshot, CarrierView } from '../../../shared/carriers';
import type {
  CatalogStatus,
  ShipExportTarget,
  ShipsSnapshot,
  ShipView,
  SlotView,
  StockFit,
} from '../../../shared/ships';
import { Glyph } from '../hud/Glyph';
import { Select } from '../hud/Select';
import { formatCompact, formatNumber, formatShortDateTime } from '../journal/format';
import { join } from '../journal/summaries';
import { CarrierDetail } from './CarrierDetail';
import { carrierKindLabel, carrierTitle } from './carriers';
import {
  freeSlots,
  GROUP_TITLES,
  groupSlots,
  isOptional,
  shipTitle,
  sizeLabel,
  sizeTitle,
  slotLabel,
} from './ships';

/** Below this a module's health is worth a mention. */
const WORN = 0.995;

/**
 * The Ships module: every ship the commander owns down the side, and the one picked slot by slot,
 * with the empty slots from EDSY's tables for the hull. Any hull EDSY lists can be looked at as the
 * shipyard sells it. Their carriers, their own and their squadron's, are listed after the ships.
 */
export function ShipsView({
  snapshot,
  carriers: carrierSnapshot,
}: {
  snapshot: ShipsSnapshot | undefined;
  carriers?: CarriersSnapshot | undefined;
}) {
  const [picked, setPicked] = useState<number>();
  const [pickedCarrier, setPickedCarrier] = useState<string>();
  const [browsing, setBrowsing] = useState<string>();
  const hull = useStockFit(browsing);
  const ships = snapshot?.ships ?? [];
  const carriers = carrierSnapshot?.carriers ?? [];
  const carrier =
    browsing === undefined
      ? carriers.find((candidate) => candidate.carrierId === pickedCarrier)
      : undefined;
  const owned = ships.find((candidate) => candidate.shipId === picked) ?? ships[0];
  const ship = browsing === undefined ? owned : hull && stockShip(hull);

  if (!snapshot?.ready) {
    return (
      <div className="empty">
        <h3>Reading journals…</h3>
      </div>
    );
  }

  return (
    <div className="sh-cols">
      <nav className="sh-list" aria-label="Ships">
        {snapshot.hulls.length > 0 && (
          <Select
            className="sh-browse"
            aria-label="Look at a hull as the shipyard sells it"
            value={browsing ?? ''}
            options={[
              { value: '', label: 'Stock hulls…' },
              ...snapshot.hulls.map((candidate) => ({
                value: candidate.ship,
                label: candidate.type,
              })),
            ]}
            onChange={(next) => {
              setBrowsing(next || undefined);
              setPickedCarrier(undefined);
            }}
          />
        )}
        {ships.map((candidate) => (
          <ShipButton
            key={candidate.shipId}
            ship={candidate}
            selected={browsing === undefined && !carrier && candidate === owned}
            onSelect={() => {
              setBrowsing(undefined);
              setPickedCarrier(undefined);
              setPicked(candidate.shipId);
            }}
          />
        ))}
        {carriers.length > 0 && <span className="kicker sh-list-head">Carriers</span>}
        {carriers.map((candidate) => (
          <CarrierButton
            key={candidate.carrierId}
            carrier={candidate}
            selected={candidate === carrier}
            onSelect={() => {
              setBrowsing(undefined);
              setPickedCarrier(candidate.carrierId);
            }}
          />
        ))}
      </nav>
      <div className="sh-detail">
        {carrier ? (
          <CarrierDetail carrier={carrier} />
        ) : ship ? (
          <ShipDetail ship={ship} catalog={snapshot.catalog} browsing={browsing !== undefined} />
        ) : browsing === undefined ? (
          <div className="empty">
            <h3>No ships yet</h3>
            <p>A ship shows up here once the journal has its loadout: board one in the game.</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** A hull as the shipyard sells it, asked of the main process when one is picked. */
function useStockFit(ship: string | undefined): StockFit | undefined {
  const [fit, setFit] = useState<StockFit>();
  useEffect(() => {
    let active = true;
    if (ship !== undefined) {
      window.edssi.ships.stockFit(ship).then(
        (next) => {
          if (active) setFit(next);
        },
        (error: unknown) => console.error('[ships] failed to load a stock fit', error),
      );
    }
    return () => {
      active = false;
    };
  }, [ship]);
  return fit?.ship === ship ? fit : undefined;
}

/** A stock fit, shown the way an owned ship is. */
function stockShip(fit: StockFit): ShipView {
  return {
    shipId: -1,
    ship: fit.ship,
    type: fit.type,
    current: false,
    layout: 'stock',
    slots: fit.slots,
    prices: fit.prices,
  };
}
function ShipButton({
  ship,
  selected,
  onSelect,
}: {
  ship: ShipView;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button type="button" className="sh-item" aria-current={selected} onClick={onSelect}>
      <span className="sh-item-name">{shipTitle(ship)}</span>
      <span className="sh-item-type">
        {join(ship.name?.trim() ? ship.type : undefined, ship.ident)}
      </span>
      <span className="sh-item-where">
        {ship.current ? (
          <span className="tag solid">Flying</span>
        ) : (
          <span className="micro ellip" title={ship.where}>
            {ship.inTransit
              ? ship.where === undefined
                ? 'In transit'
                : `In transit to ${ship.where}`
              : (ship.where ?? 'Stored')}
          </span>
        )}
      </span>
    </button>
  );
}

function CarrierButton({
  carrier,
  selected,
  onSelect,
}: {
  carrier: CarrierView;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button type="button" className="sh-item" aria-current={selected} onClick={onSelect}>
      <span className="sh-item-name">{carrierTitle(carrier)}</span>
      <span className="sh-item-type">
        {join(carrierKindLabel(carrier.kind), carrier.name ? carrier.callsign : undefined)}
      </span>
      <span className="sh-item-where">
        {carrier.jump ? (
          <span className="tag solid">Jumping</span>
        ) : (
          carrier.fuel && <span className="tag ghost">{carrier.fuel.level} t</span>
        )}
        <span className="micro ellip" title={carrier.system}>
          {carrier.jump ? `To ${carrier.jump.system}` : (carrier.system ?? 'Somewhere')}
        </span>
      </span>
    </button>
  );
}

function ShipDetail({
  ship,
  catalog,
  browsing,
}: {
  ship: ShipView;
  catalog: CatalogStatus;
  /** A hull picked from the list of stock hulls, rather than one the commander owns. */
  browsing: boolean;
}) {
  const free = freeSlots(ship);
  const stock = ship.layout === 'stock';
  const hasSlots = ship.stats !== undefined || stock;
  return (
    <>
      <header className="sh-head">
        <div className="col">
          <h2 className="sh-name">{shipTitle(ship)}</h2>
          <div className="sh-sub">
            {browsing
              ? 'As the shipyard sells it'
              : join(ship.name?.trim() ? ship.type : undefined, ship.ident)}
            {!ship.current && ship.where !== undefined && (
              <span className="dim">
                {' '}
                · {ship.inTransit ? 'in transit to' : 'at'} {ship.where}
              </span>
            )}
          </div>
        </div>
        <span className="sp" />
        {ship.current && <span className="tag solid">Flying</span>}
        {stock && <span className="tag ghost">Stock fit</span>}
        {hasSlots && (
          <span className={free.length > 0 ? 'tag' : 'tag ghost'}>
            {free.length} {free.length === 1 ? 'slot' : 'slots'} free
          </span>
        )}
      </header>

      {ship.stats && <ExportBar ship={ship} />}

      {ship.stats ? (
        <div className="sh-stats">
          <Stat label="Jump range" value={formatNumber(ship.stats.maxJumpRange)} unit="ly" />
          <Stat label="Cargo" value={formatNumber(ship.stats.cargoCapacity, 0)} unit="t" />
          <Stat label="Fuel" value={formatNumber(ship.stats.fuelMain, 1)} unit="t" />
          <Stat label="Unladen" value={formatNumber(ship.stats.unladenMass, 1)} unit="t" />
          <Stat label="Rebuy" value={formatCompact(ship.stats.rebuy)} unit="CR" />
          {ship.stats.hullValue !== undefined && ship.stats.modulesValue !== undefined && (
            <Stat
              label="Value"
              value={formatCompact(ship.stats.hullValue + ship.stats.modulesValue)}
              unit="CR"
            />
          )}
        </div>
      ) : stock ? (
        <>
          {(ship.prices?.retail !== undefined || ship.prices?.hull !== undefined) && (
            <div className="sh-stats">
              {ship.prices.retail !== undefined && (
                <Stat label="Shipyard price" value={formatCompact(ship.prices.retail)} unit="CR" />
              )}
              {ship.prices.hull !== undefined && (
                <Stat label="Hull alone" value={formatCompact(ship.prices.hull)} unit="CR" />
              )}
            </div>
          )}
          {!browsing && (
            <p className="note info">
              <span className="ic-w">
                <Glyph name="warning" />
              </span>
              <span>
                The journal hasn't shown this ship's loadout yet, so this is the hull as the
                shipyard sells it; yours may be fitted differently. Fly it once to see its own.
              </span>
            </p>
          )}
        </>
      ) : (
        <p className="note info">
          <span className="ic-w">
            <Glyph name="warning" />
          </span>
          <span>
            The journal hasn't shown this ship's loadout yet. Fly it once and every slot will show
            here.
          </span>
        </p>
      )}

      {ship.stats && ship.layout === 'journal' && <JournalOnlyNote ship={ship} catalog={catalog} />}

      {hasSlots &&
        groupSlots(ship).map(({ group, slots }) => {
          const optional = slots.filter(isOptional);
          const fitted = optional.filter((slot) => slot.module).length;
          return (
            <section key={group} className="sec" aria-label={GROUP_TITLES[group]}>
              <div className="sec-head">
                <h3 className="sec-title">{GROUP_TITLES[group]}</h3>
                {optional.length > 0 && (
                  <div className="sec-meta">
                    <span>
                      <b>{fitted}</b> of {optional.length} fitted
                    </span>
                  </div>
                )}
              </div>
              <table className="tbl compact sh-slots">
                <tbody>
                  {slots.map((slot) => (
                    <SlotRow key={slot.slot} slot={slot} markStock={!stock} />
                  ))}
                </tbody>
              </table>
            </section>
          );
        })}

      <CatalogFoot ship={ship} catalog={catalog} />
    </>
  );
}
function Stat({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="stat">
      <span className="k">{label}</span>
      <span className="v">
        {value}
        {unit && <small>{unit}</small>}
      </span>
    </div>
  );
}

function SlotRow({
  slot,
  markStock,
}: {
  slot: SlotView;
  /** Tag what is still as the shipyard sold it; pointless when the whole ship is. */
  markStock: boolean;
}) {
  const { module } = slot;
  const size = sizeLabel(slot);
  return (
    <tr className={module ? undefined : 'sh-empty'}>
      <td>
        {size !== undefined && (
          <span className="sh-size-box" title={sizeTitle(slot)}>
            {size}
          </span>
        )}
      </td>
      <td>
        <div className="sh-module">
          {module ? (
            <>
              {module.grade !== undefined && <span className="sh-grade">{module.grade}</span>}
              <span className="sh-module-text">
                <span
                  className="sh-module-name"
                  title={join(module.name, module.mount, module.item)}
                >
                  {module.name}
                  {module.mount !== undefined && <span className="dim"> · {module.mount}</span>}
                </span>
                {module.engineering && (
                  <span
                    className="sh-eng"
                    title={join(
                      module.engineering.engineer,
                      `${Math.round(module.engineering.quality * 100)}% of grade ${module.engineering.level}`,
                    )}
                  >
                    <b>G{module.engineering.level}</b> {module.engineering.blueprint}
                    {module.engineering.experimental !== undefined && (
                      <span className="dim"> · {module.engineering.experimental}</span>
                    )}
                  </span>
                )}
              </span>
            </>
          ) : (
            <span className="sh-module-name">
              <span className="sh-free">Empty</span>
              {slot.only !== undefined && <span className="dim"> · {slot.only} only</span>}
            </span>
          )}
          <span className="sp" />
          {slot.unlisted && (
            <span className="tag warn" title="EDSY doesn't list this slot for the hull">
              Not in EDSY
            </span>
          )}
          {markStock && slot.stock && (
            <span className="tag ghost" title="As the shipyard sells the hull">
              Stock
            </span>
          )}
          {module && !module.on && <span className="tag ghost">Off</span>}
          {module && module.health < WORN && (
            <span className={module.health < 0.5 ? 'tag danger' : 'tag warn'}>
              {Math.round(module.health * 100)}%
            </span>
          )}
        </div>
      </td>
      <td>{slotLabel(slot.slot)}</td>
    </tr>
  );
}

const EXPORTS: readonly { target: ShipExportTarget; label: string; title: string }[] = [
  { target: 'edsy', label: 'EDSY', title: 'Open this loadout in EDSY' },
  { target: 'coriolis', label: 'Coriolis', title: 'Open this loadout in Coriolis' },
  { target: 'csv', label: 'CSV', title: 'Save every slot as a CSV file' },
];

/** Sends the ship's last loadout to EDSY or Coriolis, or saves its slots as a CSV. */
function ExportBar({ ship }: { ship: ShipView }) {
  const [problem, setProblem] = useState<{ shipId: number; text: string }>();
  const send = (target: ShipExportTarget) => {
    setProblem(undefined);
    void window.edssi.ships.export(ship.shipId, target).then(
      (text) => text !== undefined && setProblem({ shipId: ship.shipId, text }),
      (error: unknown) => setProblem({ shipId: ship.shipId, text: String(error) }),
    );
  };
  return (
    <div className="sh-export">
      <span className="kicker">Export</span>
      {EXPORTS.map(({ target, label, title }) => (
        <button
          key={target}
          type="button"
          className="btn sm ghost"
          title={title}
          onClick={() => send(target)}
        >
          <span className="ic-w">
            <Glyph name={target === 'csv' ? 'file' : 'upload'} />
          </span>
          {label}
        </button>
      ))}
      {problem?.shipId === ship.shipId && <span className="warn">{problem.text}</span>}
    </div>
  );
}

function JournalOnlyNote({ ship, catalog }: { ship: ShipView; catalog: CatalogStatus }) {
  return (
    <p className="note">
      <span className="ic-w">
        <Glyph name="warning" />
      </span>
      <span>
        {catalog.state === 'ready'
          ? `EDSY doesn't list the ${ship.type} yet, so only slots seen filled on it are shown.`
          : catalog.state === 'loading'
            ? 'Fetching slot tables from EDSY… Until then only slots seen filled are shown.'
            : 'EDSY’s slot tables couldn’t be fetched, so only slots seen filled are shown.'}
      </span>
    </p>
  );
}

function CatalogFoot({ ship, catalog }: { ship: ShipView; catalog: CatalogStatus }) {
  const [checking, setChecking] = useState(false);
  const check = () => {
    setChecking(true);
    void window.edssi.ships.refreshCatalog().finally(() => setChecking(false));
  };
  return (
    <footer className="sh-foot">
      <span>
        Slot tables from{' '}
        <a className="link" href="https://edsy.org" target="_blank" rel="noreferrer">
          EDSY
        </a>{' '}
        by taleden, CC BY-NC 4.0
        {catalog.modified !== undefined && <>, database of {catalog.modified}</>}
        {catalog.fetchedAt !== undefined && <>; checked {formatShortDateTime(catalog.fetchedAt)}</>}
        .
        {catalog.error !== undefined && (
          <span className="warn"> Last check failed: {catalog.error}</span>
        )}
        {ship.seenAt !== undefined && (
          <span className="dim"> Loadout as of {formatShortDateTime(ship.seenAt)}.</span>
        )}
      </span>
      <span className="sp" />
      <button type="button" className="btn sm ghost" disabled={checking} onClick={check}>
        <span className="ic-w">
          <Glyph name="reload" />
        </span>
        {checking ? 'Checking…' : 'Check EDSY'}
      </button>
    </footer>
  );
}
