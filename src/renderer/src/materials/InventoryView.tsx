import { useDeferredValue, useMemo, useState } from 'react';

import {
  FAMILIES,
  familyLabel,
  isTradeable,
  MATERIAL_CAPS,
  materialOrder,
  reservedMaterials,
  TRADED_CATEGORIES,
  type TradedCategory,
} from '../../../shared/crafting';
import {
  type MaterialInfo,
  MATERIALS,
  type MaterialsSnapshot,
  materialInfo,
  materialName,
} from '../../../shared/materials';
import { Switch } from '../hud/Controls';
import { Glyph } from '../hud/Glyph';
import { formatNumber } from '../journal/format';

const NO_INVENTORY: Readonly<Record<string, number>> = {};
const GRADES = [1, 2, 3, 4, 5] as const;

/** Share of a grade's slots at which a material is nearly full: more collected would be lost. */
const NEARLY_FULL = 0.9;

/** Every material of a category, by family and grade; grades the category lacks left out. */
function familyGrid(category: TradedCategory): {
  grades: number[];
  rows: { family: string; cells: (string | undefined)[] }[];
} {
  const byFamily = new Map<string, (string | undefined)[]>();
  for (const [name, info] of Object.entries(MATERIALS)) {
    if (info.category !== category || !info.family || !info.grade) continue;
    let cells = byFamily.get(info.family);
    if (!cells) {
      cells = [undefined, undefined, undefined, undefined, undefined];
      byFamily.set(info.family, cells);
    }
    // A few families have two of a grade in EDDiscovery's tables (an old name kept): the first.
    cells[info.grade - 1] ??= name;
  }
  const rows = FAMILIES[category]
    .filter((family) => byFamily.has(family))
    .map((family) => ({ family, cells: byFamily.get(family)! }));
  const grades = GRADES.filter((grade) => rows.some((row) => row.cells[grade - 1] !== undefined));
  return {
    grades,
    rows: rows.map((row) => ({ ...row, cells: grades.map((grade) => row.cells[grade - 1]) })),
  };
}

/**
 * The Materials module's Inventory page: ship materials as the game lays them out, a row per
 * family and a column per grade, each against its grade's slots and what the to-do lists hold
 * back; then what is in the hold and the ship locker.
 */
export function InventoryView({ snapshot }: { snapshot: MaterialsSnapshot | undefined }) {
  const [query, setQuery] = useState('');
  const [heldOnly, setHeldOnly] = useState(false);
  const needle = useDeferredValue(query).trim().toLowerCase();
  const inventory = snapshot?.inventory ?? NO_INVENTORY;
  const todos = snapshot?.todos;
  const standings = snapshot?.engineers;
  const reserved = useMemo(
    () => reservedMaterials(todos ?? [], standings ?? []),
    [todos, standings],
  );
  const grids = useMemo(
    () => TRADED_CATEGORIES.map((category) => ({ category, ...familyGrid(category) })),
    [],
  );
  const matches = (name: string) =>
    (needle === '' || materialName(name).toLowerCase().includes(needle)) &&
    (!heldOnly || (inventory[name] ?? 0) > 0);

  const others = Object.entries(inventory)
    .filter(
      ([name]) => !TRADED_CATEGORIES.some((category) => category === materialInfo(name)?.category),
    )
    .toSorted(([a], [b]) => materialOrder(a) - materialOrder(b));
  const cargo = others.filter(([name]) => materialInfo(name)?.category === 'Commodity');
  const locker = others.filter(([name]) => materialInfo(name)?.category !== 'Commodity');

  if (!snapshot?.ready) return <p className="mat-empty">Reading journals…</p>;
  return (
    <>
      <div className="mat-bar">
        <label className="input">
          <span className="ic-w">
            <Glyph name="search" />
          </span>
          <input
            type="search"
            placeholder="Find…"
            aria-label="Find a material"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <Switch
          checked={heldOnly}
          label="Only what I have"
          title="Grey out the materials you have none of"
          onChange={setHeldOnly}
        />
        <span className="sp" />
        <span className="inv-legend">
          <i className="inv-key reserved" /> Held back by the to-dos
          <i className="inv-key full" /> Nearly full
        </span>
      </div>
      <div className="mat-scroll">
        {grids.map(({ category, grades, rows }) => {
          const held = rows.reduce(
            (sum, row) =>
              sum +
              row.cells.reduce((cells, name) => cells + (name ? (inventory[name] ?? 0) : 0), 0),
            0,
          );
          return (
            <section key={category} className="sec" aria-label={category}>
              <div className="sec-head">
                <h2 className="sec-title">{category}</h2>
                <div className="sec-meta">
                  <span>
                    <b>{formatNumber(held, 0)}</b> held
                  </span>
                </div>
              </div>
              <table className="inv-grid">
                <thead>
                  <tr>
                    <th scope="col">
                      <span className="visually-hidden">Family</span>
                    </th>
                    {grades.map((grade) => (
                      <th key={grade} scope="col">
                        Grade {grade}
                        <span className="dim"> · {MATERIAL_CAPS[grade]}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const tradeable = isTradeable(materialInfo(row.cells.find(Boolean) ?? ''));
                    return (
                      <tr key={row.family}>
                        <th
                          scope="row"
                          title={tradeable ? undefined : "Material traders won't take these"}
                        >
                          {familyLabel(row.family)}
                          {!tradeable && <span className="inv-untraded">No trade</span>}
                        </th>
                        {row.cells.map((name, index) =>
                          name ? (
                            <MaterialCell
                              key={name}
                              name={name}
                              info={materialInfo(name)}
                              have={inventory[name] ?? 0}
                              reserved={reserved[name] ?? 0}
                              dimmed={!matches(name)}
                            />
                          ) : (
                            <td
                              key={`${row.family}-${grades[index]}`}
                              className="inv-none"
                              aria-label={`No grade ${grades[index]} ${familyLabel(row.family)}`}
                            />
                          ),
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </section>
          );
        })}
        <div className="inv-others">
          <OtherList
            title="Cargo"
            empty="Nothing in the hold."
            items={cargo.filter(([name]) => matches(name))}
            reserved={reserved}
          />
          <OtherList
            title="Ship locker"
            empty="Nothing in the locker."
            items={locker.filter(([name]) => matches(name))}
            reserved={reserved}
          />
        </div>
      </div>
    </>
  );
}

function MaterialCell({
  name,
  info,
  have,
  reserved,
  dimmed,
}: {
  name: string;
  info: MaterialInfo | undefined;
  have: number;
  reserved: number;
  dimmed: boolean;
}) {
  const cap = MATERIAL_CAPS[info?.grade ?? 0] ?? 0;
  const full = cap > 0 && have >= cap * NEARLY_FULL;
  const short = reserved > have;
  const classes = ['inv-cell', dimmed && 'dimmed', have === 0 && 'zero', full && 'full']
    .filter(Boolean)
    .join(' ');
  const title = [
    `${materialName(name)}: ${have} of ${cap}`,
    reserved > 0 &&
      `${reserved} held back by the to-dos${short ? `, ${reserved - have} short` : ''}`,
    full && 'Nearly full: more collected would be lost',
  ]
    .filter(Boolean)
    .join('\n');
  return (
    <td className={classes} title={title}>
      <span className="inv-name">{materialName(name)}</span>
      <span className="inv-n">
        <b>{have}</b>
        {reserved > 0 && (
          <span className={short ? 'inv-res short' : 'inv-res'}>
            {short ? `need ${reserved}` : `${reserved} held`}
          </span>
        )}
      </span>
      <span className="inv-bar">
        <i className="have" style={{ width: `${Math.min(1, have / cap) * 100}%` }} />
        {reserved > 0 && (
          <i
            className="res"
            style={{ width: `${Math.min(1, Math.min(have, reserved) / cap) * 100}%` }}
          />
        )}
      </span>
    </td>
  );
}

function OtherList({
  title,
  empty,
  items,
  reserved,
}: {
  title: string;
  empty: string;
  items: [string, number][];
  reserved: Readonly<Record<string, number>>;
}) {
  return (
    <section className="sec" aria-label={title}>
      <div className="sec-head">
        <h2 className="sec-title">{title}</h2>
        <div className="sec-meta">
          <span>
            <b>
              {formatNumber(
                items.reduce((sum, [, count]) => sum + count, 0),
                0,
              )}
            </b>{' '}
            {title === 'Cargo' ? 't' : 'items'}
          </span>
        </div>
      </div>
      {items.length === 0 ? (
        <p className="mat-empty">{empty}</p>
      ) : (
        <table className="tbl compact">
          <tbody>
            {items.map(([name, count]) => (
              <tr key={name}>
                <td>{materialName(name)}</td>
                <td className="dim">{materialInfo(name)?.category ?? ''}</td>
                <td className="v">
                  {(reserved[name] ?? 0) > 0 && (
                    <span className="inv-res">{reserved[name]} held · </span>
                  )}
                  {formatNumber(count, 0)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
