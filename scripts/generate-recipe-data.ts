/**
 * Generates src/shared/recipes.generated.ts, every crafting recipe and the name of every material,
 * commodity and Odyssey resource, from EDDiscovery's tables at
 * github.com/EDDiscovery/EliteDangerousCore (pinned below). Bump CORE_COMMIT and rerun
 * `npm run gen:recipes` after a game update.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import type {
  EngineerInfo,
  MaterialCategory,
  MaterialInfo,
  Recipe,
  RecipeKind,
} from '../src/shared/materials';

const CORE_REPO = 'https://raw.githubusercontent.com/EDDiscovery/EliteDangerousCore';
const CORE_COMMIT = '609545d29f48b53cf2611cda6a8e7a2210cf0b75';
const ITEMS = 'EliteDangerous/FrontierData/Items';

const root = resolve(import.meta.dirname, '..');
const outFile = join(root, 'src', 'shared', 'recipes.generated.ts');

async function source(file: string): Promise<string> {
  const dir = join(root, 'node_modules', '.cache', 'eddiscovery-core', CORE_COMMIT);
  const path = join(dir, file);
  if (!existsSync(path)) {
    const response = await fetch(`${CORE_REPO}/${CORE_COMMIT}/${ITEMS}/${file}`);
    if (!response.ok) throw new Error(`${file}: HTTP ${response.status}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path, await response.text());
  }
  return readFileSync(path, 'utf8').replace(/^﻿/, '');
}

/** ItemType's material commonalities, in the game's grade order. */
const GRADES: Record<string, number> = {
  VeryCommon: 1,
  Common: 2,
  Standard: 3,
  Rare: 4,
  VeryRare: 5,
};

/** MaterialGroupType's names, less the category: `Chemical`, `Category3`, `EmissionData`… */
function family(group: string | undefined, category: string): string | undefined {
  if (group === undefined || group === 'NA') return undefined;
  return group.startsWith(category) ? group.slice(category.length) : group;
}

/** `Add(CatType.Raw, ItemType.Common, MaterialGroupType.RawCategory3, MCMR.Manganese, "Manganese", "Mn");` */
function parseMaterials(text: string): {
  materials: Map<string, MaterialInfo>;
  short: Map<string, string>;
} {
  const materials = new Map<string, MaterialInfo>();
  const short = new Map<string, string>();
  const pattern =
    /Add\(CatType\.(\w+),\s*(?:ItemType\.(\w+),\s*)?(?:MaterialGroupType\.(\w+),\s*)?MCMR\.(\w+)((?:,\s*"[^"]*")+)(?:,\s*(?:true|false))?\s*\);/g;
  for (const match of text.matchAll(pattern)) {
    const [, category, itemType, group, id, rest] = match;
    const strings = [...rest!.matchAll(/"([^"]*)"/g)].map((string) => string[1]!);
    // The longest overload names the journal's own name before the English one.
    const [fdName = id!, name = '', shortName] = strings.length === 3 ? strings : [id, ...strings];
    const key = fdName.toLowerCase();
    const grade = itemType === undefined ? undefined : GRADES[itemType];
    const trades = isMaterial(category!) ? family(group, category!) : undefined;
    materials.set(key, {
      name,
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- CatType's names are these
      category: category as MaterialCategory,
      ...(grade !== undefined && isMaterial(category!) && { grade }),
      ...(trades !== undefined && { family: trades }),
    });
    if (shortName) short.set(shortName.toLowerCase(), key);
  }
  return { materials, short };
}

function isMaterial(category: string): boolean {
  return category === 'Raw' || category === 'Manufactured' || category === 'Encoded';
}

/** `"3V,2Ni,2Cr,2Zn"` as journal names and counts. */
function ingredients(list: string, short: Map<string, string>, recipe: string): [string, number][] {
  return list
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item): [string, number] => {
      const match = /^(\d+)(\w+)$/.exec(item);
      const key = match && short.get(match[2]!.toLowerCase());
      if (!match || !key) throw new Error(`${recipe}: unknown ingredient ${item}`);
      return [key, Number(match[1])];
    });
}

/** The C# string and number arguments of each `new Type(...)`, with enum values as strings. */
function constructorCalls(text: string, type: string): string[][] {
  const calls: string[][] = [];
  const pattern = new RegExp(`new ${type}\\(((?:[^()"]|"[^"]*")*)\\)`, 'g');
  for (const match of text.matchAll(pattern)) {
    const args = [...match[1]!.matchAll(/"([^"]*)"|null|-?[\w.]+/g)].map((arg) =>
      arg[1] !== undefined ? arg[1] : arg[0],
    );
    calls.push(args);
  }
  return calls;
}

const SYNTHESIS_GRADES: Record<string, number> = {
  'SynthesisRecipe.SynthesisLevel.Basic': 1,
  'SynthesisRecipe.SynthesisLevel.Standard': 2,
  'SynthesisRecipe.SynthesisLevel.Premium': 3,
};

/** Module types whose enum name isn't what the game's outfitting calls them. */
const MODULE_NAMES: Record<string, string> = {
  CargoScanner: 'Manifest Scanner',
  Sensor: 'Sensors',
  AutoFieldMaintenanceUnit: 'Auto Field-Maintenance Unit',
};

/** `ItemData.ShipModule.ModuleTypes.Multi_Cannon` reads "Multi-Cannon". */
function moduleName(type: string): string {
  const id = type.replace(/^.*\./, '');
  return MODULE_NAMES[id] ?? id.replace(/_/g, '-').replace(/([a-z])([A-Z])/g, '$1 $2');
}

function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function parseSynthesis(text: string, short: Map<string, string>): Recipe[] {
  return constructorCalls(text, 'SynthesisRecipe').map(([name, fdName, level, list]) => {
    const grade = SYNTHESIS_GRADES[level!];
    if (grade === undefined) throw new Error(`${name}: unknown level ${level}`);
    const recipe: Recipe = {
      id: `synthesis:${slug(name!)}:${grade}`,
      kind: 'synthesis',
      group: name!,
      name: name!,
      grade,
      engineers: [],
      ingredients: ingredients(list!, short, name!),
    };
    // A few have no journal name EDDiscovery knows.
    if (fdName !== 'null') recipe.fdName = fdName!.toLowerCase();
    return recipe;
  });
}

function parseEngineering(text: string, short: Map<string, string>): Recipe[] {
  const recipes: Recipe[] = [];
  for (const args of constructorCalls(text, 'EngineeringRecipe')) {
    const recipe = engineeringRecipe(args, short);
    if (recipe) recipes.push(recipe);
  }
  return recipes;
}

const isModule = (arg: string | undefined) => arg?.startsWith('ItemData.') === true;

/**
 * Blueprints and experimental effects EDDiscovery lists under the wrong module, by module type and
 * journal name: the mine launcher's four blueprints (engineered by Juri Ishmaak, Liz Ryder and
 * Petra Olmanova) and its three canister experimentals are filed under life support, as its
 * `ModuleTypes` has no mine launcher. Life support takes no experimentals. Drop an entry once
 * EDDiscovery fixes it.
 */
const MISFILED: readonly { type: string; blueprint: RegExp; module: string }[] = [
  { type: 'LifeSupport', blueprint: /^weapon_/i, module: 'Mine Launcher' },
  { type: 'LifeSupport', blueprint: /^special_/i, module: 'Mine Launcher' },
];

function blueprintModule(type: string, fdName: string): string {
  const id = type.replace(/^.*\./, '');
  const fix = MISFILED.find((entry) => entry.type === id && entry.blueprint.test(fdName));
  return fix?.module ?? moduleName(type);
}
const isNumber = (arg: string | undefined) => arg !== undefined && /^\d+$/.test(arg);

/** Each of EngineeringRecipe's constructors, told apart by their arguments' shapes. */
function engineeringRecipe(args: string[], short: Map<string, string>): Recipe | undefined {
  // Suit or weapon mod: (moduletype, fdname, manufacturer, name, cost, ingredients, engineers)
  if (isModule(args[0]) && args.length === 7) {
    const [type, fdName, maker, name, , list, engineers] = args;
    const what = moduleName(type!);
    // EDDiscovery's names for the per-manufacturer mods all say "Kinematic Armaments".
    const base = name!.replace(/:.*$/, '');
    const display = maker === 'All' ? base : `${base}: ${maker}`;
    return {
      id: `${slug(what)}-mod:${fdName}:${slug(maker!)}`,
      kind: 'odyssey',
      group: `${what} modifications`,
      name: display,
      fdName: fdName!.toLowerCase(),
      engineers: engineers!.split(','),
      ingredients: ingredients(list!, short, display),
    };
  }
  // Suit or weapon grade upgrade: (moduletype, manufacturer, grade, ingredients)
  if (isModule(args[0]) && args.length === 4) {
    const [type, maker, grade, list] = args;
    const what = moduleName(type!);
    return {
      id: `${slug(what)}-upgrade:${slug(maker!)}:${grade}`,
      kind: 'odyssey',
      group: `${what} upgrades`,
      name: maker!,
      grade: Number(grade),
      engineers: [],
      ingredients: ingredients(list!, short, `${maker} ${what}`),
    };
  }
  // Blueprint: (name, fdname, ingredients, moduletype, grade, engineers)
  if (args.length === 6 && isModule(args[3]) && isNumber(args[4])) {
    const [name, fdName, list, type, grade, engineers] = args;
    // Ones nobody can apply (pre-engineered, obsolete, decorative) have no ingredients or engineers.
    if (!list || !engineers || type!.endsWith('UnknownType')) return undefined;
    const module = blueprintModule(type!, fdName!);
    return {
      id: `engineering:${fdName}:${slug(module)}:${grade}`,
      kind: 'engineering',
      group: module,
      name: name!,
      grade: Number(grade),
      fdName: fdName!.toLowerCase(),
      engineers: engineers.split(',').map((engineer) => engineer.replace(" 'The Blaster'", '')),
      ingredients: ingredients(list, short, `${name} ${module}`),
    };
  }
  // Technology broker: (name, fdname, broker, moduletype, ingredients)
  if (args.length === 5 && isModule(args[3])) {
    const [name, fdName, broker, , list] = args;
    const guardian = broker!.startsWith('Guardian');
    const known = fdName !== 'unknown' && fdName !== '?' && !fdName!.endsWith('_unknown');
    return {
      id: `techbroker:${slug(name!)}`,
      kind: 'techbroker',
      group: guardian ? 'Guardian' : 'Human',
      name: name!,
      ...(known && { fdName: fdName!.toLowerCase() }),
      engineers: [],
      ingredients: ingredients(list!, short, name!),
    };
  }
  // Experimental effect: (name, fdname, moduletype or "Type,Type", ingredients)
  if (args.length === 4) {
    const [name, fdName, types, list] = args;
    const modules = isModule(types)
      ? [blueprintModule(types!, fdName!)]
      : types!.split(',').map((type) => moduleName(type));
    return {
      id: `experimental:${fdName}`,
      kind: 'experimental',
      group: modules.join(', '),
      name: name!,
      fdName: fdName!.toLowerCase(),
      engineers: [],
      ingredients: ingredients(list!, short, name!),
    };
  }
  throw new Error(`Unrecognised EngineeringRecipe(${args.join(', ')})`);
}

/**
 * `new EngineeringInfo("Felicity Farseer", "Deciat", "Farseer Inc", 122.625, -0.8125, -47.28125,
 * "6 A", discovery, meeting, unlock, reputation, permit, odyssey)`.
 */
function parseEngineers(text: string): EngineerInfo[] {
  return constructorCalls(text, 'EngineeringInfo')
    .filter((args) => args.length >= 11)
    .map(([name, system, base, x, y, z, planet, discovery, meeting, unlock, , permit, odyssey]) => {
      const coords = [x, y, z].map(Number);
      if (!name || !system || !base || coords.some((value) => !Number.isFinite(value))) {
        throw new Error(`Unreadable engineer ${name ?? '?'}`);
      }
      return {
        name,
        system,
        base,
        ...(planet && { planet }),
        coords: coords as [number, number, number],
        ...(discovery && { discovery }),
        ...(meeting && { meeting }),
        ...(unlock && { unlock }),
        ...(permit === 'true' && { permit: true }),
        ...(odyssey === 'true' && { odyssey: true }),
      };
    })
    .toSorted((a, b) => a.name.localeCompare(b.name));
}

const KIND_ORDER: RecipeKind[] = [
  'synthesis',
  'engineering',
  'experimental',
  'techbroker',
  'odyssey',
];

async function main(): Promise<void> {
  const { materials, short } = parseMaterials(await source('MCMRType.cs'));
  const recipes = [
    ...parseSynthesis(await source('RecipesSynthesis.cs'), short),
    ...parseEngineering(await source('RecipesEngineering.cs'), short),
  ].toSorted(
    (a, b) =>
      KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) ||
      a.group.localeCompare(b.group) ||
      a.name.localeCompare(b.name) ||
      (a.grade ?? 0) - (b.grade ?? 0),
  );
  const ids = new Set<string>();
  for (const recipe of recipes) {
    if (ids.has(recipe.id)) throw new Error(`Duplicate recipe id ${recipe.id}`);
    ids.add(recipe.id);
  }

  const engineers = parseEngineers(await source('Engineers.cs'));

  const materialTable = Object.fromEntries(
    [...materials].toSorted(([a], [b]) => a.localeCompare(b)),
  );
  // As JSON to parse: TypeScript gives up checking a literal of a thousand recipes against Recipe.
  const out = `// Generated by scripts/generate-recipe-data.ts from EDDiscovery's EliteDangerousCore
// (${CORE_COMMIT}). Do not edit.
import type { EngineerInfo, MaterialInfo, Recipe } from './materials';

/** Every material, commodity and Odyssey resource, by its lowercase journal name. */
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- written by the generator in this shape
export const MATERIALS = JSON.parse(${JSON.stringify(JSON.stringify(materialTable))}) as Readonly<
  Record<string, MaterialInfo>
>;

/** Every crafting recipe: synthesis, engineering, experimentals, technology brokers, suits and weapons. */
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- written by the generator in this shape
export const RECIPES = JSON.parse(${JSON.stringify(JSON.stringify(recipes))}) as readonly Recipe[];

/** Every engineer: where their workshop is, and how to get in. */
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- written by the generator in this shape
export const ENGINEERS = JSON.parse(${JSON.stringify(JSON.stringify(engineers))}) as readonly EngineerInfo[];
`;
  writeFileSync(outFile, out);
  console.log(
    `${recipes.length} recipes, ${materials.size} materials, ${engineers.length} engineers → ${outFile}`,
  );
}

await main();
