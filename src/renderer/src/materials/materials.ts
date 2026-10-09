import { materialOrder } from '../../../shared/crafting';
import {
  craftableTimes,
  gradeLabel,
  materialName,
  type Recipe,
  type RecipeKind,
} from '../../../shared/materials';

/** A recipe as a row: what it takes, and how far the commander's stock goes. */
export interface RecipeLine {
  recipe: Recipe;
  favourite: boolean;
  /** How many times it can be made now. */
  times: number;
  ingredients: { name: string; label: string; need: number; have: number }[];
}

/** One module, synthesis or broker's recipes. */
export interface RecipeGroup {
  key: string;
  kind: RecipeKind;
  name: string;
  lines: RecipeLine[];
  craftable: number;
}

export function recipeLine(
  recipe: Recipe,
  inventory: Readonly<Record<string, number>>,
  favourites: ReadonlySet<string>,
): RecipeLine {
  return {
    recipe,
    favourite: favourites.has(recipe.id),
    times: craftableTimes(recipe, inventory),
    ingredients: recipe.ingredients.map(([name, need]) => ({
      name,
      label: materialName(name),
      need,
      have: inventory[name] ?? 0,
    })),
  };
}

/** Its name, and what it is for when the name alone doesn't say: "Long-Range Weapon · Beam Laser". */
export function recipeName(recipe: Recipe): string {
  return recipe.group === recipe.name ? recipe.name : `${recipe.name} · ${recipe.group}`;
}

/** Whether a recipe matches every word typed: in its name, group, ingredients or engineers. */
export function matchesQuery(recipe: Recipe, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const text = [
    recipe.name,
    recipe.group,
    gradeLabel(recipe.kind, recipe.grade),
    ...recipe.engineers,
    ...recipe.ingredients.map(([name]) => materialName(name)),
  ]
    .join(' ')
    .toLowerCase();
  return words.every((word) => text.includes(word));
}

/** Recipes in their groups, in the order given (the generated one: by kind, group, name, grade). */
export function groupRecipes(lines: readonly RecipeLine[]): RecipeGroup[] {
  const groups = new Map<string, RecipeGroup>();
  for (const line of lines) {
    const key = `${line.recipe.kind}:${line.recipe.group}`;
    let group = groups.get(key);
    if (!group) {
      group = { key, kind: line.recipe.kind, name: line.recipe.group, lines: [], craftable: 0 };
      groups.set(key, group);
    }
    group.lines.push(line);
    if (line.times > 0) group.craftable++;
  }
  return [...groups.values()];
}

/** "Worn Shield Emitters 5 · Flawed Focus Crystals 3". */
export function formatIngredients(ingredients: readonly (readonly [string, number])[]): string {
  return ingredients.map(([name, count]) => `${materialName(name)} ${count}`).join(' · ');
}

/** An ingredient against the commander's stock: what the chips show. */
export type IngredientLine = RecipeLine['ingredients'][number];

/** Needs (lowercase journal name → count) as chips, in the game's order. */
export function ingredientLines(
  needs: ReadonlyMap<string, number>,
  inventory: Readonly<Record<string, number>>,
): IngredientLine[] {
  return [...needs]
    .toSorted(([a], [b]) => materialOrder(a) - materialOrder(b))
    .map(([name, need]) => ({ name, label: materialName(name), need, have: inventory[name] ?? 0 }));
}

/** How many of the materials in `lines` the commander hasn't enough of. */
export function shortCount(lines: readonly IngredientLine[]): number {
  return lines.filter((line) => line.have < line.need).length;
}
