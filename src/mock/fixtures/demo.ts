import type { MockScenario } from '../scenario';
// As text, parsed once: the compiler needn't infer a type for 120 KB of journal.
import demo from './demo.json?raw';

/**
 * A commander six jumps out from their carrier on an exobiology run, low over a world with three
 * genera, 50 million in samples unsold. Made by `npm run mock:scenario` from a fixture journal
 * run through the real services; see scripts/build-mock-scenario.ts.
 */
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- written by the builder from a MockScenario
export const demoScenario = JSON.parse(demo) as MockScenario;
