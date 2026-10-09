/**
 * Crafting: the recipes, what the commander carries to make them, and what they have made. The
 * recipes are static (`recipes.generated.ts`); the rest comes from the journal.
 */

import type { CraftingTodo, EngineerStanding } from './crafting';
import { ENGINEERS, MATERIALS, RECIPES } from './recipes.generated';

/** EDDiscovery's categories: ship materials, cargo, and the Odyssey ship locker's four. */
export type MaterialCategory =
  | 'Raw'
  | 'Manufactured'
  | 'Encoded'
  | 'Commodity'
  | 'Item'
  | 'Component'
  | 'Data'
  | 'Consumable';

export interface MaterialInfo {
  /** In English, e.g. `Flawed Focus Crystals`. */
  name: string;
  category: MaterialCategory;
  /** 1 (very common) to 5 (very rare), for raw, manufactured and encoded materials. */
  grade?: number;
  /**
   * What a material trader groups it under, as EDDiscovery's `MaterialGroupType` less the category:
   * `Category3` for raw, `Chemical`, `EmissionData`, `Guardian`, `Thargoid1`…
   */
  family?: string;
}

/** An engineer's workshop, from EDDiscovery's table. */
export interface EngineerInfo {
  /** As EDDiscovery names them: `Tod 'The Blaster' McQuinn`. */
  name: string;
  system: string;
  /** The workshop: `Farseer Inc`. */
  base: string;
  /** The body it's on, less the system's name: `6 A`. */
  planet?: string;
  coords: [x: number, y: number, z: number];
  /** How to hear of them. */
  discovery?: string;
  /** What gets an invitation. */
  meeting?: string;
  /** What unlocks their workshop once invited. */
  unlock?: string;
  /** The system needs a permit. */
  permit?: boolean;
  /** Works on suits and hand weapons, not ships. */
  odyssey?: boolean;
}

export type RecipeKind = 'synthesis' | 'engineering' | 'experimental' | 'techbroker' | 'odyssey';

export interface Recipe {
  /** Stable across regenerations, as favourites are stored by it. */
  id: string;
  kind: RecipeKind;
  /** What it is listed under: the synthesis, the module, the broker, or suit/weapon upgrades. */
  group: string;
  name: string;
  /** Engineering grade 1–5, synthesis 1–3 (basic to premium), or suit and weapon class. */
  grade?: number;
  /** Lowercase, as the journal names it: `Synthesis.Name`, `BlueprintName`, the unlocked module… */
  fdName?: string;
  engineers: string[];
  /** Lowercase journal names and how many of each one craft takes. */
  ingredients: [name: string, count: number][];
}

export const RECIPE_KINDS: readonly { id: RecipeKind; label: string }[] = [
  { id: 'synthesis', label: 'Synthesis' },
  { id: 'engineering', label: 'Engineering' },
  { id: 'experimental', label: 'Experimental' },
  { id: 'techbroker', label: 'Tech broker' },
  { id: 'odyssey', label: 'Suits & weapons' },
];

/** Favourite until the commander says otherwise: AFMU refills, life support refill and limpets. */
export const DEFAULT_FAVOURITE_RECIPES: readonly string[] = [
  'synthesis:afm-refill:1',
  'synthesis:afm-refill:2',
  'synthesis:afm-refill:3',
  'synthesis:life-support:1',
  'synthesis:limpets:1',
];

/** The defaults, as the commander's own choices (recipe id → favourite or not) have changed them. */
export function favouriteIds(choices: ReadonlyMap<string, boolean>): string[] {
  const ids = new Set(DEFAULT_FAVOURITE_RECIPES);
  for (const [recipe, favourite] of choices) {
    if (favourite) ids.add(recipe);
    else ids.delete(recipe);
  }
  return [...ids];
}

/** Something made, or a run of identical crafts in a row. */
export interface CraftRecord {
  /** When the last of the run was made. */
  timestamp: string;
  kind: RecipeKind;
  /** The recipe it was, when EDSSI could tell. */
  recipe?: string;
  name: string;
  /** e.g. the module and engineer, or the broker. */
  detail?: string;
  grade?: number;
  /** How many times in a row. */
  count: number;
  /** What each one took, as lowercase journal names. */
  ingredients: [name: string, count: number][];
}

export interface MaterialsSnapshot {
  /** Goes up with every change, so a window can ignore an older snapshot that arrives late. */
  version: number;
  /** False while EDSSI is still reading older journals. */
  ready: boolean;
  commander?: string;
  /**
   * What the commander has, by lowercase journal name: ship materials, the ship's cargo and the
   * ship locker, added together.
   */
  inventory: Record<string, number>;
  /** Newest first. */
  history: CraftRecord[];
  /** Recipe ids. */
  favourites: string[];
  /** Blueprints and syntheses planned, in the order they were added. */
  todos: CraftingTodo[];
  /** How the commander stands with each engineer they've heard of. */
  engineers: EngineerStanding[];
  /** Where the commander last arrived, for how far each engineer is. */
  position?: { system: string; coords: { x: number; y: number; z: number } };
}

export function isNewerMaterialsSnapshot(
  current: MaterialsSnapshot | undefined,
  next: MaterialsSnapshot,
): boolean {
  if (!current) return true;
  return (
    next.version > current.version ||
    (next.version === current.version && next.ready && !current.ready)
  );
}

export function materialInfo(name: string): MaterialInfo | undefined {
  return MATERIALS[name.toLowerCase()];
}

/** The English name, or the journal's own when EDDiscovery doesn't know it. */
export function materialName(name: string): string {
  return materialInfo(name)?.name ?? name;
}

export function recipeById(id: string): Recipe | undefined {
  return recipesById().get(id);
}

let byId: Map<string, Recipe> | undefined;
function recipesById(): Map<string, Recipe> {
  byId ??= new Map(RECIPES.map((recipe) => [recipe.id, recipe]));
  return byId;
}

/** "Basic", "Standard" or "Premium" for synthesis; "G3" for the rest. */
export function gradeLabel(kind: RecipeKind, grade: number | undefined): string | undefined {
  if (grade === undefined) return undefined;
  if (kind === 'synthesis') return ['Basic', 'Standard', 'Premium'][grade - 1];
  return `G${grade}`;
}

/** How many times the recipe can be made from `inventory`. */
export function craftableTimes(
  recipe: Pick<Recipe, 'ingredients'>,
  inventory: Readonly<Record<string, number>>,
): number {
  let times = Number.POSITIVE_INFINITY;
  for (const [name, count] of recipe.ingredients) {
    times = Math.min(times, Math.floor((inventory[name] ?? 0) / count));
  }
  return Number.isFinite(times) ? times : 0;
}

/** Whether two ingredient lists are the same, whatever their order. */
export function sameIngredients(
  a: readonly (readonly [string, number])[],
  b: readonly (readonly [string, number])[],
): boolean {
  if (a.length !== b.length) return false;
  const counts = new Map(a.map(([name, count]) => [name, count]));
  return b.every(([name, count]) => counts.get(name) === count);
}

/**
 * The recipe a craft in the journal was: among `candidates` of that kind, the one with the journal
 * name and the ingredients used, else the only one with either.
 */
export function matchRecipe(
  kind: RecipeKind,
  fdName: string | undefined,
  used: readonly (readonly [string, number])[],
  filter: (recipe: Recipe) => boolean = () => true,
): Recipe | undefined {
  const candidates = RECIPES.filter((recipe) => recipe.kind === kind && filter(recipe));
  const named =
    fdName === undefined
      ? []
      : candidates.filter((recipe) => recipe.fdName === fdName.toLowerCase());
  const byIngredients = (recipes: Recipe[]) =>
    recipes.filter((recipe) => sameIngredients(recipe.ingredients, used));
  const exact = byIngredients(named);
  if (exact.length > 0) return exact[0];
  if (named.length === 1) return named[0];
  const same = byIngredients(candidates);
  return same.length === 1 ? same[0] : undefined;
}

export { ENGINEERS, MATERIALS, RECIPES };
