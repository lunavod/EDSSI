import { useEffect, useRef, useState } from 'react';

import type { NewCraftingTodo } from '../../../shared/crafting';
import { useEdssi } from '../api/context';
import { Glyph } from '../hud/Glyph';
import type { IngredientLine } from './materials';

/** An ingredient's bar is full at this many crafts' worth. */
const BAR_CRAFTS = 5;

/** What a recipe or to-do takes of one material, against what the commander has. */
export function Ingredient({
  ingredient,
  bar,
}: {
  ingredient: IngredientLine;
  /** A bar of what the commander has against five crafts' worth. */
  bar: boolean;
}) {
  const short = ingredient.have < ingredient.need;
  const fill = Math.min(1, ingredient.have / (ingredient.need * BAR_CRAFTS));
  return (
    <span
      className={short ? 'ing short' : 'ing'}
      title={`Have ${ingredient.have}, need ${ingredient.need}`}
    >
      <span className="ing-name">{ingredient.label}</span>
      <span className="ing-n">
        {ingredient.have}
        <span className="dim">/{ingredient.need}</span>
      </span>
      {bar && (
        <span className="ing-bar">
          <i style={{ width: `${fill * 100}%` }} />
        </span>
      )}
    </span>
  );
}

/** Ingredients as a row of chips. */
export function Ingredients({ lines }: { lines: readonly IngredientLine[] }) {
  return (
    <span className="rc-ings">
      {lines.map((line) => (
        <Ingredient key={line.name} ingredient={line} bar={false} />
      ))}
    </span>
  );
}

/** How long "Added" stays on a button after it was pressed. */
const ADDED_MS = 1500;

/** Puts a recipe on a to-do list, and says so for a moment. */
export function AddTodoButton({ todo, title }: { todo: NewCraftingTodo; title: string }) {
  const edssi = useEdssi();
  const [added, setAdded] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <button
      type="button"
      className={added ? 'ibtn sm todo-add added' : 'ibtn sm todo-add'}
      aria-label={title}
      title={added ? 'Added to the to-do list' : title}
      onClick={() => {
        void edssi.materials.addTodo(todo);
        setAdded(true);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setAdded(false), ADDED_MS);
      }}
    >
      <Glyph name={added ? 'check' : 'plus'} />
    </button>
  );
}

/** Where a to-do stands: done, enough for it, or how many materials are short. */
export function TodoStatus({ done, short }: { done: boolean; short: number }) {
  if (done) {
    return (
      <span className="tag good">
        <span className="ic-w">
          <Glyph name="check" />
        </span>
        Done
      </span>
    );
  }
  if (short === 0) return <span className="tag solid">Ready</span>;
  return (
    <span className="tag warn" title="Materials you haven't enough of for this alone">
      {short} short
    </span>
  );
}

/** A to-do's remove button. */
export function RemoveTodo({ id, name }: { id: string; name: string }) {
  const edssi = useEdssi();
  return (
    <button
      type="button"
      className="ibtn sm"
      aria-label={`Remove ${name}`}
      title="Remove from the list"
      onClick={() => void edssi.materials.removeTodo(id)}
    >
      <Glyph name="trash" />
    </button>
  );
}
