# Changelog

What changed in each release, in technical detail. The notes EDSSI shows commanders after an
update are CHANGELOG_USER.md.

## 1.2.0

### Added

- A Spansh page on the Route tab (`hud/SpanshPlotView.tsx`, `src/main/spansh-plot-service.ts`,
  `src/main/spansh/plot.ts`): the galaxy map's route plotter as a form over Spansh's galaxy,
  neutron and fleet carrier plotters, for the ship being flown or any other the commander owns.
  The galaxy plotter takes no stops on the way, so a route with them is a job per leg, joined.
  System names are suggested from Spansh as they are typed. The answer is folded into a `CsvRoute`
  under Spansh's CSV columns (`spanshToCsvRoute`) and waits on the page, and beside the followed
  route on the Map page, until Follow makes it the CSV route or Save puts it among the saved
  routes.
- Start with the game (`startup.with_game`, `src/main/startup/`): an installed build writes
  `start-with-game.ps1` into the data folder and adds it to Windows' startup apps. The hidden
  watcher looks for `EliteDangerous64` every 3 s and starts EDSSI with `--started-by-game`, which
  shows the window inactive, and hands focus back to the game if an EDSSI window takes it in the
  first moments. Turning it off removes the startup app and the script.
- The mock UI (`src/mock/`): `<MockApp scenario tab />` draws the real app against a
  `MockScenario`, many to a page, each in a shadow root with its own React root and `MockEdssi`.
  The demo scenario is made by running the real services over the journal of a made-up trip
  (`npm run mock:scenario`). A demo page (`mock:dev`, `mock:build`) and a package (`mock:lib`),
  published to GitHub Packages as `@lunavod/edssi-mock-ui` with each release.
- An Extensions page on the Settings tab (`settings/ExtensionsPanel.tsx`): every extension, built
  in or installed, and how it stands (running, turned off, failed, or an installed one left out
  for a built-in one of the same name), a switch for each from the next start
  (`<config dir>/extensions.json`, read once at start), the installed extensions' folder, a
  restart button and a link to `docs/extensions.md`. Folders that can't be loaded are listed with
  why.
- Extension API 2:
  - `context.journal.session` and `.all` hear EDSSI's own two journal readers
    (`src/main/extension-feed.ts`), each event with its source and whether it is live;
    `onLive` says when the replay is done, `session.onCompanion` hears the companion files, and
    `journal.dir()` is the folder they read. A handler that throws is logged under the
    extension's name.
  - `context.game` (the assistant's `GameData`), `context.ask` (one tool-less question to the
    assistant's model), `dataDir()`, `log` and `showTab()`.
  - `tabs` and `sidePanel` on `RendererExtension`: modules of its own on the tab bar
    (`extensionTabId`, so `TabId` takes `ext:<extension>/<tab>`) and blocks under the fuel, each
    inside an `ExtensionBoundary`.
  - `EdssiContext` is kept on `globalThis` under `Symbol.for('edssi.context')`, so an installed
    extension's bundled copy of `api/context.ts` finds the running EDSSI's, and `useEdssi()` and
    the hooks built on it work from one.

### Changed

- An installed extension built for any API version from `OLDEST_EXTENSION_API_VERSION` (1) to
  `EXTENSION_API_VERSION` (2) loads; one built for a later EDSSI is refused with "update EDSSI".
- The window reaches the main process through `useEdssi()`, from an `EdssiProvider` per instance,
  instead of `window.edssi`, which only `main.tsx` reads. State a window's components share (view
  options, Settings page requests) and what belongs to the document (the HUD colour's root, how
  dialogs open, the microphone, small remembered choices) live on the provider. Popups place
  themselves inside a scaled frame (`popupPlace`), and lists scroll their own box
  (`scrollNearest`, `scrollWithin`) rather than the page.

### Fixed

- Picking the ChatGPT plan on the Settings tab showed no sign-in until the settings were saved:
  the sign-in followed the saved provider rather than the one picked.
- Copying a stop's name from the route map used a clipboard the window doesn't have; it goes
  through the main process now.

## 1.1.0

### Added

- Installed extensions: `npm run build:extension -- <name> --install` builds an extension on its
  own into `<config dir>/extensions/<name>/`, and any build loads it at start, beside the ones
  compiled in from `extensions/` (`src/main/extensions.ts`, `src/main/installed-extensions.ts`,
  `src/shared/extensions.ts`). EDSSI's code it imports is bundled in; React and zod are the running
  EDSSI's, through stand-ins on `globalThis`; native modules are required from EDSSI's folder
  (`EDSSI_APP_PATH`, which its utility processes and workers inherit). The window loads its side
  over the `edssi-ext://` scheme before importing the app. `extension.json` carries
  `EXTENSION_API_VERSION`, and one built for another is left out.
- A field on the Settings tab can carry an `aside`, a paragraph in a row of its own. The
  assistant's provider uses it, on its page and on Quickstart, to say that the API key and ChatGPT
  sign-in stay on the PC, are used only with OpenAI, and that nothing runs in the background.

### Changed

- Speaking defaults to Kokoro and listening to whisper.cpp, both on the PC, so a fresh install
  needs no key for either. The `auto` speaking provider is gone: a settings file that still says
  `auto` is read as what it came to (Inworld with a key, Kokoro without), and the "implied" mark
  it needed on the provider's choice is removed.
- The assistant defaults to `gpt-5.6-terra` at `medium` reasoning effort (was `gpt-5.6-luna` at
  `low`); a settings file that names a model keeps it.
- The OpenAI key's fields hide on the ChatGPT plan unless OpenAI is hearing the commander.
- The Inara section is left off the Settings tab until Inara whitelists EDSSI, as it answers no
  other application; the settings file still takes its key.
- Quickstart's VR bindings line up in one column.
- `out/extensions/` is kept out of packages.

### Fixed

- `assistant:prepare-kokoro` had lost its handler when the voice preview was made to try any
  voice, so the Settings tab's voice test only started loading Kokoro once Play was pressed, and
  logged "No handler registered" each time it was shown.

## 1.0.0

First public release.

### Added

- Live journal and companion-file reader with session and full-history replay, feeding the HUD,
  the Mission, Route, Comms, Materials, Commodities, Journal, Ships and Settings tabs.
- Exploration ledger (cartographic and exobiology values, fines, vouchers), body survey, life
  prediction from scans (EDMC-BioScan's rules), personal bests and probe targets.
- Assistant over the Responses API (API key or ChatGPT sign-in) with toolsets for the game,
  activity history, Spansh search and plotters, the web and a driven browser; push-to-talk on keys
  and sticks over raw HID; speech from Inworld, Kokoro (local) or Wyoming; transcription from
  OpenAI, whisper.cpp (local) or Wyoming.
- Nav-route history with EDSM lookups; CSV routes with clipboard hand-off, saved routes and a 3D
  map; materials tracking, crafting to-dos, build import and trade planning; commodity shopping
  lists, Spansh market search and purchase/sale planning; ships from EDSY's database with exports;
  fleet carrier tracking, upkeep and fuel prediction.
- Flight, carrier and nearby-carrier alerts; carrier jumps to a Discord webhook.
- Journal uploads to EDSM, Inara and EDDN with per-service cursors and an upload log.
- FSS exobiology overlay for EDHM, and HUD colour matching to the EDHM theme.
- A prototype SteamVR cockpit.
- Self-updating releases: signed NSIS installer, electron-updater over R2, install at next start,
  "What's new" notes, and a dev channel.
