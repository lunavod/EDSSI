import { useDeferredValue, useMemo, useState } from 'react';

import { blueprintKey, type NewCraftingTodo } from '../../../shared/crafting';
import {
  gradeLabel,
  type MaterialsSnapshot,
  type Recipe,
  RECIPE_KINDS,
  type RecipeKind,
  RECIPES,
} from '../../../shared/materials';
import { Glyph } from '../hud/Glyph';
import { formatNumber } from '../journal/format';
import { join } from '../journal/summaries';
import { groupRecipes, matchesQuery, type RecipeLine, recipeLine, recipeName } from './materials';
import { AddTodoButton, Ingredient } from './parts';

const NO_INVENTORY: Readonly<Record<string, number>> = {};

/**
 * The Materials module's Recipes page: favourite recipes first, then every recipe by what it's for,
 * each with what it takes against what the commander has. Syntheses and blueprints go onto their
 * to-do lists from here with one press.
 */
export function RecipesView({ snapshot }: { snapshot: MaterialsSnapshot | undefined }) {
  const [query, setQuery] = useState('');
  const [hidden, setHidden] = useState<ReadonlySet<RecipeKind>>(() => new Set());
  const [craftableOnly, setCraftableOnly] = useState(false);
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const needle = useDeferredValue(query).trim();

  const inventory = snapshot?.inventory ?? NO_INVENTORY;
  const favouriteIds = snapshot?.favourites;
  const lines = useMemo(() => {
    const favourites = new Set(favouriteIds);
    return RECIPES.map((recipe) => recipeLine(recipe, inventory, favourites));
  }, [inventory, favouriteIds]);

  const visible = lines.filter(
    (line) =>
      !hidden.has(line.recipe.kind) &&
      (!craftableOnly || line.times > 0) &&
      matchesQuery(line.recipe, needle),
  );
  const favourites = lines.filter((line) => line.favourite);
  const groups = groupRecipes(visible);
  const searching = needle !== '' || craftableOnly;
  const loading = !snapshot?.ready;

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
            aria-label="Find a recipe or material"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <fieldset className="chips">
          <legend className="visually-hidden">Kinds of recipe</legend>
          {RECIPE_KINDS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              className="chip"
              aria-pressed={!hidden.has(id)}
              onClick={() => setHidden((current) => toggled(current, id))}
            >
              {label}
            </button>
          ))}
        </fieldset>
        <button
          type="button"
          className="switch"
          role="switch"
          aria-checked={craftableOnly}
          onClick={() => setCraftableOnly((current) => !current)}
        >
          <span className="track" />
          Craftable
        </button>
      </div>

      <div className="mat-scroll">
        <div className="mat-main">
          <section className="sec" aria-label="Favourites">
            <div className="sec-head">
              <h2 className="sec-title">Favourites</h2>
              <div className="sec-meta">
                {loading ? (
                  <span>Reading journals…</span>
                ) : (
                  <span>
                    <b>{favourites.filter((line) => line.times > 0).length}</b> of{' '}
                    {favourites.length} craftable
                  </span>
                )}
              </div>
            </div>
            {favourites.length === 0 ? (
              <p className="mat-empty">Star a recipe to keep it up here.</p>
            ) : (
              <div className="rc-grid">
                {favourites.map((line) => (
                  <FavouriteCard key={line.recipe.id} line={line} />
                ))}
              </div>
            )}
          </section>

          <section className="sec" aria-label="Recipes">
            <div className="sec-head">
              <h2 className="sec-title">Recipes</h2>
              <div className="sec-meta">
                <span>
                  <b>{formatNumber(visible.length, 0)}</b>{' '}
                  {visible.length === 1 ? 'recipe' : 'recipes'}
                </span>
                <span className="sep" />
                <span>
                  <b>{formatNumber(visible.filter((line) => line.times > 0).length, 0)}</b>{' '}
                  craftable
                </span>
              </div>
            </div>
            {groups.length === 0 ? (
              <p className="mat-empty">No recipes match.</p>
            ) : (
              <div className="col">
                {groups.map((group) => {
                  const isOpen = searching || open.has(group.key);
                  return (
                    <div key={group.key} className={isOpen ? 'grp open' : 'grp'}>
                      <button
                        type="button"
                        className="grp-head"
                        aria-expanded={isOpen}
                        onClick={() => setOpen((current) => toggled(current, group.key))}
                      >
                        <span className="grp-chev">
                          <Glyph name="chevronDown" />
                        </span>
                        <span className="grp-name">{group.name}</span>
                        <span className="sp" />
                        <span className="micro">
                          {RECIPE_KINDS.find((kind) => kind.id === group.kind)?.label}
                        </span>
                        <span className="grp-craft" title="Craftable now, of its recipes">
                          <b>{group.craftable}</b>/{group.lines.length}
                        </span>
                      </button>
                      {/* Closed groups render nothing: there are over a thousand recipes. */}
                      {isOpen && (
                        <div className="grp-body">
                          {group.lines.map((line) => (
                            <GroupRecipe key={line.recipe.id} line={line} />
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      </div>
    </>
  );
}

function setFavourite(line: RecipeLine): void {
  void window.edssi.materials.setFavourite(line.recipe.id, !line.favourite);
}

function Star({ line }: { line: RecipeLine }) {
  const label = line.favourite ? 'Remove from favourites' : 'Add to favourites';
  return (
    <button
      type="button"
      className={line.favourite ? 'rc-star' : 'rc-star off'}
      aria-pressed={line.favourite}
      aria-label={label}
      title={label}
      onClick={() => setFavourite(line)}
    >
      <Glyph name={line.favourite ? 'starFilled' : 'star'} />
    </button>
  );
}

/** The grade as the card names it: "Premium", or "Grade 5" where the group row says "G5". */
function Grade({ line, long }: { line: RecipeLine; long: boolean }) {
  const grade = gradeLabel(line.recipe.kind, line.recipe.grade);
  if (!grade) return null;
  return <span className="rc-grade">{long ? grade.replace(/^G(\d)$/, 'Grade $1') : grade}</span>;
}

/** The to-do a recipe would go on: one synthesis of its grade, or a blueprint up to its grade. */
function todoFor(recipe: Recipe): NewCraftingTodo | undefined {
  const grade = recipe.grade;
  if (grade === undefined) return undefined;
  if (recipe.kind === 'synthesis') {
    const counts: [number, number, number] = [0, 0, 0];
    counts[grade - 1] = 1;
    return { kind: 'synthesis', synthesis: recipe.group, counts };
  }
  if (recipe.kind === 'engineering') {
    return {
      kind: 'blueprint',
      blueprint: blueprintKey(recipe),
      from: 0,
      to: grade,
    };
  }
  return undefined;
}

function AddTodo({ recipe }: { recipe: Recipe }) {
  const todo = todoFor(recipe);
  if (!todo) return null;
  const title =
    todo.kind === 'synthesis'
      ? `Add one ${gradeLabel('synthesis', recipe.grade)?.toLowerCase()} ${recipe.name} to the synthesis to-do`
      : `Add ${recipe.name} G1–G${recipe.grade} to the blueprint to-do`;
  return <AddTodoButton todo={todo} title={title} />;
}

function Times({ times }: { times: number }) {
  return (
    <span className={times > 0 ? 'rc-times' : 'rc-times zero'} title={`Enough for ${times}`}>
      ×{times}
    </span>
  );
}

function FavouriteCard({ line }: { line: RecipeLine }) {
  const { recipe } = line;
  return (
    <article className={line.times > 0 ? 'rc' : 'rc none'}>
      <header className="rc-head">
        <Star line={line} />
        <span className="rc-name" title={join(recipeName(recipe), recipe.engineers.join(', '))}>
          {recipeName(recipe)}
        </span>
        <Grade line={line} long />
        <span className="sp" />
        <Times times={line.times} />
        <AddTodo recipe={recipe} />
      </header>
      <div className="rc-ings">
        {line.ingredients.map((ingredient) => (
          <Ingredient key={ingredient.name} ingredient={ingredient} bar />
        ))}
      </div>
    </article>
  );
}

function GroupRecipe({ line }: { line: RecipeLine }) {
  const { recipe } = line;
  return (
    <div className={line.times > 0 ? 'grp-rec' : 'grp-rec none'}>
      <Star line={line} />
      <span
        className="rc-name"
        title={recipe.engineers.length > 0 ? recipe.engineers.join(', ') : undefined}
      >
        {recipe.name}
      </span>
      <Grade line={line} long={false} />
      <Times times={line.times} />
      <span className="grp-add">
        <AddTodo recipe={recipe} />
      </span>
      <span className="grp-ings">
        {line.ingredients.map((ingredient) => (
          <Ingredient key={ingredient.name} ingredient={ingredient} bar={false} />
        ))}
      </span>
    </div>
  );
}

function toggled<T>(set: ReadonlySet<T>, value: T): ReadonlySet<T> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}
