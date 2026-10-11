import { useEffect, useId, useRef, useState } from 'react';

import { commodityKey, type HoldItem } from '../../../shared/commodities';
import { useOpenDialog } from '../api/context';
import { NumberInput } from '../hud/Controls';
import { Glyph } from '../hud/Glyph';
import { formatNumber } from '../journal/format';

/** A hold to sell from: the ship's, or a carrier's. */
export interface HoldSource {
  id: string;
  label: string;
  items: HoldItem[];
  /** Said over the list, e.g. how far a carrier's cargo can be trusted. */
  note?: string;
}

/** A commodity to sell, and how many tonnes of it. */
export interface SellPick {
  commodity: string;
  tonnes: number;
}

/**
 * Picks commodities to sell from the ship's hold or a carrier's, and how much of each. The Sell
 * page then looks for markets buying every one picked.
 */
export function SellImport({
  sources,
  onImport,
  onClose,
}: {
  sources: HoldSource[];
  onImport: (picks: SellPick[]) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const rowId = useId();
  const [sourceId, setSourceId] = useState(sources[0]?.id);
  /** Tonnes by commodity key, for the ticked ones of the chosen hold. */
  const [picked, setPicked] = useState<Record<string, number>>({});

  const openDialog = useOpenDialog();
  useEffect(() => {
    if (dialog.current) openDialog(dialog.current);
  }, [openDialog]);

  const source = sources.find((known) => known.id === sourceId) ?? sources[0];
  const picks: SellPick[] = (source?.items ?? []).flatMap((item) => {
    const tonnes = picked[commodityKey(item.commodity)];
    return tonnes === undefined ? [] : [{ commodity: item.commodity, tonnes }];
  });
  const choose = (id: string) => {
    setSourceId(id);
    setPicked({});
  };
  const toggle = (item: HoldItem) =>
    setPicked((current) => {
      const key = commodityKey(item.commodity);
      const { [key]: was, ...rest } = current;
      return was === undefined ? { ...current, [key]: item.count } : rest;
    });
  const finish = () => {
    onImport(picks);
    onClose();
  };

  return (
    <dialog
      ref={dialog}
      className="modal sell-import"
      aria-label="Sell from a hold"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div className="modal-head">
        <h2 className="sec-title">Sell from a hold</h2>
        <button
          type="button"
          className="ibtn sm"
          aria-label="Close"
          title="Close"
          onClick={onClose}
        >
          <Glyph name="close" />
        </button>
      </div>
      {sources.length > 1 && (
        <fieldset className="seg" style={{ border: 0, margin: 0, padding: 0 }}>
          <legend className="visually-hidden">Hold</legend>
          {sources.map((known) => (
            <button
              key={known.id}
              type="button"
              aria-pressed={known.id === source?.id}
              onClick={() => choose(known.id)}
            >
              {known.label}
            </button>
          ))}
        </fieldset>
      )}
      {source?.note && <p className="muted">{source.note}</p>}
      {!source || source.items.length === 0 ? (
        <p className="comm-empty">
          {source ? `Nothing in the ${source.label.toLowerCase()} to sell.` : 'No hold is known.'}
        </p>
      ) : (
        <>
          <p className="muted">
            Markets must buy every commodity ticked, so a few at a time find the most.
          </p>
          <div className="modal-scroll">
            <table className="tbl sell-pick">
              <thead>
                <tr>
                  <th scope="col">
                    <span className="visually-hidden">Sell</span>
                  </th>
                  <th scope="col">Commodity</th>
                  <th scope="col" className="v">
                    Held
                  </th>
                  <th scope="col" className="v">
                    To sell
                  </th>
                </tr>
              </thead>
              <tbody>
                {source.items.map((item) => {
                  const key = commodityKey(item.commodity);
                  const tonnes = picked[key];
                  return (
                    <tr key={key} className={tonnes === undefined ? undefined : 'sel'}>
                      <td style={{ width: 34 }}>
                        <input
                          id={`${rowId}-${key}`}
                          type="checkbox"
                          aria-label={`Sell ${item.commodity}`}
                          checked={tonnes !== undefined}
                          onChange={() => toggle(item)}
                        />
                      </td>
                      <td>
                        {/* The name ticks the box too. */}
                        <label htmlFor={`${rowId}-${key}`}>{item.commodity}</label>
                      </td>
                      <td className="v">{formatNumber(item.count, 0)} t</td>
                      <td className="v" style={{ width: 130 }}>
                        <NumberInput
                          unit="t"
                          size="sm"
                          label={`Tonnes of ${item.commodity} to sell`}
                          value={tonnes ?? item.count}
                          min={1}
                          max={item.count}
                          onChange={(value) =>
                            setPicked((current) => ({ ...current, [key]: value }))
                          }
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
      <div className="modal-actions">
        <button type="button" className="btn sm" disabled={picks.length === 0} onClick={finish}>
          {picks.length > 1 ? `Sell these ${picks.length}` : 'Sell this'}
        </button>
        <button type="button" className="link" onClick={onClose}>
          Cancel
        </button>
      </div>
    </dialog>
  );
}
