/**
 * The Materials tab's to-do lists (blueprints to apply, syntheses to make), what they hold back of
 * the commander's stock, and what a material trader could turn the rest into. All pure, so the
 * main process and the window work it out the same way.
 */

import {
  ENGINEERS,
  type EngineerInfo,
  MATERIALS,
  type MaterialCategory,
  type MaterialInfo,
  materialInfo,
  type Recipe,
  RECIPES,
} from './materials';

/** Blueprints to apply to one module, from the grade it has now up to a target. */
export interface BlueprintTodo {
  id: string;
  kind: 'blueprint';
  /** The blueprint's recipe ids less the grade: `engineering:<fdName>:<module>`. */
  blueprint: string;
  /** An experimental effect's recipe id. */
  experimental?: string;
  /** The grade the module has now; 0 for none. */
  from: number;
  to: number;
  /**
   * Rolls at the target grade, for each module; unset to max it, however many that takes at the
   * engineer's rank. The grades below are planned from the rank too (`plannedRolls`).
   */
  targetRolls?: number;
  /** The module has the target grade already: only the experimental effect is left. */
  onlyExperimental?: boolean;
  /** How many modules take it, e.g. four shield boosters; 1 when unset. */
  count?: number;
  /** Who to take it to; unset for the most suitable engineer. */
  engineer?: string;
}

/** Syntheses to make, how many of each grade. */
export interface SynthesisTodo {
  id: string;
  kind: 'synthesis';
  /** The synthesis's name, its recipes' group, e.g. `AFM Refill`. */
  synthesis: string;
  /** Still to make at basic, standard and premium; counted down as the game makes them. */
  counts: [basic: number, standard: number, premium: number];
}

export type CraftingTodo = BlueprintTodo | SynthesisTodo;

/** A to-do as the window asks for it: the main process gives it its id. */
export type NewCraftingTodo = Omit<BlueprintTodo, 'id'> | Omit<SynthesisTodo, 'id'>;

/** What the commander has done with an engineer, from `EngineerProgress`. */
export interface EngineerStanding {
  /** As the recipes name them, nicknames left out: `Tod McQuinn`. */
  name: string;
  /** `Known`, `Invited`, `Acquainted`, `Unlocked` or `Barred`. */
  progress: string;
  rank?: number;
}

/** One blueprint for one module, every grade of it. */
export interface Blueprint {
  key: string;
  module: string;
  name: string;
  fdName: string;
  /** By grade; the lowest is grade 1. */
  grades: Recipe[];
}

/** The grades a synthesis comes in, by grade (1 basic to 3 premium). */
export interface Synthesis {
  name: string;
  grades: Partial<Record<1 | 2 | 3, Recipe>>;
}

/** Slots in the game for each grade of material; anything more is lost. */
export const MATERIAL_CAPS: Readonly<Record<number, number>> = {
  1: 300,
  2: 250,
  3: 200,
  4: 150,
  5: 100,
};

/** The categories a material trader deals in, one trader apiece. */
export const TRADED_CATEGORIES = ['Raw', 'Manufactured', 'Encoded'] as const;
export type TradedCategory = (typeof TRADED_CATEGORIES)[number];

let blueprintList: { byKey: Map<string, Blueprint>; modules: string[] } | undefined;
function blueprintTable(): { byKey: Map<string, Blueprint>; modules: string[] } {
  if (blueprintList) return blueprintList;
  const byKey = new Map<string, Blueprint>();
  for (const recipe of RECIPES) {
    if (recipe.kind !== 'engineering' || recipe.grade === undefined) continue;
    const key = blueprintKey(recipe);
    let blueprint = byKey.get(key);
    if (!blueprint) {
      blueprint = {
        key,
        module: recipe.group,
        name: recipe.name,
        fdName: recipe.fdName ?? '',
        grades: [],
      };
      byKey.set(key, blueprint);
    }
    blueprint.grades.push(recipe);
  }
  for (const blueprint of byKey.values()) {
    blueprint.grades.sort((a, b) => (a.grade ?? 0) - (b.grade ?? 0));
  }
  const modules = [...new Set([...byKey.values()].map((blueprint) => blueprint.module))].toSorted(
    (a, b) => a.localeCompare(b),
  );
  blueprintList = { byKey, modules };
  return blueprintList;
}

/** A blueprint recipe's id less its grade. */
export function blueprintKey(recipe: Pick<Recipe, 'id'>): string {
  return recipe.id.replace(/:\d+$/, '');
}

export function blueprintByKey(key: string): Blueprint | undefined {
  return blueprintTable().byKey.get(key);
}

/** Every module that takes a blueprint, by name. */
export function blueprintModules(): readonly string[] {
  return blueprintTable().modules;
}

/** A module's blueprints, by name. */
export function blueprintsFor(module: string): Blueprint[] {
  return [...blueprintTable().byKey.values()]
    .filter((blueprint) => blueprint.module === module)
    .toSorted((a, b) => a.name.localeCompare(b.name));
}

/** The highest grade a blueprint goes to. */
export function maxGrade(blueprint: Blueprint): number {
  return blueprint.grades.at(-1)?.grade ?? 0;
}

export function blueprintGrade(blueprint: Blueprint, grade: number): Recipe | undefined {
  return blueprint.grades.find((recipe) => recipe.grade === grade);
}

/** The experimental effects a module takes. */
export function experimentalsFor(module: string): Recipe[] {
  return RECIPES.filter(
    (recipe) => recipe.kind === 'experimental' && recipe.group.split(', ').includes(module),
  ).toSorted((a, b) => a.name.localeCompare(b.name));
}

/**
 * The experimental effects to offer for a module, each name once. The rail gun's Feedback Cascade
 * and Super Penetrator come in the game's older and current versions (`…_cooled`), the same
 * ingredients either way; both are kept for reading journals and builds, but only the current one
 * is offered.
 */
export function experimentalChoices(module: string): Recipe[] {
  const byName = new Map<string, Recipe>();
  for (const recipe of experimentalsFor(module)) {
    const known = byName.get(recipe.name);
    if (!known || recipe.fdName?.endsWith('_cooled')) byName.set(recipe.name, recipe);
  }
  return [...byName.values()];
}

let synthesisList: Synthesis[] | undefined;
/** Every synthesis, by name. */
export function syntheses(): readonly Synthesis[] {
  if (synthesisList) return synthesisList;
  const byName = new Map<string, Synthesis>();
  for (const recipe of RECIPES) {
    if (recipe.kind !== 'synthesis') continue;
    const grade = recipe.grade;
    if (grade !== 1 && grade !== 2 && grade !== 3) continue;
    let synthesis = byName.get(recipe.group);
    if (!synthesis) {
      synthesis = { name: recipe.group, grades: {} };
      byName.set(recipe.group, synthesis);
    }
    synthesis.grades[grade] = recipe;
  }
  synthesisList = [...byName.values()].toSorted((a, b) => a.name.localeCompare(b.name));
  return synthesisList;
}

export function synthesisByName(name: string): Synthesis | undefined {
  return syntheses().find((synthesis) => synthesis.name === name);
}

/** An engineer's name as the recipes give it, to compare: nicknames and case left out. */
export function engineerKey(name: string): string {
  return name
    .replace(/\s*'[^']*'\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** How far an engineer will go with the commander: their rank once unlocked, else 0. */
function engineerRank(standing: EngineerStanding | undefined): number {
  return standing?.progress === 'Unlocked' ? (standing.rank ?? 0) : 0;
}

/** An engineer's workshop, by any spelling of their name (`Tod McQuinn`). */
export function engineerInfo(name: string): EngineerInfo | undefined {
  const key = engineerKey(name);
  return ENGINEERS.find((engineer) => engineerKey(engineer.name) === key);
}

/** An engineer who offers a blueprint's grade, as the commander stands with them. */
export interface EngineerOption {
  name: string;
  info?: EngineerInfo;
  standing?: EngineerStanding;
  /** They will craft the grade now: unlocked, at that rank or above. */
  ready: boolean;
  /** From `from`, when it is known. */
  distanceLy?: number;
}

/** The other blueprint to-dos on the list, beside `todo`. */
function otherBlueprints(
  todo: BlueprintTodo,
  list: readonly CraftingTodo[] | undefined,
): BlueprintTodo[] {
  return (list ?? []).filter(
    (other): other is BlueprintTodo => other.kind === 'blueprint' && other.id !== todo.id,
  );
}

/** How many of `others` an engineer offers the target grade of. */
function sharedBlueprints(name: string, others: readonly BlueprintTodo[]): number {
  const key = engineerKey(name);
  return others.filter((other) => {
    const blueprint = blueprintByKey(other.blueprint);
    const offering = (blueprint && blueprintGrade(blueprint, other.to)?.engineers) ?? [];
    return offering.some((offered) => engineerKey(offered) === key);
  }).length;
}

/**
 * The engineers offering a grade, best first: those unlocked before those not, as unlocking one
 * is a trip of its own; then those who also offer more of `others` (the rest of the to-do list,
 * so one visit does several), even if they must rank up to the grade; then those who will craft
 * it now, nearest first; then those furthest along with the commander, an invitation before
 * nothing, nearest first.
 */
export function engineerOptions(
  offering: readonly string[],
  standings: readonly EngineerStanding[],
  grade: number,
  from?: { x: number; y: number; z: number },
  others: readonly BlueprintTodo[] = [],
): EngineerOption[] {
  const byKey = new Map(standings.map((standing) => [engineerKey(standing.name), standing]));
  return offering
    .map((name, order) => {
      const standing = byKey.get(engineerKey(name));
      const info = engineerInfo(name);
      const rank = engineerRank(standing);
      const distanceLy =
        info && from
          ? Math.hypot(info.coords[0] - from.x, info.coords[1] - from.y, info.coords[2] - from.z)
          : undefined;
      return {
        option: {
          name,
          ...(info && { info }),
          ...(standing && { standing }),
          ready: rank >= grade,
          ...(distanceLy !== undefined && { distanceLy }),
        },
        order,
        rank,
        shared: sharedBlueprints(name, others),
      };
    })
    .toSorted(
      (a, b) =>
        Number(b.option.standing?.progress === 'Unlocked') -
          Number(a.option.standing?.progress === 'Unlocked') ||
        b.shared - a.shared ||
        Number(b.option.ready) - Number(a.option.ready) ||
        (a.option.ready ? 0 : b.rank - a.rank) ||
        Number(b.option.standing?.progress === 'Invited') -
          Number(a.option.standing?.progress === 'Invited') ||
        (a.option.distanceLy ?? Infinity) - (b.option.distanceLy ?? Infinity) ||
        a.order - b.order,
    )
    .map(({ option }) => option);
}

/** Who to take a blueprint to: the first of `engineerOptions`. */
export function suitableEngineer(
  offering: readonly string[],
  standings: readonly EngineerStanding[],
  grade: number,
  from?: { x: number; y: number; z: number },
): { name: string; ready: boolean } | undefined {
  const best = engineerOptions(offering, standings, grade, from)[0];
  return best && { name: best.name, ready: best.ready };
}

/** How an engineer stands with the commander, in a few words. */
export function standingText(standing: EngineerStanding | undefined): string {
  if (!standing) return 'unknown';
  if (standing.progress === 'Unlocked') {
    return standing.rank ? `rank ${standing.rank}` : 'unlocked';
  }
  return standing.progress.toLowerCase();
}

/** What a to-do still takes, per recipe: the rolls left at each grade and the experimental. */
export function todoSteps(
  todo: CraftingTodo,
  standings: readonly EngineerStanding[],
  list?: readonly CraftingTodo[],
): { recipe: Recipe; times: number }[] {
  if (todo.kind === 'synthesis') {
    const synthesis = synthesisByName(todo.synthesis);
    if (!synthesis) return [];
    return ([1, 2, 3] as const).flatMap((grade) => {
      const recipe = synthesis.grades[grade];
      const times = todo.counts[grade - 1] ?? 0;
      return recipe && times > 0 ? [{ recipe, times }] : [];
    });
  }
  const blueprint = blueprintByKey(todo.blueprint);
  const steps: { recipe: Recipe; times: number }[] = [];
  if (blueprint) {
    const planned = plannedRolls(todo, standings, list);
    for (let grade = todo.from + 1; grade <= todo.to; grade++) {
      const recipe = blueprintGrade(blueprint, grade);
      const times = planned[grade - 1] ?? 0;
      if (recipe && times > 0) steps.push({ recipe, times });
    }
  }
  const experimental =
    todo.experimental && RECIPES.find((recipe) => recipe.id === todo.experimental);
  if (experimental) steps.push({ recipe: experimental, times: moduleCount(todo) });
  return steps;
}

/** How many modules a blueprint to-do is for. */
export function moduleCount(todo: BlueprintTodo): number {
  return todo.count ?? 1;
}

/**
 * Rolls at a grade the engineer is at that rank for, after which they rank up. Seen in the
 * journal: each rank from 1 to 5 came on the third roll at the grade equal to it, whether or not
 * the grade was full yet.
 */
export const RANK_UP_ROLLS = 3;

/**
 * How much of a grade one roll fills: a fifth at a grade equal to the engineer's rank, and more
 * the further the rank is above it (a whole G1 in one roll at rank 5), as the journal's `Quality`
 * shows it.
 */
function rollShare(grade: number, rank: number): number {
  return 1 / Math.max(1, 5 - (rank - grade));
}

/**
 * Rolls to max a grade out at the engineer's rank, counting the rank-up partway there: five at a
 * grade equal to the rank, and as many as the grade at rank 5.
 */
export function rollsToMax(grade: number, rank = 5): number {
  let at = Math.min(5, Math.max(rank, grade));
  let filled = 0;
  let rolls = 0;
  while (filled < 1 - 1e-9) {
    filled += rollShare(grade, at);
    rolls++;
    if (at === grade && at < 5 && rolls === RANK_UP_ROLLS) at++;
  }
  return rolls;
}

/**
 * The engineers who could take a to-do, best first (`engineerOptions`), preferring those who also
 * offer others on `list`.
 */
export function todoEngineerOptions(
  todo: BlueprintTodo,
  standings: readonly EngineerStanding[],
  from?: { x: number; y: number; z: number },
  list?: readonly CraftingTodo[],
): EngineerOption[] {
  const blueprint = blueprintByKey(todo.blueprint);
  const offering = (blueprint && blueprintGrade(blueprint, todo.to)?.engineers) ?? [];
  return engineerOptions(offering, standings, todo.to, from, otherBlueprints(todo, list));
}

/**
 * The rank of whoever the to-do goes to: the engineer chosen, else the best of those offering the
 * target grade, preferring one who also offers others on `list`. One not yet unlocked will start
 * at 1.
 */
export function todoEngineerRank(
  todo: BlueprintTodo,
  standings: readonly EngineerStanding[],
  list?: readonly CraftingTodo[],
): number {
  const best = todo.engineer
    ? engineerOptions([todo.engineer], standings, todo.to)[0]
    : todoEngineerOptions(todo, standings, undefined, list)[0];
  return Math.max(1, engineerRank(best?.standing));
}

/**
 * Rolls planned at each grade (index 0 is grade 1), all modules together, from the engineer's
 * rank: every grade maxed, as Inara plans it and the journal bears out. That is five rolls at a
 * grade the engineer ranks up on, and as many as the grade once they're at rank 5 (1, 2, 3, 4, 5).
 * The target takes `targetRolls` instead when set. Only the first module pays for the rank-ups.
 */
export function plannedRolls(
  todo: BlueprintTodo,
  standings: readonly EngineerStanding[],
  list?: readonly CraftingTodo[],
): number[] {
  const plan = [0, 0, 0, 0, 0];
  if (todo.onlyExperimental) return plan;
  let rank = todoEngineerRank(todo, standings, list);
  for (let module = 0; module < moduleCount(todo); module++) {
    for (let grade = todo.from + 1; grade <= todo.to; grade++) {
      // An engineer below the grade must be ranked up some other way first.
      rank = Math.max(rank, grade);
      const rolls =
        grade === todo.to && todo.targetRolls !== undefined
          ? todo.targetRolls
          : rollsToMax(grade, rank);
      if (rank === grade && rank < 5 && rolls >= RANK_UP_ROLLS) rank++;
      plan[grade - 1]! += rolls;
    }
  }
  return plan;
}

/** Rolls planned at one grade, all modules together. */
export function rollsAt(
  todo: BlueprintTodo,
  grade: number,
  standings: readonly EngineerStanding[],
  list?: readonly CraftingTodo[],
): number {
  return plannedRolls(todo, standings, list)[grade - 1] ?? 0;
}

/** What a to-do still takes, added up: lowercase journal names and counts. */
export function todoNeeds(
  todo: CraftingTodo,
  standings: readonly EngineerStanding[],
  list?: readonly CraftingTodo[],
): Map<string, number> {
  const needs = new Map<string, number>();
  for (const { recipe, times } of todoSteps(todo, standings, list)) {
    for (const [name, count] of recipe.ingredients) {
      needs.set(name, (needs.get(name) ?? 0) + count * times);
    }
  }
  return needs;
}

/** Whether nothing is left to make of it. */
export function todoDone(todo: CraftingTodo, standings: readonly EngineerStanding[]): boolean {
  return todoSteps(todo, standings).length === 0;
}

/** What every to-do still takes, added up: the stock they hold back. */
export function reservedMaterials(
  todos: readonly CraftingTodo[],
  standings: readonly EngineerStanding[],
): Record<string, number> {
  const reserved: Record<string, number> = {};
  for (const todo of todos) {
    for (const [name, count] of todoNeeds(todo, standings, todos)) {
      reserved[name] = (reserved[name] ?? 0) + count;
    }
  }
  return reserved;
}

/** A synthesis made in the game. */
export interface SynthesisMade {
  synthesis: string;
  grade: number;
}

/**
 * The to-dos with a synthesis counted down, or undefined when it was none of theirs. Blueprint
 * rolls aren't tracked: a blueprint to-do says how many rolls it takes, as Inara's do, and is
 * crossed off by hand.
 */
export function recordSynthesis(
  todos: readonly CraftingTodo[],
  made: SynthesisMade,
): CraftingTodo[] | undefined {
  const index = todos.findIndex(
    (todo) =>
      todo.kind === 'synthesis' &&
      todo.synthesis === made.synthesis &&
      (todo.counts[made.grade - 1] ?? 0) > 0,
  );
  if (index < 0) return undefined;
  return todos.map((todo, at) => {
    if (at !== index || todo.kind !== 'synthesis') return todo;
    const [basic, standard, premium] = todo.counts;
    const counts: SynthesisTodo['counts'] = [
      basic - (made.grade === 1 ? 1 : 0),
      standard - (made.grade === 2 ? 1 : 0),
      premium - (made.grade === 3 ? 1 : 0),
    ];
    return { ...todo, counts };
  });
}

// ---------- the material trader ----------

/** Guardian and Thargoid materials can't be traded. */
export function isTradeable(info: MaterialInfo | undefined): info is MaterialInfo & {
  category: TradedCategory;
  grade: number;
  family: string;
} {
  return (
    info !== undefined &&
    (TRADED_CATEGORIES as readonly MaterialCategory[]).includes(info.category) &&
    info.grade !== undefined &&
    info.family !== undefined &&
    !/^(Guardian|Thargoid)/.test(info.family)
  );
}

/**
 * A trader's rate from one material to another of the same category, in lowest terms: six of a
 * grade for one of the next up, one for three of the next down; across families six for one at
 * the same grade, and from there the same steps.
 */
export function tradeRate(
  from: MaterialInfo | undefined,
  to: MaterialInfo | undefined,
): { give: number; receive: number } | undefined {
  if (!isTradeable(from) || !isTradeable(to) || from.category !== to.category) return undefined;
  const steps = to.grade - from.grade;
  const sameFamily = from.family === to.family;
  if (sameFamily && steps === 0) return undefined;
  let give = sameFamily ? 1 : 6;
  let receive = 1;
  if (steps > 0) give *= 6 ** steps;
  else receive *= 3 ** -steps;
  const divisor = gcd(give, receive);
  return { give: give / divisor, receive: receive / divisor };
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

/** One way to trade for a material the to-dos are short of. */
export interface TradeOption {
  /** What is given, by lowercase journal name. */
  from: string;
  /** How much of it, and how much comes back: whole trades at the trader's rate. */
  give: number;
  receive: number;
  sameFamily: boolean;
  /** What it leaves of the stock the to-dos don't need. */
  spareLeft: number;
  /** Whether it makes up the whole shortfall. */
  covers: boolean;
}

/**
 * The trades that would make up `short` of `target` from stock the to-dos don't hold back, the
 * ones that cover it and leave most to spare first. When none covers it, those that go furthest.
 */
export function tradeOptions(
  target: string,
  short: number,
  inventory: Readonly<Record<string, number>>,
  reserved: Readonly<Record<string, number>>,
): TradeOption[] {
  return tradeOptionsFrom(target, short, spareStock(inventory, reserved));
}

/** What the commander has beyond what the to-dos hold back, by material. */
export function spareStock(
  inventory: Readonly<Record<string, number>>,
  reserved: Readonly<Record<string, number>>,
): Record<string, number> {
  const spare: Record<string, number> = {};
  for (const [name, count] of Object.entries(inventory))
    spare[name] = count - (reserved[name] ?? 0);
  return spare;
}

/** `tradeOptions`, from stock already worked out to be spare. */
export function tradeOptionsFrom(
  target: string,
  short: number,
  spareStock: Readonly<Record<string, number>>,
): TradeOption[] {
  const to = materialInfo(target);
  if (short <= 0 || !isTradeable(to)) return [];
  const options: TradeOption[] = [];
  for (const [name, spare] of Object.entries(spareStock)) {
    if (name === target) continue;
    const from = materialInfo(name);
    const rate = tradeRate(from, to);
    if (!rate || spare < rate.give) continue;
    const wanted = Math.ceil(short / rate.receive);
    const trades = Math.min(wanted, Math.floor(spare / rate.give));
    options.push({
      from: name,
      give: trades * rate.give,
      receive: trades * rate.receive,
      sameFamily: from?.family === to.family,
      spareLeft: spare - trades * rate.give,
      covers: trades === wanted,
    });
  }
  return options.toSorted(
    (a, b) =>
      Number(b.covers) - Number(a.covers) ||
      (a.covers ? a.give / (a.give + a.spareLeft) - b.give / (b.give + b.spareLeft) : 0) ||
      b.receive - a.receive ||
      Number(b.sameFamily) - Number(a.sameFamily) ||
      a.from.localeCompare(b.from),
  );
}

/** One trade in a plan: `give` of `from` for `receive` of `to`. */
export interface PlannedTrade {
  from: string;
  give: number;
  to: string;
  receive: number;
}

export interface TradePlan {
  trades: PlannedTrade[];
  /** Tradeable shortfalls the spare stock can't make up, and how much of each is left short. */
  unmet: { name: string; short: number }[];
}

/**
 * Trades that make up every tradeable shortfall together, spending each spare material only once.
 * The shortfalls with the fewest ways to trade for them go first, so a source they need isn't
 * spent on one that had others; each takes the best trade `tradeOptionsFrom` offers, and more
 * sources when one doesn't cover it. What a trade gives over the shortfall is spare for the rest.
 */
export function planTrades(
  needs: readonly MaterialNeed[],
  inventory: Readonly<Record<string, number>>,
  reserved: Readonly<Record<string, number>>,
): TradePlan {
  const spare = spareStock(inventory, reserved);
  const short = needs.filter((need) => need.short > 0 && isTradeable(need.info));
  const ways = new Map(
    short.map((need) => [need.name, tradeOptionsFrom(need.name, need.short, spare).length]),
  );
  const ordered = short.toSorted(
    (a, b) =>
      (ways.get(a.name) ?? 0) - (ways.get(b.name) ?? 0) ||
      b.short - a.short ||
      materialOrder(a.name) - materialOrder(b.name),
  );
  const trades: PlannedTrade[] = [];
  const unmet: TradePlan['unmet'] = [];
  for (const need of ordered) {
    let left = need.short;
    while (left > 0) {
      const best = tradeOptionsFrom(need.name, left, spare)[0];
      if (!best) break;
      spare[best.from] = (spare[best.from] ?? 0) - best.give;
      trades.push({ from: best.from, give: best.give, to: need.name, receive: best.receive });
      if (best.receive > left) spare[need.name] = best.receive - left;
      left -= best.receive;
    }
    if (left > 0) unmet.push({ name: need.name, short: left });
  }
  return {
    trades: trades.toSorted(
      (a, b) =>
        materialOrder(a.to) - materialOrder(b.to) || materialOrder(a.from) - materialOrder(b.from),
    ),
    unmet: unmet.toSorted((a, b) => materialOrder(a.name) - materialOrder(b.name)),
  };
}

/** A material the to-dos take, against what the commander has. */
export interface MaterialNeed {
  name: string;
  info?: MaterialInfo;
  have: number;
  need: number;
  /** How many more are wanted; 0 when there are enough. */
  short: number;
}

/** Where a material is listed: its trader's category, cargo, or the ship locker. */
export type NeedGroup = TradedCategory | 'Cargo' | 'Locker';

export function needGroup(info: MaterialInfo | undefined): NeedGroup {
  const category = info?.category;
  if (category === 'Raw' || category === 'Manufactured' || category === 'Encoded') return category;
  return category === 'Commodity' ? 'Cargo' : 'Locker';
}

/** Every material the to-dos take, in the game's order: category, family, grade. */
export function materialNeeds(
  todos: readonly CraftingTodo[],
  inventory: Readonly<Record<string, number>>,
  standings: readonly EngineerStanding[],
): MaterialNeed[] {
  return Object.entries(reservedMaterials(todos, standings))
    .map(([name, need]) => {
      const info = materialInfo(name);
      const have = inventory[name] ?? 0;
      return { name, ...(info && { info }), have, need, short: Math.max(0, need - have) };
    })
    .toSorted((a, b) => materialOrder(a.name) - materialOrder(b.name));
}

let order: Map<string, number> | undefined;
/** A material's place in the game's own lists: by category, family, then grade. */
export function materialOrder(name: string): number {
  if (!order) {
    const categories: MaterialCategory[] = [
      'Raw',
      'Manufactured',
      'Encoded',
      'Commodity',
      'Item',
      'Component',
      'Data',
      'Consumable',
    ];
    order = new Map(
      Object.entries(MATERIALS)
        .toSorted(
          ([aName, a], [bName, b]) =>
            categories.indexOf(a.category) - categories.indexOf(b.category) ||
            familyOrder(a.family) - familyOrder(b.family) ||
            (a.grade ?? 0) - (b.grade ?? 0) ||
            a.name.localeCompare(b.name) ||
            aName.localeCompare(bName),
        )
        .map(([key], index) => [key, index]),
    );
  }
  return order.get(name) ?? Number.MAX_SAFE_INTEGER;
}

/** Each category's families as EDDiscovery (and the game's material lists) order them. */
export const FAMILIES: Readonly<Record<TradedCategory, readonly string[]>> = {
  Raw: ['Category1', 'Category2', 'Category3', 'Category4', 'Category5', 'Category6', 'Category7'],
  Manufactured: [
    'Chemical',
    'Thermic',
    'Heat',
    'Conductive',
    'MechanicalComponents',
    'Capacitors',
    'Shielding',
    'Composite',
    'Crystals',
    'Alloys',
    'Guardian',
    'Thargoid1',
    'Thargoid2',
    'Thargoid3',
    'Thargoid4',
  ],
  Encoded: [
    'EmissionData',
    'WakeScans',
    'ShieldData',
    'EncryptionFiles',
    'DataArchives',
    'Firmware',
    'Guardian',
    'GuardianObelisk',
    'Thargoid1',
    'Thargoid2',
  ],
};

function familyOrder(family: string | undefined): number {
  if (family === undefined) return -1;
  for (const families of Object.values(FAMILIES)) {
    const index = families.indexOf(family);
    if (index >= 0) return index;
  }
  return 99;
}

/** A family as the game's material lists head it: "Chemical", "Emission data", "Raw 3"… */
export function familyLabel(family: string): string {
  const raw = /^Category(\d)$/.exec(family);
  if (raw) return `Raw ${raw[1]}`;
  const words = family
    .replace(/(\d)$/, ' $1')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * A to-do from the window or the database, checked: known blueprint or synthesis, grades in range,
 * counts whole. Undefined for anything else.
 */
export function sanitizeTodo(value: unknown): NewCraftingTodo | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const read = (key: string): unknown => Reflect.get(value, key);
  const whole = (key: string, min: number, max: number): number | undefined => {
    const number = read(key);
    return typeof number === 'number' && Number.isInteger(number) && number >= min && number <= max
      ? number
      : undefined;
  };
  if (read('kind') === 'synthesis') {
    const synthesis = read('synthesis');
    const counts = read('counts');
    if (typeof synthesis !== 'string' || !synthesisByName(synthesis) || !Array.isArray(counts)) {
      return undefined;
    }
    const [basic, standard, premium] = [0, 1, 2].map((index) => {
      const count: unknown = counts[index];
      return typeof count === 'number' && Number.isFinite(count)
        ? Math.min(999, Math.max(0, Math.floor(count)))
        : 0;
    });
    return { kind: 'synthesis', synthesis, counts: [basic!, standard!, premium!] };
  }
  if (read('kind') !== 'blueprint') return undefined;
  const key = read('blueprint');
  const blueprint = typeof key === 'string' ? blueprintByKey(key) : undefined;
  if (!blueprint) return undefined;
  const top = maxGrade(blueprint);
  const from = whole('from', 0, top - 1);
  const to = whole('to', 1, top);
  // Named apart from the `rolls` saved before rolls were planned from the engineer's rank, which
  // meant something else and is dropped.
  const rolls = read('targetRolls') === undefined ? undefined : whole('targetRolls', 1, 99);
  const count = whole('count', 1, 99);
  if (from === undefined || to === undefined || to <= from) return undefined;
  const experimental = read('experimental');
  const engineer = read('engineer');
  return {
    kind: 'blueprint',
    blueprint: blueprint.key,
    ...(typeof experimental === 'string' &&
      experimentalsFor(blueprint.module).some((recipe) => recipe.id === experimental) && {
        experimental,
      }),
    from,
    to,
    ...(rolls !== undefined && { targetRolls: rolls }),
    ...(count !== undefined && count > 1 && { count }),
    ...(read('onlyExperimental') === true && { onlyExperimental: true }),
    ...(typeof engineer === 'string' && engineer !== '' && { engineer }),
  };
}

/** A to-do's name: "Increased FSD Range · Frame Shift Drive", or the synthesis. */
export function todoName(todo: CraftingTodo): string {
  if (todo.kind === 'synthesis') return todo.synthesis;
  const blueprint = blueprintByKey(todo.blueprint);
  return blueprint ? `${blueprint.name} · ${blueprint.module}` : todo.blueprint;
}

// ---------- material traders ----------

/** Which stations with a material trader to look for. */
export interface TraderFilters {
  /** A system name; empty for where the commander is. */
  near: string;
  maxDistanceLy: number;
  /** 0 for any distance from the arrival point. */
  maxArrivalLs: number;
  pad: 'any' | 'medium' | 'large';
  planetary: boolean;
  /** The traders wanted; none is taken as all three. */
  types: TradedCategory[];
}

export interface TraderSearchRequest extends TraderFilters {
  page: number;
}

export interface TraderStation {
  marketId: string;
  name: string;
  type: string;
  system: string;
  /** From the reference searched around. */
  distanceLy: number;
  arrivalLs?: number;
  pad?: 'S' | 'M' | 'L';
  planetary: boolean;
  trader: TradedCategory;
  /** When Spansh last heard about the station (ISO 8601). */
  updatedAt?: string;
}

export interface TraderSearchResult {
  stations: TraderStation[];
  /** How many match in all. */
  total: number;
  /** What the distances are from. */
  reference: string;
}

export const DEFAULT_TRADER_FILTERS: TraderFilters = {
  near: '',
  maxDistanceLy: 200,
  maxArrivalLs: 0,
  pad: 'any',
  planetary: true,
  types: [],
};
