import { type FormEvent, useState } from 'react';

import {
  type Synthesis,
  synthesisByName,
  syntheses,
  type SynthesisTodo,
  todoDone,
  todoNeeds,
} from '../../../shared/crafting';
import { craftableTimes, type MaterialsSnapshot } from '../../../shared/materials';
import { useEdssi } from '../api/context';
import { NumberInput } from '../hud/Controls';
import { Glyph } from '../hud/Glyph';
import { Select } from '../hud/Select';
import { ingredientLines, shortCount } from './materials';
import { Ingredients, RemoveTodo, TodoStatus } from './parts';

const NO_INVENTORY: Readonly<Record<string, number>> = {};
const GRADES = [
  { grade: 1, label: 'Basic' },
  { grade: 2, label: 'Standard' },
  { grade: 3, label: 'Premium' },
] as const;

const GRADES_HELP =
  'How many of each grade to make. A synthesis made in the game counts down here on its own.';

/**
 * The Materials module's synthesis to-do list: how many of each grade of a synthesis to make, so
 * their materials are held back and the Missing page knows what to trade for.
 */
export function SynthesisTodoView({ snapshot }: { snapshot: MaterialsSnapshot | undefined }) {
  const todos = (snapshot?.todos ?? []).filter(
    (todo): todo is SynthesisTodo => todo.kind === 'synthesis',
  );
  const inventory = snapshot?.inventory ?? NO_INVENTORY;
  return (
    <>
      <AddSynthesis inventory={inventory} />
      <div className="mat-scroll">
        {todos.length === 0 ? (
          <p className="mat-empty">
            Nothing planned. Add a synthesis above, or press + beside one on the Recipes page.
          </p>
        ) : (
          <div className="todo-list">
            {todos.map((todo) => (
              <SynthesisCard key={todo.id} todo={todo} inventory={inventory} />
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function AddSynthesis({ inventory }: { inventory: Readonly<Record<string, number>> }) {
  const edssi = useEdssi();
  const all = syntheses();
  const [name, setName] = useState(
    () => all.find((one) => one.name === 'AFM Refill')?.name ?? all[0]?.name ?? '',
  );
  const [counts, setCounts] = useState<[number, number, number]>([1, 0, 0]);
  const synthesis = synthesisByName(name);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!synthesis) return;
    const { grades } = synthesis;
    const kept: [number, number, number] = [
      grades[1] ? counts[0] : 0,
      grades[2] ? counts[1] : 0,
      grades[3] ? counts[2] : 0,
    ];
    if (kept.every((count) => count === 0)) return;
    void edssi.materials.addTodo({
      kind: 'synthesis',
      synthesis: synthesis.name,
      counts: kept,
    });
  };

  return (
    <form className="panel pad todo-form" onSubmit={submit}>
      <div className="todo-row">
        <div className="field" style={{ flex: '1 1 260px' }}>
          <span className="label">Synthesis</span>
          <Select
            aria-label="Synthesis"
            value={name}
            options={all.map((one) => ({ value: one.name, label: one.name }))}
            onChange={setName}
          />
        </div>
        <div className="field">
          <span className="label" title={GRADES_HELP}>
            Grades to make <span className="help">?</span>
          </span>
          <div className="todo-grades">
            {GRADES.map(({ grade, label }) => {
              const recipe = synthesis?.grades[grade];
              return (
                <span
                  key={grade}
                  className="todo-count"
                  title={
                    recipe
                      ? `Enough for ${craftableTimes(recipe, inventory)} now`
                      : `No ${label.toLowerCase()} grade`
                  }
                >
                  <span className="unit">{label}</span>
                  <NumberInput
                    unit="×"
                    value={recipe ? counts[grade - 1] : 0}
                    min={0}
                    max={999}
                    disabled={!recipe}
                    label={label}
                    style={{ width: 96 }}
                    onChange={(count) =>
                      setCounts((current) => {
                        const next: [number, number, number] = [...current];
                        next[grade - 1] = count;
                        return next;
                      })
                    }
                  />
                </span>
              );
            })}
          </div>
        </div>
        <button
          type="submit"
          className="btn primary todo-submit"
          disabled={
            !synthesis ||
            GRADES.every(({ grade }) => !synthesis.grades[grade] || counts[grade - 1] === 0)
          }
        >
          <span className="ic-w">
            <Glyph name="plus" />
          </span>
          Add
        </button>
      </div>
      {synthesis && <SynthesisPreview synthesis={synthesis} inventory={inventory} />}
    </form>
  );
}

/** What each grade of the chosen synthesis takes, and how many the commander could make now. */
function SynthesisPreview({
  synthesis,
  inventory,
}: {
  synthesis: Synthesis;
  inventory: Readonly<Record<string, number>>;
}) {
  return (
    <div className="todo-preview">
      {GRADES.map(({ grade, label }) => {
        const recipe = synthesis.grades[grade];
        if (!recipe) return null;
        const times = craftableTimes(recipe, inventory);
        return (
          <div key={grade} className="todo-preview-row">
            <span className="rc-grade">{label}</span>
            <span
              className={times > 0 ? 'rc-times' : 'rc-times zero'}
              title={`Enough for ${times}`}
            >
              ×{times}
            </span>
            <Ingredients lines={ingredientLines(new Map(recipe.ingredients), inventory)} />
          </div>
        );
      })}
    </div>
  );
}

function SynthesisCard({
  todo,
  inventory,
}: {
  todo: SynthesisTodo;
  inventory: Readonly<Record<string, number>>;
}) {
  const edssi = useEdssi();
  const synthesis = synthesisByName(todo.synthesis);
  if (!synthesis) return null;
  const lines = ingredientLines(todoNeeds(todo, []), inventory);
  const done = todoDone(todo, []);
  return (
    <article className={done ? 'todo done' : 'todo'}>
      <header className="todo-head">
        <span className="todo-name">{todo.synthesis}</span>
        <span className="sp" />
        <TodoStatus done={done} short={shortCount(lines)} />
        <RemoveTodo id={todo.id} name={todo.synthesis} />
      </header>
      <div className="todo-meta">
        {GRADES.map(({ grade, label }) =>
          synthesis.grades[grade] ? (
            <span key={grade} className="todo-count">
              <span className="unit">{label}</span>
              <NumberInput
                unit="×"
                size="sm"
                value={todo.counts[grade - 1]}
                min={0}
                max={999}
                label={`${label} ${todo.synthesis} to make`}
                style={{ width: 84 }}
                onChange={(count) => {
                  const counts: [number, number, number] = [...todo.counts];
                  counts[grade - 1] = count;
                  void edssi.materials.updateTodo({ ...todo, counts });
                }}
              />
            </span>
          ) : null,
        )}
      </div>
      {!done && <Ingredients lines={lines} />}
    </article>
  );
}
