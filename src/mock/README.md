# EDSSI mock UI

EDSSI's own windows, drawn by the app's real components against made-up data, for embedding in
other pages: a website's screenshots that can't drift from the app, a design review, a demo. Any
number on one page, each an EDSSI of its own.

## Installing

It is published to GitHub Packages with each release of EDSSI, at EDSSI's version. GitHub
Packages wants a token even to install a public package: a classic personal access token with
`read:packages`, or in a workflow its own `GITHUB_TOKEN` (with `packages: read`). The project
installing it says where the scope lives, in its `.npmrc`:

```ini
@lunavod:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

```sh
npm install @lunavod/edssi-mock-ui
```

React 19 is a peer dependency.

## Using it

```tsx
import { MockApp, demoScenario } from '@lunavod/edssi-mock-ui';
import '@lunavod/edssi-mock-ui/style.css';

<div style={{ width: 1446, height: 900 }}>
  <MockApp scenario={demoScenario} tab="materials" />
</div>;
```

- `scenario`: everything that EDSSI shows (`MockScenario`). Spread one over another to change a
  part: `{ ...demoScenario, hudColor: { color: '#3d8bff', theme: 'Azure' } }`. A new scenario
  object is a new EDSSI, so keep it stable across renders (define it outside the component).
- `tab`: the module it opens on (`mission`, `route`, `comms`, `materials`, `commodities`,
  `journal`, `ships`, `settings`). Default: Mission.
- `className`, `style`: for the root, which fills its container.

The app is laid out for a 1446 px wide window. Give it that, or draw it at that size and scale it
down with a transform, as the demo page does (`demo/Scaled.tsx`). It works scaled, popups included.

## What works

It's the real app, so everything that only reads works: tabs, sub-pages, sorting, filters,
expanding rows, the route map. What a visitor can usefully change, changes, in that instance
only: favourite recipes, to-dos, the shopping list, the route position, view options, settings, a
question to the assistant (which says it is a demo). Whatever needs the game, the network or the
desktop answers that it isn't in the demo (`DEMO_ONLY`): Spansh searches, plans, loading files,
voice. Nothing is kept: a reload starts afresh.

Each instance lives in a shadow root with a React root of its own, so the page's stylesheets
can't reach in (a page's bare `h2 { … }` rule would otherwise restyle the app's headings) and the
app's can't reach out; inherited properties stop at its edge too. Popups and dialogs stay inside it
(its root is a `fixed` containing block, and dialogs open non-modal), its HUD colour is set on its
own root, and nothing it does scrolls the page. Being its own React root, it takes no context from
the page's tree.

`style.css` holds only the fonts' `@font-face` rules, which have to be in the page: a font declared
in a shadow root isn't loaded. The app's own stylesheets travel inside the module, one copy into
each instance's shadow root.

## Making a scenario

`demoScenario` is made by `npm run mock:scenario` (scripts/build-mock-scenario.ts):

1. `scripts/mock/demo-journal.ts` writes a journal of a made-up trip, timed back from now, into
   `node_modules/.cache/edssi-mock/journals/demo`, with the companion files the game would leave.
   The biology on its bodies is what EDSSI's own spawn rules predict, and the ships' modules come
   from EDSY's tables (fetched once, cached beside it).
2. `scripts/mock/run-services.ts` runs the main process's services over that journal outside
   Electron (`electron` is aliased to `scripts/mock/electron-stub.ts`, which keeps their IPC
   handlers) and asks them what they'd send a window.
3. `scripts/mock/demo-extras.ts` adds what no journal makes: the assistant's conversation,
   settings, uploads, the shopping list.

Run it again when what a service sends changes, and now and then to bring the dates up to date.
The same journal runs the real app: `EDSSI_JOURNAL_DIR=node_modules/.cache/edssi-mock/journals/demo`.

## Building

- `npm run mock:dev`: the demo page (`index.html`, `demo/`), served with hot reload.
  `?tab=<id>` shows one window, scaled to the page.
- `npm run mock:build`: the demo page as a static site in `out/mock/`.
- `npm run mock:lib`: the package in `dist/mock-ui/`: `index.js`, `style.css`, the fonts, type
  declarations, `package.json` and this README. React 19 is a peer dependency. The release
  workflow's `mock-ui` job makes the scenario afresh, builds this and publishes it, after the app
  itself has been built and uploaded; see docs/releasing.md.

Both builds rewrite the app's stylesheets so they only apply inside `.edssi-theme`, and leave out
every extension: `extensions/` never reaches the mock (`scripts/mock/vite-plugins.ts`).

## Keeping the app mockable

The mock breaks quietly, so new code in the renderer keeps to these:

- **Reach the main process through `useEdssi()`** (`src/renderer/src/api/context.ts`), never
  `window.edssi`; only `main.tsx` reads that. A helper outside a component takes the `EdssiApi`.
- **No module-level state that belongs to an instance.** A store shared by a window's components
  lives in `EdssiProvider` (as `viewOptions` and `settingsRequests` do), not in a module's `let`.
- **A new `EdssiApi` method** needs a stub in `src/mock/mock-edssi.ts` (`implements EdssiApi` won't
  compile without one). Reads answer from the scenario; a new kind of data is a new
  `MockScenario` field, filled by the scenario builder.
- **The document isn't the app's.** Set the HUD colour and read tokens on `themeRoot()`, not
  `document.documentElement`; open dialogs with `useOpenDialog()`; scroll with `scrollNearest` or
  `scrollWithin`, never `scrollIntoView`; hang a `fixed` popup with `popupPlace`. Find elements
  from a ref (`pane.querySelector`), never `document.getElementById`: in a shadow root the document
  can't see them, and with several instances an id isn't unique.
- **Nothing of the visitor's.** Remember small choices in `useWindowStorage()`, not
  `localStorage` (in the mock, each instance keeps its own in memory). Use the microphone,
  speakers or their list only where `useLocalDevices()` says so (the mock never asks for a
  microphone). A key or paste listener on the window or document checks `useOwnsEvent()`, so
  Ctrl+S on the host page stays the page's. The clipboard goes through `edssi.clipboard`.
  `scripts/mock/renderer-api.test.ts` checks all of these.
- **Size from the window's box**: `100vh`/`100vw` become `100%` in the mock builds, so they must
  still make sense as the root's size.
- **Draw with nothing**: an empty list, a missing snapshot, a promise that never resolves.
