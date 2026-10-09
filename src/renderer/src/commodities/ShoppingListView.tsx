import { type DragEvent, type MouseEvent, type ReactNode, useState } from 'react';

import {
  mergeShopping,
  missingNeeds,
  parseShoppingCsv,
  remaining,
  type ShoppingItem,
  type ShoppingList,
  type ShoppingNeed,
} from '../../../shared/commodities';
import { Glyph } from '../hud/Glyph';
import { Suggest } from '../hud/Suggest';
import { formatNumber } from '../journal/format';
import { ScreenshotImport } from './ScreenshotImport';
import { useCommodityNameList } from './useCommodities';

let idCount = 0;
/** Ids for lines made in the window; the main process keeps whatever it is sent. */
const newId = () => `new-${Date.now()}-${++idCount}`;

const save = (items: ShoppingItem[]) => void window.edssi.commodities.setList(items);

/**
 * The shopping list: how much of each commodity is needed and how much is bought. Both can be
 * typed or stepped; bought also goes up by itself when the commodity is bought in the game. A CSV
 * of commodities and quantities can be imported, replacing the list or adding to it, and so can
 * screenshots of a construction site's colonisation panel; either can be dropped on the page.
 */
export function ShoppingListView({
  list,
  onPlan,
  dock,
}: {
  list: ShoppingList | undefined;
  onPlan: () => void;
  /** Docked along the bottom: the pinned plan. */
  dock?: ReactNode;
}) {
  const [problem, setProblem] = useState<string>();
  const [importing, setImporting] = useState<{ needs: ShoppingNeed[]; fileName: string }>();
  const [dragging, setDragging] = useState(false);
  const [clearing, setClearing] = useState(false);
  /** Open while screenshots of the colonisation panel are being read, with any dropped here. */
  const [screenshots, setScreenshots] = useState<{ files: File[] }>();

  if (!list) return <p className="comm-empty">Loading…</p>;
  const { items } = list;

  const change = (id: string, patch: Partial<ShoppingItem>) =>
    save(items.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  const remove = (id: string) => save(items.filter((item) => item.id !== id));
  const add = () => save([...items, { id: newId(), commodity: '', needed: 0, bought: 0 }]);

  /** An empty list takes the file as it is; otherwise the commander says how. */
  const imported = (needs: ShoppingNeed[], fileName: string) => {
    setProblem(undefined);
    if (items.length === 0) save(mergeShopping(items, needs, 'replace', newId));
    else setImporting({ needs, fileName });
  };
  const finishImport = (mode: 'replace' | 'add' | undefined) => {
    if (importing && mode) save(mergeShopping(items, importing.needs, mode, newId));
    setImporting(undefined);
  };
  const pick = () =>
    void window.edssi.commodities.pickCsv().then((outcome) => {
      if (!outcome) return;
      if ('error' in outcome) setProblem(outcome.error);
      else imported(outcome.result.needs, outcome.result.fileName);
    });
  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    const files = [...event.dataTransfer.files];
    const pictures = files.filter((file) => file.type.startsWith('image/'));
    if (pictures.length > 0) {
      setScreenshots({ files: pictures });
      return;
    }
    const file = files[0];
    if (!file) return;
    void file.text().then((text) => {
      try {
        imported(parseShoppingCsv(text), file.name);
      } catch (error) {
        setProblem(error instanceof Error ? error.message : String(error));
      }
    });
  };

  const missing = missingNeeds(items);
  const neededTotal = items.reduce((sum, item) => sum + item.needed, 0);
  const boughtTotal = items.reduce((sum, item) => sum + Math.min(item.bought, item.needed), 0);
  const leftTotal = missing.reduce((sum, need) => sum + need.quantity, 0);
  const share = neededTotal > 0 ? boughtTotal / neededTotal : 0;

  return (
    // A file can also be dropped here; the CSV and Screenshots buttons are the way in for the
    // keyboard.
    // oxlint-disable-next-line jsx-a11y/no-static-element-interactions
    <div
      className="comm-page"
      data-dragging={dragging || undefined}
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      <div className="list-sum">
        {items.length === 0 ? (
          <span className="sum-big">Nothing to buy</span>
        ) : leftTotal === 0 ? (
          <span className="sum-big">Everything bought</span>
        ) : (
          <>
            <span className="sum-big">{formatNumber(leftTotal, 0)} t</span>
            <span className="muted">left to buy</span>
          </>
        )}
        {neededTotal > 0 ? (
          <>
            <div
              className={share >= 1 ? 'bar thick good' : 'bar thick'}
              title={`${formatNumber(boughtTotal, 0)} of ${formatNumber(neededTotal, 0)} t bought`}
            >
              <i style={{ width: `${share * 100}%` }} />
            </div>
            <b className="hi" style={{ fontWeight: 500 }}>
              {formatNumber(share * 100, 0)}%
            </b>
          </>
        ) : (
          <span className="sp" />
        )}
        <span className="sep-v" />
        <button type="button" className="btn ghost sm" onClick={add}>
          <span className="ic-w">
            <Glyph name="plus" />
          </span>
          Add
        </button>
        <button type="button" className="btn ghost sm" title="Import a CSV" onClick={pick}>
          <span className="ic-w">
            <Glyph name="file" />
          </span>
          CSV
        </button>
        <button
          type="button"
          className="btn ghost sm"
          title="Read screenshots of a construction site's colonisation panel"
          onClick={() => setScreenshots({ files: [] })}
        >
          <span className="ic-w">
            <Glyph name="image" />
          </span>
          Screenshots
        </button>
        {missing.length > 0 && (
          <button type="button" className="btn primary sm" onClick={onPlan}>
            <span className="ic-w">
              <Glyph name="route" />
            </span>
            Plan
          </button>
        )}
        {items.length > 0 &&
          (clearing ? (
            <span className="confirm">
              Clear the list?
              <button
                type="button"
                className="link"
                onClick={() => {
                  save([]);
                  setClearing(false);
                }}
              >
                Clear
              </button>
              <button type="button" className="link" onClick={() => setClearing(false)}>
                Keep
              </button>
            </span>
          ) : (
            <button type="button" className="link" onClick={() => setClearing(true)}>
              Clear
            </button>
          ))}
      </div>
      {screenshots && (
        <ScreenshotImport
          initialFiles={screenshots.files}
          listEmpty={items.length === 0}
          onImport={(needs, mode) => save(mergeShopping(items, needs, mode, newId))}
          onClose={() => setScreenshots(undefined)}
        />
      )}
      {problem && (
        <p className="note danger comm-problem" role="alert">
          Couldn&apos;t import that file: {problem}
        </p>
      )}
      {importing && (
        <div className="note info import-ask" role="alertdialog" aria-label="Import">
          <span>
            {importing.needs.length} commodities in {importing.fileName}:
          </span>
          <button type="button" className="btn sm" onClick={() => finishImport('replace')}>
            Replace the list
          </button>
          <button type="button" className="btn sm" onClick={() => finishImport('add')}>
            Add to it
          </button>
          <button type="button" className="link" onClick={() => finishImport(undefined)}>
            Cancel
          </button>
        </div>
      )}
      {items.length === 0 ? (
        <p className="comm-empty">
          Add what you need to buy line by line, import a CSV of commodities and quantities (or drop
          one here), or read screenshots of a construction site&apos;s colonisation panel. What you
          buy in the game is counted as bought.
        </p>
      ) : (
        <div className="dock-top">
          <table className="tbl shop">
            <thead>
              <tr>
                <th scope="col">Commodity</th>
                <th scope="col" className="v">
                  Needed
                </th>
                <th scope="col" className="v">
                  Bought
                </th>
                <th scope="col" className="progress">
                  Progress
                </th>
                <th scope="col" className="v">
                  Left
                </th>
                <th scope="col">
                  <span className="visually-hidden">Remove</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const left = remaining(item);
                const done = item.needed > 0 && left === 0;
                const name = item.commodity || 'Commodity';
                return (
                  <tr key={item.id} className={done ? 'past' : undefined}>
                    <td>
                      <CommodityInput
                        value={item.commodity}
                        onChange={(commodity) => change(item.id, { commodity })}
                      />
                    </td>
                    <td className="v">
                      <Stepper
                        label={`${name} needed`}
                        value={item.needed}
                        onChange={(needed) => change(item.id, { needed })}
                      />
                    </td>
                    <td className="v">
                      <Stepper
                        label={`${name} bought`}
                        value={item.bought}
                        onChange={(bought) => change(item.id, { bought })}
                      />
                    </td>
                    <td>
                      <Progress share={item.needed > 0 ? item.bought / item.needed : 0} />
                    </td>
                    <td className="v shop-left">
                      {done ? (
                        <span className="done">
                          <span className="ic-w">
                            <Glyph name="check" />
                          </span>
                          done
                        </span>
                      ) : (
                        formatNumber(left, 0)
                      )}
                    </td>
                    <td style={{ width: 36 }}>
                      <button
                        type="button"
                        className="ibtn sm"
                        aria-label={`Remove ${item.commodity || 'line'}`}
                        title="Remove"
                        onClick={() => remove(item.id)}
                      >
                        <Glyph name="close" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td>
                  Total · {items.length} {items.length === 1 ? 'commodity' : 'commodities'}
                </td>
                <td className="v">{formatNumber(neededTotal, 0)}</td>
                <td className="v">{formatNumber(boughtTotal, 0)}</td>
                <td>
                  <Progress share={share} thick />
                </td>
                <td className="v shop-left">{formatNumber(leftTotal, 0)}</td>
                <td aria-hidden="true" />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      {dock}
    </div>
  );
}

/** How much of a line is bought, as a bar; green once all of it is. */
function Progress({ share, thick = false }: { share: number; thick?: boolean }) {
  const done = share >= 1;
  return (
    <div className={['bar', thick && 'thick', done && 'good'].filter(Boolean).join(' ')}>
      <i style={{ width: `${Math.min(1, share) * 100}%` }} />
      <span className="visually-hidden">{formatNumber(Math.min(1, share) * 100, 0)}% bought</span>
    </div>
  );
}

/** A commodity name, suggested from the markets' own list, kept once typing stops. */
function CommodityInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [draft, setDraft] = useDraft(value);
  const names = useCommodityNameList();
  const commit = () => {
    if (draft.trim() !== value) onChange(draft.trim());
  };
  return (
    <Suggest
      className="cell-input"
      value={draft}
      suggestions={names}
      placeholder="Commodity"
      aria-label="Commodity"
      spellCheck={false}
      onChange={setDraft}
      onPick={(picked) => {
        setDraft(picked);
        if (picked !== value) onChange(picked);
      }}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') commit();
      }}
    />
  );
}

/**
 * What is being typed, until it is kept; starts again from `value` whenever that changes, as it
 * does when the game buys or the other half of the list is edited.
 */
function useDraft(value: string): [string, (draft: string) => void] {
  const [draft, setDraft] = useState(value);
  const [from, setFrom] = useState(value);
  if (from !== value) {
    setFrom(value);
    setDraft(value);
  }
  return [draft, setDraft];
}

/** How far a step goes: 1, 10 with Shift, 100 with Ctrl. */
function stepOf(event: MouseEvent): number {
  if (event.ctrlKey) return 100;
  return event.shiftKey ? 10 : 1;
}

/** A whole number of tonnes, typed or stepped with − and +. */
function Stepper({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  const [draft, setDraft] = useDraft(formatNumber(value, 0));
  const commit = () => {
    const parsed = Math.floor(Number(draft.replaceAll(/[\s,]/g, '')));
    if (Number.isFinite(parsed) && parsed >= 0) {
      if (parsed !== value) onChange(parsed);
      else setDraft(formatNumber(value, 0));
    } else setDraft(formatNumber(value, 0));
  };
  return (
    <span className="stepper">
      <button
        type="button"
        aria-label={`Fewer ${label}`}
        title="Shift: 10, Ctrl: 100"
        disabled={value <= 0}
        onClick={(event) => onChange(Math.max(0, value - stepOf(event)))}
      >
        <Glyph name="minimize" />
      </button>
      <input
        inputMode="numeric"
        aria-label={label}
        value={draft}
        onFocus={(event) => event.target.select()}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit();
        }}
      />
      <button
        type="button"
        aria-label={`More ${label}`}
        title="Shift: 10, Ctrl: 100"
        onClick={(event) => onChange(value + stepOf(event))}
      >
        <Glyph name="plus" />
      </button>
    </span>
  );
}
