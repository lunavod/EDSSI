import { useMemo, useState } from 'react';

import {
  type CraftingTodo,
  type EngineerStanding,
  materialNeeds,
  type TradedCategory,
  todoDone,
} from '../../../shared/crafting';
import type { MaterialsSnapshot } from '../../../shared/materials';
import { useEdssi } from '../api/context';
import { Glyph } from '../hud/Glyph';
import { Tabs } from '../hud/Tabs';
import { BlueprintTodoView } from './BlueprintTodoView';
import { HistoryView } from './HistoryView';
import { InventoryView } from './InventoryView';
import { MissingView } from './MissingView';
import { RecipesView } from './RecipesView';
import { SynthesisTodoView } from './SynthesisTodoView';
import { type TraderAsk, TradersView } from './TradersView';

type SubTab =
  | 'recipes'
  | 'inventory'
  | 'blueprints'
  | 'synthesis'
  | 'missing'
  | 'traders'
  | 'history';

const NO_INVENTORY: Readonly<Record<string, number>> = {};
const NO_STANDINGS: readonly EngineerStanding[] = [];

/**
 * The Materials module: recipes, what the commander holds, to-do lists of blueprints and syntheses,
 * what those are short of (and what to trade for it), where the material traders are, and what
 * was crafted.
 */
export function MaterialsView({
  snapshot,
  here,
}: {
  snapshot: MaterialsSnapshot | undefined;
  /** The system the commander is in, for the Traders page. */
  here: string | undefined;
}) {
  const edssi = useEdssi();
  const [tab, setTab] = useState<SubTab>('recipes');
  const [ask, setAsk] = useState<TraderAsk>();
  const todos = snapshot?.todos ?? [];
  const inventory = snapshot?.inventory ?? NO_INVENTORY;
  const standings = snapshot?.engineers ?? NO_STANDINGS;
  const short = useMemo(
    () =>
      materialNeeds(snapshot?.todos ?? [], inventory, standings).filter((need) => need.short > 0)
        .length,
    [snapshot?.todos, inventory, standings],
  );
  const left = (kind: CraftingTodo['kind']) =>
    todos.filter((todo) => todo.kind === kind && !todoDone(todo, standings)).length;
  const done = (kind: CraftingTodo['kind']) =>
    todos.some((todo) => todo.kind === kind && todoDone(todo, standings));
  const blueprints = left('blueprint');
  const synthesis = left('synthesis');

  const findTrader = (category: TradedCategory) => {
    setAsk((current) => ({ types: [category], seq: (current?.seq ?? 0) + 1 }));
    setTab('traders');
  };

  const listKind =
    tab === 'blueprints' ? 'blueprint' : tab === 'synthesis' ? 'synthesis' : undefined;
  return (
    <>
      <Tabs
        tabs={[
          { id: 'recipes', label: 'Recipes' },
          { id: 'inventory', label: 'Inventory' },
          { id: 'blueprints', label: 'Blueprints', badge: blueprints > 0 ? blueprints : undefined },
          { id: 'synthesis', label: 'Synthesis', badge: synthesis > 0 ? synthesis : undefined },
          { id: 'missing', label: 'Missing', badge: short > 0 ? short : undefined },
          { id: 'traders', label: 'Traders' },
          { id: 'history', label: 'History' },
        ]}
        active={tab}
        onSelect={setTab}
        sub
        ariaLabel="Materials"
        actions={
          listKind &&
          done(listKind) && (
            <button
              type="button"
              className="btn ghost sm"
              title="Take off the ones with nothing left to make"
              onClick={() => void edssi.materials.clearDoneTodos(listKind)}
            >
              <span className="ic-w">
                <Glyph name="check" />
              </span>
              Clear done
            </button>
          )
        }
      />
      {/* All stay mounted, so each page keeps its filters, form and results. */}
      <div className="mat-page" hidden={tab !== 'recipes'}>
        <RecipesView snapshot={snapshot} />
      </div>
      <div className="mat-page" hidden={tab !== 'inventory'}>
        <InventoryView snapshot={snapshot} />
      </div>
      <div className="mat-page" hidden={tab !== 'blueprints'}>
        <BlueprintTodoView snapshot={snapshot} />
      </div>
      <div className="mat-page" hidden={tab !== 'synthesis'}>
        <SynthesisTodoView snapshot={snapshot} />
      </div>
      <div className="mat-page" hidden={tab !== 'missing'}>
        <MissingView snapshot={snapshot} onFindTrader={findTrader} />
      </div>
      <div className="mat-page" hidden={tab !== 'traders'}>
        <TradersView here={here} shown={tab === 'traders'} ask={ask} />
      </div>
      <div className="mat-page" hidden={tab !== 'history'}>
        <HistoryView snapshot={snapshot} />
      </div>
    </>
  );
}
