/**
 * Makes the mock UI's demo scenario, `src/mock/fixtures/demo.json` (`npm run mock:scenario`).
 *
 * 1. EDSY's ship tables, fetched once and cached under node_modules/.cache/edssi-mock.
 * 2. A made-up journal of a made-up trip (scripts/mock/demo-journal.ts), timed back from now,
 *    written beside them (`journals/demo`; point the real app at it with `EDSSI_JOURNAL_DIR`).
 * 3. The main process's own services run over it outside Electron (scripts/mock/run-services.ts,
 *    with `electron` aliased to a stub that keeps their IPC handlers), and asked what they'd send
 *    a window — so the mock shows what EDSSI really makes of a journal.
 * 4. The parts no journal makes, written by hand (scripts/mock/demo-extras.ts).
 *
 * Run it again after a change to what a service sends, and to bring the demo's dates up to now.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { createJiti } from 'jiti';

import { catalogFromEdsySource, EDSY_DATABASE_URL } from '../src/main/ships/edsy';
import type { MockScenario } from '../src/mock/scenario';
import type { NewCraftingTodo } from '../src/shared/crafting';
import { RECIPES } from '../src/shared/recipes.generated';
import type { ShipCatalog } from '../src/shared/ships';
import { demoExtras } from './mock/demo-extras';
import { writeDemoJournal } from './mock/demo-journal';
import type { runServices as RunServices } from './mock/run-services';

const CACHE = resolve('node_modules/.cache/edssi-mock');
const OUTPUT = resolve('src/mock/fixtures/demo.json');

async function edsyCatalog(): Promise<ShipCatalog> {
  const file = join(CACHE, 'eddb.js');
  if (!existsSync(file)) {
    console.log(`Fetching ${EDSY_DATABASE_URL}`);
    const response = await fetch(EDSY_DATABASE_URL);
    if (!response.ok) throw new Error(`EDSY answered ${response.status}`);
    writeFileSync(file, await response.text());
  }
  return catalogFromEdsySource(readFileSync(file, 'utf8'));
}

/** A recipe's id less its grade, as a blueprint to-do names it. */
function blueprint(fdName: string): string {
  const recipe = RECIPES.find((candidate) => candidate.fdName === fdName);
  if (!recipe) throw new Error(`No recipe ${fdName}`);
  return recipe.id.replace(/:\d+$/, '');
}

function recipeId(fdName: string): string {
  const recipe = RECIPES.find((candidate) => candidate.fdName === fdName);
  if (!recipe) throw new Error(`No recipe ${fdName}`);
  return recipe.id;
}

mkdirSync(CACHE, { recursive: true });
const now = Date.now();
const catalog = await edsyCatalog();
const journal = writeDemoJournal(join(CACHE, 'journals', 'demo'), catalog, now);

const jiti = createJiti(import.meta.url, {
  alias: { electron: resolve('scripts/mock/electron-stub.ts') },
});
const { runServices } = await jiti.import<{ runServices: typeof RunServices }>(
  './mock/run-services.ts',
);
const todos: NewCraftingTodo[] = [
  {
    kind: 'blueprint',
    blueprint: blueprint('engine_dirty'),
    from: 0,
    to: 5,
    engineer: 'Professor Palin',
  },
  { kind: 'blueprint', blueprint: blueprint('shieldgenerator_thermic'), from: 2, to: 5 },
  { kind: 'blueprint', blueprint: blueprint('powerplant_boosted'), from: 0, to: 3 },
  { kind: 'synthesis', synthesis: 'FSD', counts: [0, 2, 6] },
  { kind: 'synthesis', synthesis: 'AFM Refill', counts: [0, 1, 0] },
];
const answers = await runServices({
  dir: journal.dir,
  catalog,
  csv: {
    text: journal.csv,
    fileName: 'spansh-galaxy-plot-phroi-pruae.csv',
    name: 'Phroi Pruae bio run',
    position: journal.csvPosition,
  },
  todos,
  favourites: [recipeId('fsd premium'), recipeId('fsd standard')],
  hulls: journal.hulls,
});
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- our own package.json
const { version } = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string };
const scenario: MockScenario = { ...answers, ...demoExtras(now, answers, version) };

writeFileSync(
  OUTPUT,
  `${JSON.stringify(scenario, (key, value: unknown) => {
    // JSON can't carry them, and the demo journal never has an id that needs one.
    if (typeof value === 'bigint') throw new Error(`${key} is a bigint; keep the demo's ids small`);
    return value;
  })}\n`,
);
const size = Math.round(readFileSync(OUTPUT).length / 1024);
console.log(
  `Wrote ${OUTPUT} (${size} KB): ${answers.journal.events.length} session events, ` +
    `${answers.ships.ships.length} ships, ${answers.history.survey?.bodies.length ?? 0} bodies here.`,
);
// The services leave timers behind (their broadcasts); nothing else is waiting.
process.exit(0);
