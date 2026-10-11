/**
 * The mock UI: EDSSI's own windows, drawn against made-up data, for embedding in other pages.
 *
 *   import { MockApp, demoScenario } from '@lunavod/edssi-mock-ui';
 *   import '@lunavod/edssi-mock-ui/style.css';
 *
 *   <div style={{ width: 1446, height: 900 }}>
 *     <MockApp scenario={demoScenario} tab="materials" />
 *   </div>
 *
 * Any number on a page, each with its own scenario; see src/mock/README.md.
 */

export { MockApp, type MockAppProps } from './mock-app';
export { DEMO_ONLY, MockEdssi } from './mock-edssi';
export type { MockScenario } from './scenario';
export { demoScenario } from './fixtures/demo';
export type { TabId } from '../shared/ui';
