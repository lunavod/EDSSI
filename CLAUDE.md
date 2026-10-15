# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

EDSSI (Elite Dangerous Smart Support Interface) is an Electron + React desktop app that follows the
Elite Dangerous player journal live and presents the current game session. Windows is the target
platform.

## Commands

- `npm run dev` — run the app with the electron-vite dev server (renderer hot reload).
- `npm run dev:fresh` — the same, as a first run: new, empty settings, data and journal folders
  under the temp folder (`scripts/dev-fresh.ts`), wiped each time unless given `-- --keep`.
- `npm run check` — typecheck + lint + format check + tests; run before calling work done.
- `npm test` — all tests (Vitest). Single file: `npx vitest run src/main/journal/reader.test.ts`;
  single test: add `-t "<test name>"`.
- `npm run typecheck` (`tsc -b`, TypeScript 7), `npm run lint` / `lint:fix` (oxlint, type-aware),
  `npm run format` / `format:check` (oxfmt — not Prettier/ESLint).
- `npm run dist:win` — build and package the NSIS installer into `dist/`, unsigned and with
  whatever is in `extensions/`, so for trying out only: releases come from the workflow.
- `/release` (Claude Code skill) — check, bump, write both changelogs, tag `vX.Y.Z` and push;
  `.github/workflows/release.yml` builds, signs and publishes it. `dev-v*` tags build EDSSI Dev.
  It also publishes the mock UI to GitHub Packages (`@lunavod/edssi-mock-ui`) at the same version.
  All of it, and the one-time setup, in `docs/releasing.md`.
- `npm run build:extension -- <name> [--install]` — build an extension on its own, for any build of
  EDSSI to load (see the extensions entry below).
- `npm run gen:journal-types` — regenerate event types (see below).
- `npm run gen:recipes` — regenerate crafting recipes from EDDiscovery (see the materials service).
- `python scripts/generate-icon.py` — redraw the app icon (`build/icon.ico` for the installer and
  exe, `build/icon.png` for the window when run from source).
- `npm run send-session -- --list` / `-- --session <prefix> [--target inara] --send` — send past
  game sessions to EDSM or Inara (never EDDN, whose listeners want news) (`scripts/send-session.ts`, run with jiti). A dry run without
  `--send`. It stops at each service's live cursor unless given `--include-sent`.
- `npm run mock:dev` / `mock:build` / `mock:lib` — the mock UI (`src/mock/`): its demo page served,
  built into `out/mock/`, or the embeddable package into `dist/mock-ui/`. `npm run mock:scenario`
  makes its demo scenario afresh (see the mock UI entry below).

To point the app at a test journal folder, set `EDSSI_JOURNAL_DIR`. To keep its records out of
your real database, also set `EDSSI_DATA_DIR`, which also holds that run's browser profile (the
window's storage and caches), so it shares nothing with the real EDSSI. `EDSSI_CONFIG_DIR` moves
the settings file.

## Architecture

Data flows one way: journal files → main process → IPC → renderer.

- **`src/main/journal/`** — `JournalReader` polls (250 ms; file watching is unreliable on Windows)
  the newest `Journal.*.log` and the companion `*.json` files the game rewrites in place (`Status`,
  `Cargo`, `Market`, …). It replays a backfill on `start()` (`none` / `session` / `all`), moves to
  newer journal files as they appear, and dispatches typed events via `on` / `onAny` /
  `onCompanion` / `onError`. `LineReader` reads only appended bytes and holds back unfinished lines;
  `journal-files.ts` sorts both the current and pre-Odyssey file-name schemes and groups the
  `.01`, `.02`… parts of one game session; `locate.ts` finds the folder via the registry.
- **`src/main/journal-service.ts`** — keeps the current session's events in memory, broadcasts each
  event/companion update to all windows as a `JournalMessage` with an increasing `seq`, and serves a
  `JournalSnapshot` on request. A `Fileheader` with `part === 1` starts a new session.
- **`src/main/store/`** — EDSSI's own SQLite database, for what the game doesn't keep. It uses
  `node:sqlite` (built into Electron, so no native module) at `<userData>/edssi.db` (or
  `EDSSI_DATA_DIR`). `database.ts` applies the ordered `MIGRATIONS`, tracked by
  `PRAGMA user_version`; never edit one that has shipped. `index.ts` creates the `JournalReader`
  and hands it to every service before starting it.
- **`src/main/nav-route-service.ts`** — records every plotted route in `NavRouteStore`. The journal's
  `NavRoute` line never lists systems (only `NavRoute.json` does, with the same timestamp). The game
  clears the route during the final jump, ~12 s before the `FSDJump` that arrives, so
  `routeProgress()` in `src/shared/nav-routes.ts` still counts that arrival.
  Targeting a system off the route drops it with no `NavRouteClear` (and leaves it in
  `NavRoute.json`); only that `FSDTarget` lacking `RemainingJumpsInRoute` says so, and it counts as
  the clear.
  Once the history is replayed, the route being followed is looked up on EDSM in bulk
  (`EdsmClient.knownSystems`, `route-edsm.ts`); the answer rides on the route as `edsm` (in memory
  only), for the route panels, and a route plotted live gets a spoken line on how many of its
  systems EDSM doesn't know.
- **`src/main/csv-route-service.ts`** + **`src/main/csv-route/`**: the Route tab's second page, a
  route loaded from a CSV file (Spansh's exports; parsed in `src/shared/csv-route.ts`), kept in
  `csv_route` with the last route system reached. It follows the session reader's jumps, and on
  each live `FSDJump`/`CarrierJump` into a route system copies the next one to the clipboard —
  from the main process, since the game has focus then. Loading a route copies where to head too.
  A route (from a file or an extension's plotter) can be saved under a name (`saved_route`,
  `SavedRouteStore`) and switched back to from the page's row of saved routes; the loaded one
  carries its `savedId`, and every move along it is written to its saved copy too, so it is picked
  up where it was left — or where the commander is, when that is one of its systems. An
  extension can save a route it made without it being loaded (`CsvRouteService.save`).
  While no route is plotted and the commander is in one of its systems, the Mission tab's route
  and the side panel's next jump show it as they would a plotted one (`src/shared/followed-route.ts`).
  A plot that is only a stretch of it (ending at a later route system, `plottedAlongCsv`) shows
  the CSV route instead, and gets no spoken line about EDSM. Once the session is replayed, the
  systems a route doesn't place (X/Y/Z columns) or name the star of are looked up
  (`csv-route/locate.ts`): by the locators extensions add, and on EDSM when none answers; arrivals
  fill in `StarPos` too. That gives the side panel a scoopable answer for every stop, and the Route tab's Map page
  (`hud/RouteMap.tsx`, react-three-fiber; the pure part in `hud/route-map.ts`) its 3D route, the
  stretch flown in another colour. A Spansh `Refuel` of Yes counts as scoopable; No says nothing,
  as Spansh passes scoopable stars by.
- **`src/main/history-service.ts`** + **`src/main/history/`**: a second `JournalReader` with
  `backfill: 'all'` feeds `HistoryTracker`. It keeps a per-commander ledger (fines, vouchers,
  unsold cartographic and organic data, valued with EDDiscovery's formulas in `values.ts`) and a
  survey of the current system's bodies. It broadcasts a versioned `HistorySnapshot`, starting
  once the replay is done. The nav route service uses this reader too. `history/biology/predict.ts`
  predicts life from each body's `Scan` (atmosphere, gravity, temperature, volcanism, stars,
  galactic region, nebulae), following EDMC-BioScan. It gives every genus that could grow there
  before the body is mapped, and the likely species and colour of each named genus after.
  The rules, the region map and the nebula positions are `*.generated.ts` files, made from
  checkouts of Silarn's EDMC-BioScan and EDMC-ExploData by `python scripts/generate-bio-data.py`
  (run oxfmt on them after). Don't edit them by hand.
  The service also keeps the commander's personal bests (`src/main/records/personal-bests.ts`):
  the largest, hottest, closest binary… body of each class scanned, saved in `body_record`.
  Every start replays the whole history over the saved bests, writing what changed once the
  replay is done; only live scans are announced, and only for a class scanned a few times before.
  The survey's bodies carry the bests they hold, for the body panel.
- **`src/main/activity-service.ts`** + **`src/main/activity/`**: what the commander has done, for
  the assistant and the Mission tab's session strip. It rides the history reader: `ActivityTracker` turns each event worth
  talking about (jumps, scans, landings, samples, sales, spending, missions, fights, promotions)
  into one small record, and keeps active missions, ranks, the game's `Statistics` and spans of
  play. `summary.ts` adds a period's records up, folds them into a journey of stops and legs, and
  finds past visits. `search.ts` searches every record by kind, system, place, species,
  commodity, money source and free text over any range, for `search_activity`, answering in counts,
  totals and a few examples. `periods.ts` resolves "today", "yesterday", sessions and trips; a day runs
  from 06:00 local time, so late at night "today" is still the evening before.
  The record types and `tally()` (what a session or trip made, per hour, by source, less what
  went down with the ship) live in `src/shared/activity.ts`; the service broadcasts today's,
  this session's and this trip's tallies as `ActivityTallies`, and `get_activity_summary` reports
  the same numbers under `income`.
- **`src/main/upload-service.ts`** + **`src/main/uploads/`**: sends the journal to EDSM, Inara and
  EDDN so EDDI/EDMC needn't run. It follows the session reader. `game-state.ts` tracks who, where, which
  ship and which build. EDSM gets raw lines with its `_system…` fields (`edsm-journal.ts`). Inara
  gets its own events, translated by `inara-events.ts` following EDMC's plugin; it is left off the
  Settings tab (the file still takes its key) until Inara whitelists EDSSI, as it answers no other
  application. EDDN (`eddn.ts`,
  no key) gets one message per request on the schema for each event, built from each schema's
  allowed keys, checked against the location it tracks, and for station data read from the
  companion file the line announces; `EDSSI_EDDN_TEST` sends to the test schemas. `batcher.ts`
  batches, rate-limits and backs off per service. A per-service cursor in the database
  (`upload_cursor`) marks what was sent, so a restart resumes rather than resends. With no cursor,
  a service starts from "now". A service whose settings change is rebuilt and fed the session
  again. Betas, the legacy galaxy and multicrew are never sent. What a line becomes for each
  service is an `Encoder` (`edsmEncoder`, `inaraEncoder` in `uploads.ts`), shared with
  `backfill.ts`, which the send-session script uses to send past sessions up to the live cursor.
  Every request, live or backfilled, goes into `upload_log` (`log.ts`, `store/upload-log-store.ts`)
  with the events, systems and the service's answer; the Settings tab lists it.
- **`src/main/materials-service.ts`** + **`src/main/materials/`**: the Materials tab's data. It
  rides the history reader: `MaterialsTracker` counts each commander's ship materials (`Materials`
  at login and every change after), and reads cargo and the ship locker whole from their lines or
  companion files, whichever is newer. It keeps the last crafts (synthesis, engineering, broker,
  suit/weapon upgrades), folding repeats, matched to recipes by journal name and ingredients.
  Favourite recipes live in `recipe_favourite`, only the commander's own choices, so the defaults
  (`DEFAULT_FAVOURITE_RECIPES`) still apply. The recipes and material names are
  `src/shared/recipes.generated.ts`, made by `npm run gen:recipes` from EDDiscovery's tables at a
  pinned commit (`scripts/generate-recipe-data.ts`); don't edit it by hand. Each material carries
  its trader `family` (EDDiscovery's `MaterialGroupType`); `ENGINEERS` is every engineer's
  workshop (system, base, coordinates, how to unlock), and `MISFILED` in the generator corrects
  blueprints EDDiscovery lists under the wrong module. Every grade of a blueprint to-do is planned
  maxed from the engineer's rank (`plannedRolls`), as Inara plans it: five rolls at a grade the
  engineer ranks up on, as many as the grade once at rank 5; `targetRolls` overrides the target's.
  A to-do with no engineer chosen goes to an unlocked engineer before one still to unlock, then to
  the one offering the most of the list's other blueprints, so one visit does several, and only
  then to one ready for the grade, nearest first. The tracker also keeps how the commander
  stands with each engineer (`EngineerProgress`). The view is `src/renderer/src/materials/`, in
  pages: Recipes, Inventory (family × grade, as the game lays it out), Blueprints and Synthesis
  (to-do lists, kept in `crafting_todo` as JSON), Missing, Traders and History. The to-dos, what
  they hold back, the trader's rates, the trades that make up a shortfall from spare stock, and the
  trade plan making them all up together without spending a spare material twice (`planTrades`)
  are pure, in `src/shared/crafting.ts`; a live synthesis counts its to-do down (`recordSynthesis`),
  replayed ones don't. Blueprint rolls aren't tracked, as on Inara: a card says how many each
  grade takes and stays until crossed off. Traders are Spansh's `material_trader` stations (`materials/traders.ts`), measured
  from the commander's `StarPos` through `spansh/reference.ts`, as the Commodities search is.
  A build planned in EDSY or Coriolis is imported onto the blueprint list (`BuildImport.tsx`):
  `materials/build-text.ts` turns the paste (SLEF, a `Loadout`, Coriolis' detailed build, or an
  import link with a gzipped `Loadout`) into JSON, and `src/shared/build-import.ts` reads its
  engineered modules, names each module from its journal item, and plans the to-dos against the
  commander's own ship of that hull (each ship's last `Loadout`, kept by the tracker), one per
  blueprint and grade range with a `count` of modules.
- **`src/main/ships-service.ts`** + **`src/main/ships/`**: the Ships tab (`src/renderer/src/ships/`),
  every ship the commander owns slot by slot, the empty slots included. The journal only lists
  what is fitted, so each hull's slots come from EDSY's database (`eddb.js` in taleden/EDSY, CC
  BY-NC 4.0), fetched from GitHub by `catalog.ts` twice a day and cached as
  `<data dir>/edsy-catalog.json`; a new ship needs no release once EDSY has it. The file is a
  script, and `js-literal.ts` reads it as data (literals and arithmetic on numbers, nothing else),
  so nothing fetched is ever run. `edsy.ts` cuts it down to slots under the journal's names
  (EDSY's `slotnames` where a hull has them, the pattern of EDSY's own journal export otherwise),
  module and blueprint names. `ShipsTracker` rides the history reader: each ship's last `Loadout`,
  every slot ever seen filled on it, and where it's kept (`StoredShips`, swaps, transfers). For a
  hull EDSY lacks, `layout.ts` falls back to those seen slots; a module fitted where EDSY lists no
  slot is shown marked. A ship exports to EDSY and Coriolis as EDMC does (the `Loadout`,
  gzipped and base64'd into the import URL; `export.ts`), or to a CSV of its slots.
  EDSY also gives each hull's stock fit (the modules the shipyard sells it with) and prices: a
  ship still fitted as sold is tagged Stock, a ship the journal has no loadout for shows its stock
  fit, and the tab can show any hull as sold. Anything else that wants a ship it hasn't seen a
  loadout for asks `ShipsService.stockFit(ship)` (`hulls()` lists them) in main, or
  `window.edssi.ships.stockFit` in a window: a `StockFit` of `SlotView`s, the same shape the tab
  shows an owned ship's slots in.
- **`src/main/commodities-service.ts`** + **`src/main/commodities/`**: the Commodities tab
  (`src/renderer/src/commodities/`). A shopping list kept in `shopping_item`, whose bought counts
  go up on each live `MarketBuy` (session reader; the journal's `Type` named through `MATERIALS`,
  names compared without case or punctuation); a CSV of commodity and quantity imports over it or
  adds to it (`parseShoppingCsv`, `mergeShopping` in `src/shared/commodities.ts`), and so do
  screenshots of the colonisation panel, pasted, picked or dropped into a dialog
  (`ScreenshotImport.tsx`) and read by the assistant's model in one tool-less question
  (`commodities/screenshots.ts`, through the assistant service's `look`). Search asks
  Spansh's station search for markets stocking every commodity named (`market-search.ts`: each
  `marketplace` item is one commodity, and Spansh wants all of them; construction depots are left
  out by `type`). Sell is the same page (`MarketSearchView`, `side="sell"`) asking for markets
  with demand for every one, best sell price first (`sellBody`, `readSellStations`); each
  commodity carries its own tonnes (least supply, or what is to be sold). When no one market buys
  it all, Split plans the sale across several (`planSelling`, `planSales`): the purchase planner
  over buyers turned sellers (`asOffering`), its best-price plan the highest. The plan
  (`planner.ts`) searches each missing commodity nearest and cheapest, plus
  all of it at once, pools the stations (each row carries its whole market), and `planPurchases`
  (shared, pure) works out a few fewest-stops plans (greedy by tonnes covered, each starting at a
  different market) and one cheapest, each flown nearest-first. Minimising planetary markets
  searches orbital ones first, then planets only for what those don't stock enough of, and tops
  each orbital plan's shortfall up from them. "In this system" is looked up only when its button is
  pressed: Spansh's markets within 0.01 ly (it ignores a distance of 0) selling any list commodity,
  with the last market opened in the game (`Market.json`, kept after undocking) in place of
  Spansh's record of it. One plan can be pinned (`pinned_plan`, as JSON); each live `MarketBuy`
  counts against its purchases (`recordPlanPurchase`: that commodity at the stop with the same
  `MarketID` first, then the other stops in order), and what is bought is greyed out. The Plan
  page's unpinned results live in the window, so each purchase is also broadcast
  (`CommoditiesPurchase`) and counted against them there. Distances are from a named system
  (default Sol, 1,000 ly), or from the commander's `StarPos` for "here".
- **`src/main/carriers-service.ts`** + **`src/main/carriers/tracker.ts`**: the commander's own
  fleet carrier and their squadron's, listed after the ships on the Ships tab
  (`ships/CarrierDetail.tsx`) and read by the assistant's `get_carriers`. It rides the history
  reader. Where each is comes from `CarrierLocation` and the `CarrierJumpRequest` that leaves at its
  `DepartureTime` (a timer moves it live). The journal never lists a carrier's hold, so cargo is
  added up from `CargoTransfer` while docked on it and trades at its market, and checked against
  `CarrierStats`; the difference shows as unaccounted. Tritium is the last `CarrierStats` or
  deposit, less each jump since by `carrierJumpFuel` (`src/shared/carriers.ts`): round(5 +
  ly × (25,000 + space used + fuel) / 200,000), which fits every jump of a real journal to the
  tonne. Systems the journal never placed are asked of EDSM. A squadron carrier gets no fuel
  predictions, as the formula is unchecked for one. Upkeep (`upkeepForecast`, the costs in
  `CARRIER_SERVICES` and `CARRIER_BASE_UPKEEP`, from the wiki) is the base fee, each service
  running or suspended, and each jump since the last Thursday 07:00 UTC; the balance is the last
  reading less the Thursdays since, and it says how many weeks the balance pays and when it runs
  out. Tariff income isn't in the journal, so it isn't counted.
- **`src/main/carrier-alert-service.ts`** + **`src/main/carriers/`**: after each live `FSDJump`,
  asks Spansh for carriers open to all within `carrier_alert.jumps` of the ship's `MaxJumpRange`, reported in
  the last `max_age_days`, and tells the commander about each once (again if it moves) through
  the assistant's `notify`: spoken, or written in Comms when speech is off. It stays quiet while a
  non-carrier station with repairs is in range.
- **`src/main/carrier-webhook-service.ts`** + **`src/main/carriers/discord.ts`**: posts each live
  `CarrierJumpRequest` and `CarrierJumpCancelled` to a Discord webhook (`carrier_webhook`), in
  the SWS Carrier Tracker EDMC plugin's own embeds, word for word — keep them that way, so a
  channel reads the same whichever posted. The carrier's name and serial come from the settings,
  else that carrier's last `CarrierStats` on the history reader, else the plugin's defaults. The
  Settings tab's Uploads page has the plugin's test button (`CarrierWebhookPanel.tsx`).
- **`src/main/carrier-departure-service.ts`** + **`src/main/carriers/departure.ts`**: a minute
  before the commander's own carrier jumps (`CarrierJumpRequest`'s `DepartureTime`), says so
  through `notify` if they're docked on it (`voice.speech.carrier_departure_callouts`). Another
  owner's carrier gives its passengers no warning in the journal, so it has none here. It rides
  the session reader, replay included, so a jump requested before EDSSI started still counts.
  The scheduled jump is the overview's `carrierJump` (`dockedCarrierJump` when on board), which
  the side panel's Station block also counts down from.
- **`src/main/flight-alert-service.ts`** + **`src/main/flight/`**: warnings in flight, the same
  shape as the carrier alert and on the session reader. `FlightAlerts` warns when the main tank
  falls below `flight_alerts.low_fuel_fraction`, naming a scoopable star here, a few jumps along
  the route, or the nearest main star Spansh knows; when the next target's star isn't scoopable
  (`FSDTarget`'s `StarClass`, else EDSM); when a system targeted on the followed route starts a
  run of unscoopable stars the tank won't last through to the next scoopable one
  (`src/shared/jump-fuel.ts`: the FSD fuel formula, the drive from `Loadout` through
  `shipBuild`), said instead of the
  plain unscoopable warning and held back while scooping; and on approaching a body at or above
  `high_gravity_threshold` g, from the survey's scan. Each once per system or body; held back
  while docked, landed, in a taxi or multicrew, and looked at again on lifting off.
- **`src/main/update-service.ts`** + **`src/main/updates/`**: EDSSI updating itself, as OverLooker
  does (electron-updater, generic provider, the R2 bucket at `https://updates.edssi.app` from
  `publish` in `electron-builder.yml`). Only an installed build updates. It checks 10 s after
  starting and every 30 minutes and downloads in the background; a finished download leaves
  `pending-update.json` in the data folder. It never installs on quit: the next start installs it
  silently **before any service starts** (`installPendingUpdate`, first thing in `whenReady`), as the
  services start processes that would hold the install folder, and Settings → About can restart into
  it at once. The window gets an `UpdateState`; the title bar shows "Update ready". After an update
  the "What's new" dialog shows `CHANGELOG_USER.md` (an `extraResource`; parsed in
  `src/shared/updates.ts`) since the version last shown (`whats-new.json`). `updater.log` in the data
  folder says what it did. NSIS stays assisted, per-user and without a choice of folder: with
  `allowToChangeInstallationDirectory` a silent update doesn't start EDSSI again.
- **`src/main/startup/`**: "Start with the game" (`startup.with_game`). Turned on in an installed
  build, it writes `start-with-game.ps1` (inlined with `?raw`; keep it ASCII) into the data folder,
  adds it to Windows' startup apps through Electron's login items, and starts it. The hidden
  watcher (one per build, by mutex) looks for `EliteDangerous64` every 3 s and, as it starts and
  EDSSI isn't running, starts EDSSI with `--started-by-game`, which shows the window with
  `showInactive` (and holds off maximising, which activates). It also hands focus back to the game
  if an EDSSI window takes it in the first moments (an update installed on start restarts EDSSI
  without the flag). Turning it off removes the startup app and the script; the watcher ends once
  its file is gone. It logs to `start-with-game.log` beside it.
- **`src/main/edsm.ts`**: EDSM client (traffic, ship losses, stations, primary star), cached per
  system; windows ask via `window.edssi.edsm`.
- **`src/main/spansh/`**: Spansh, for the assistant (`toolsets/spansh.ts`). Searches of stations,
  systems and bodies measured from the commander's own `StarPos`, so they work where Inara and EDSM
  don't know the system, and all of Spansh's route plotters (queued jobs, polled). There is no
  documented API: `client.ts` does what the site's bundle does. `filters.ts` writes plain filters
  in each field type's shape, checking names against `searchable_fields` because Spansh ignores
  unknown ones. `src/shared/fsd.ts` works out the galaxy plotter's drive figures from the journal
  `Loadout`.
  `compact.ts` cuts each plotter's answer down to a summary and rows. `sell-stop.ts` is "find the
  next sell stop" (`find_next_sell_stop`): the nearest station, or carrier open to all and seen
  in the last 60 days, with Vista Genomics and a pad the ship fits, and while a route is set
  (plotted, else the CSV route) only one nearer its end than the commander. Spansh measures from
  one point, so it pages nearest-first and drops the stops behind itself.
- **`src/main/web/`**: the assistant on the web. `fetch.ts` reads a public page as markdown
  (never a local or private address, re-checked per redirect) for `toolsets/web.ts`; search is the
  provider's hosted `web_search`, switched by `assistant.web_search`.
- **`src/main/browser/`**: the browser the assistant drives, a `WebContentsView` on its own
  session laid over Comms' Browser page (`src/renderer/src/browser/`; it keeps its own `browser`
  tab id, so opening it opens Comms on that page), read through the DevTools
  protocol: `ax-tree.ts` folds the accessibility tree into an outline with refs, and
  `actions.ts` clicks, types and scrolls. What needs the commander's yes is decided in
  `ai/toolsets/browser-risk.ts`; tools ask through `askCommander` on their context, which the
  assistant service shows as a prompt and answers from a button or a "yes"/"no" reply. Tools
  that show the model an image return `ToolResultWithImages`. Plan, and what was learnt about capturing a
  hidden view, in `docs/web-and-browser.md`.
- **`src/main/edhm-service.ts`** + **`src/main/edhm/`**: the FSS Exobio Overlay, EDSSI's own EDHM
  mod (`resources/edhm/`, shipped as `extraResources`; its texture is drawn by
  `python scripts/generate-fss-exobio-overlay.py`). `game.ts` finds the game through EDHM-UI's
  `~/EDHM_UI/Settings.json`. The overlay draws through the FSS-Overlay mod's shaders, which EDHM's
  licence doesn't let EDSSI ship: `fss-overlay.ts` downloads that mod from EDHM's repository when
  they're missing, unpacks it switched off, moves any mod hooking the same shaders to
  `EDHM-ini/3rdPartyMods-disabled` (3Dmigoto loads everything in `3rdPartyMods`; there's no other
  switch), and copies ours in. The Settings tab has the button. `theme.ts` reads the applied
  theme (`EDHM-ini/ThemeSettings.json`) for its most used custom colour; while
  `display.match_hud_color` is on the window sets `--accent` from it (`useHudColor`, lightness
  kept readable by `shared/hud-color.ts`), and `--active`/`--inactive` are mixed from the accent.
- **`src/main/vr-overlay-service.ts`** + **`src/main/vr/`**: the VR cockpit, a prototype, off unless
  `vr.enabled`, and even then up only while SteamVR (`vrserver.exe`) and the game are both running:
  `vr/gate.ts` looks for them with `tasklist` every few seconds, and starts and stops the whole
  service with them. Its chatter (panels shown, overlays made, SteamVR with no headset) only prints
  with `EDSSI_VR_LOG=1` (`vr/log.ts`). Five panels — the Mission module ahead (or the VR version of the window's tab, where there
  is one: `VR_TABS` in `VrPanel.tsx`), the side panel and Comms to either
  hand, the route and the session's takings as strips above and below — each an offscreen window
  rendering the renderer's `#vr/<id>` route, each painted frame going to `tools/vr-overlay-host`, a
  small C# process that owns one SteamVR overlay per panel (openvr has no maintained Node binding,
  and a separate process keeps native code out of the asar). The set hangs as a rig: one anchor, the
  commander's eye point when it was last summoned, with every panel placed relative to it, so
  summoning brings the whole layout. `rig.ts` is the anchor and `panels.ts` each panel's place. The four
  outer panels are `attach`ed to the main one as though hinged along its edges: the sides take its
  height and the strips its width, each folds towards the commander about that seam, and only about
  the axis a hinge would allow — a side yaws, a strip pitches, neither rolls. Their places are
  worked out from the main panel rather than written down, so resizing or moving the middle carries
  the rest with it and the seams stay shut; a panel with no `attach` is free and can `aim` itself at
  the commander instead. `transform.ts` turns all of that into the
  3x4 matrices SteamVR wants — in TypeScript, so the geometry is unit tested rather than guessed at
  in a headset; the host only composes them with the anchor, levelling out the head tilt and hanging
  them in _seated_ tracking space so recentring carries it along with the game's own cockpit.
  `seams.ts` and `seamMatrix` hang a thin accent-coloured quad in each gap: a real
  overlay, placed at the midpoint of the gap and turned in place by half the fold so it splits the
  dihedral, carrying a texture of one flat colour made in the main process rather than rendered.
  They are sent with `gaze: false`, so a glance across a gap never becomes the panel the tuning
  keys act on, and each stops a `fade` short of the corners, where the backing beside it does. A panel's `background` is spent on whatever backing it has — a slab on the main and
  side panels, faded out over its last `fade` metres, and the cells themselves on the strips, which
  carry no slab. `panel.ts` works a frame's pixel size out from the panel's size in metres: SteamVR sets a quad's
  height from the texture's aspect ratio, so sizing in pixels would change the shape while leaving
  the panel the same size to look at. `protocol.ts` frames what goes down the pipe — each message naming its
  panel — and one state message describing the whole rig. A panel's frame is normally just a
  handle: the windows paint with `useSharedTexture`, so the pixels stay on the GPU and
  `SharedTextures.cs` in the host duplicates the NT handle out of EDSSI's process, opens it, and
  copies it into a texture of the host's own, which is submitted **by its shared handle** as a
  `DXGISharedHandle`. Both halves of that matter: the copy is what orders Chromium's drawing
  against SteamVR's reading, since a `bgra` shared texture has no keyed mutex, and the handle is
  what lets `vrcompositor.exe` read the surface itself — handed an `ID3D11Texture2D` instead it
  copies from our device on its own schedule, and every panel shows the frame before the one it
  was given. `docs/vr.md` has the whole of it. Sending the pixels instead (`SetOverlayRaw`) rebuilds the overlay's texture
  on every frame, which made the cockpit blink whenever a panel's content changed; it remains as
  the fallback when a host cannot open a handle, and is how the seam lines are sent, since one
  flat colour is sent once and never again. A shared texture belongs to Chromium, so EDSSI holds
  each one until the host says it has taken it. The host says which panel is being looked at, and
  that is what the tuning keys act on; moving and turning act on the rig until `toggleScope`
  switches them to that panel, while size and appearance always act on it. `layout.ts` holds the
  named commands and keeps the lot in `~/.edssi/vr-overlay.json` — the file is the only way to
  rebind a _key_, since the commander is wearing a headset and no two keyboards agree on which keys
  exist. Scrolling glides rather than steps: `scroll.ts` is the physics of it (a notch per tap, a
  speed per how hard the control is held, easing in and out), stepped at 60 fps into precise wheel
  events while the scrolled panel paints at 60 fps too; an input action can ask for its own repeat
  timing and to be told on `release` for this. Stick buttons are the other way round: a control has no name to write down, so they are
  bound by pressing them on the Settings tab's VR page, which writes `vr.bindings` in the settings
  file (the command names are `src/shared/vr.ts`, which `layout.ts` re-exports). The service merges
  both files into one set of `input.actions`, and rebinds when either changes; `scrollUp`/
  `scrollDown` repeat while held and scroll faster the further a ministick is pushed.
  It overrides the defaults rather than replacing them: every command the file doesn't bind gets its
  default key, and only what the commander has actually changed is written back, or the file would
  freeze every default the day it was written. It is polled the way `config.yaml` is, so editing it
  by hand takes effect within a second — panels open, close and resize, the rig goes to the host and
  the keys are bound afresh; a read that comes back half-written is ignored rather than taken for an
  empty cockpit. The defaults use
  the arrow cluster and punctuation, never the keypad, and never `Control+Alt+Arrow` (Intel graphics
  rotates the desktop on that). A panel goes up only once the host holds a texture for it, and no
  frames are sent while the cockpit is down. The host is told EDSSI's pid and exits when that
  process goes: closing stdin is the tidy wind-down, but a killed EDSSI closes nothing, and a host
  left holding its overlay keys makes the next one fail with `KeyInUse` and show a cockpit from a
  build that no longer exists. Build the host with `npm run vr:build`. How to run it, the keys and what to
  know before changing it are in `docs/vr.md`, and what is still unfinished is in
  `docs/vr-handoff.md`. `npm run vr:shots` photographs the five panels from a
  real EDSSI — the commander's own layout and journals, its own scratch config and database, and
  SteamVR untouched — and `npm run vr:preview` draws the cockpit from the same matrices the overlays
  use, so the layout and the panels' contents can both be looked at without a headset.
- **`src/main/extensions.ts`** + **`src/renderer/src/extensions.ts`**: features built in from
  outside this repository, each a folder in `extensions/` (git-ignored), found with
  `import.meta.glob`, so a build without one has none of it. An extension adds its own settings
  sections, Route tab pages, assistant toolsets, system locators and IPC (`ext:` channels), and
  main-process entries through its `build.json`. The public code never names one: a new extension
  point is named for what it offers. `npm run build:extension -- <name> --install` builds one on
  its own into `<config dir>/extensions/<name>/`, which any build loads at start
  (`src/main/installed-extensions.ts`, `src/shared/extensions.ts`): EDSSI's code it imports is
  bundled in, but React and zod are the running EDSSI's (stand-ins for `globalThis`), native
  modules come from EDSSI's folder (`EDSSI_APP_PATH`), and the window loads it over `edssi-ext://`
  before importing the app. `EXTENSION_API_VERSION` gates it. How it fits together is in
  `docs/extensions.md`; an extension's own notes live in its folder.
- **`src/main/config/`** — `~/.edssi/config.yaml` (override the folder with `EDSSI_CONFIG_DIR`):
  API keys, the model, voice settings and the push-to-talk bindings. The zod schema lives in
  `src/shared/settings.ts` (the renderer needs it for the Settings tab), where every field has a
  default and null means "not set", so a partial or missing file still runs; a broken one keeps the
  last good settings and reports the problem. `store.ts` polls the file and applies saves live.
  `save.ts` writes back through `yaml`'s document API, so the commander's own comments and layout
  survive a save from the screen. `settings-service.ts` serves and saves it over IPC; the file
  stays the source of truth, and a save is read straight back rather than held in memory.
- **`src/main/window-bounds.ts`** — where the window was last put, in
  `~/.edssi/window-bounds.json`. Ported from OverLooker: the geometry is kept pure and unit
  tested, so only `index.ts` touches Electron's `screen`. A saved position is re-checked against
  the displays that are actually connected before it is used, and a window whose monitor is gone
  falls back to the default size rather than opening off-screen.
- **`src/main/view-options-service.ts`** — how the views are shown (a list's sort, what it leaves
  out), listed in `src/shared/view-options.ts` and kept in `~/.edssi/view-options.json` (only what
  differs from the defaults), not `config.yaml`, since they change with every click. They live in
  the main process so every window — the VR panels are windows of their own — shows the same, and
  the assistant's `set_view_options` (its arguments built from the list) can change them. A view
  reads one with `useViewOption` (`hud/useViewOption.ts`) in place of `useState`; a new option is
  one entry in the list.
- **`src/main/ai/`** — the assistant. `service.ts` wires it up: settings, the provider,
  transcription in, speech out, and the IPC. Push-to-talk itself lives in `src/main/input/`, which
  starts first and hands it a `start`/`stop`. `assistant.ts` is the conversation and the tool loop, with no knowledge
  of Electron, so it is tested with a scripted provider. `model/` holds the two providers, which
  both speak the Responses API: an API key, or a ChatGPT sign-in against the Codex backend
  (`model/chatgpt-auth.ts` does the OAuth, keeping its tokens out of the Codex CLI's own file).
  `speech.ts` picks the voice (`voice.speech.provider`, Kokoro unless told otherwise):
  Inworld's (`inworld.ts`, a raw-HTTP stream of base64 PCM), or Kokoro-82M on the CPU
  (`kokoro/`). **onnxruntime never runs in the main process**: it holds a process-wide lock while
  it loads and runs a model, which froze every window for a second or more per sentence, so the
  model lives in Kokoro's own `utilityProcess` (`kokoro/worker.ts`, built as `kokoro-worker.js`
  beside `index.js`), and main talks to it through `kokoro/client.ts` (`protocol.ts`: speak,
  cancel and state by message; audio back per request id). If the worker dies the voice reports
  it, with no fallback to main. The engine (`kokoro.ts`) runs onnxruntime-node on 4 threads, one
  sentence per run, the fp32 model downloaded into the data folder on first use at a pinned
  revision and checked by SHA-256, each voice file likewise. `kokoro/text.ts` is kokoro-js's
  text-to-phonemes ported as it is (eSpeak NG through the bundled `phonemizer` package), so the
  phonemes match the model's training. onnxruntime-node is native, so it is externalized and
  unpacked like the input modules. The Settings tab's Speaking section can play a line in whichever voice it picks (Kokoro, Inworld or Wyoming) before it is saved (`VoiceTestPanel.tsx`, `assistant.previewVoice`, checked by `ai/preview.ts`). A Wyoming server (`wyoming.ts`, Home Assistant's protocol: a
  JSON header line, then data and payload, one TCP connection per request) can speak too, at its
  own sample rate, which rides on each `SpeechChunk` as `rate` for the window to resample from.
  Listening (`voice.transcription.provider`, `createTranscriber`) is OpenAI, whisper.cpp on this
  machine (`whisper/`: its OpenBLAS Windows build and a ggml model, downloaded into the data
  folder at pinned versions and checked by SHA-256, and its `whisper-server` kept running on a
  free port of 127.0.0.1 with the model loaded; it takes the same prompt and name hints OpenAI
  does), or a Wyoming server. The local two want samples, so for them the window decodes its Opus
  recording to 16 kHz WAV first (`comms/to-wav.ts`, as `setup.voiceInputFormat` says). Kokoro's
  and Whisper's setups report through `setup.voiceNote`, shown in Comms. Speech is
  generated faster than it is spoken, so the `speaking` phase ends only once the window playing it
  says the sound has stopped (`assistant.playback`), not when the last words were sent.
  `tools/` is the framework — `defineTool` with a zod schema, and a registry that validates
  arguments and caps results — and `toolsets/` is one file per area of the app, each with its
  tools, its section of the instructions, and the live state it puts in front of every question.
  A new area is a new file there plus a line in `toolsets/index.ts`.
- **`src/main/input/`** — push-to-talk, and every other global binding. Electron's `globalShortcut` only fires on key-down, so it
  can't hold a microphone open; `keyboard.ts` uses `uiohook-napi`'s low-level hook instead, which
  reports both edges while the game has focus, and translates Electron accelerators to and from
  its key codes (the code table is copied, not imported, so nothing loads the native module just to
  read a settings file). `joystick.ts` reads sticks over raw HID with `node-hid` — Chromium's
  Gamepad API is no use, as it only feeds a _focused_ document. A binding is learnt by moving the
  control: `native/hid-usages` (a small N-API addon over Windows' `HidP_*`) says what a device's
  controls are, `usages.ts` decodes a report into named values and buttons, and `pressedControls`
  answers what is held that wasn't when the capture began — so a button, a hat direction and a
  ministick all bind the same way, and an axis's real range is known before it has been moved.
  `buttons.ts` is the fallback for a device that addon can't describe: it learns a button by which
  bit turned on, after writing off the bytes that move on their own as axes, and knows nothing of
  hats or axes. A device's decoded state is kept **per report id**, because `HidP_GetUsages`
  answers per report id: a stick that sends more than one kind (the VKB EVO L sends 1 and 12) has
  every other report say "nothing is down" about the buttons in the first, and held in one state
  that turned one press into two. A report that decodes to nothing at all is ignored for the same
  reason. `service.ts` resolves every push-to-talk binding into one `start`/`stop`, with a
  short grace period so a chattering button doesn't cut a question in half, and `actions()` watches
  named actions for everything else — the VR cockpit's commands, and `input.paste` (`paste.ts`),
  which presses Ctrl+V in the game, for the next route system under a thumb. Keys are sent with
  `SendInput` by scan code (`send-keys.ts`, koffi): the game ignores `uiohook-napi`'s `keyTap`,
  which sends virtual keys with no scan code. An action takes any
  number of bindings, each with `clicks` (one, two or three presses; `clicks.ts` counts them per
  _control_, so only a control that actually has a double bound is ever delayed) and `repeat`
  (fire again while held), and is told how hard the control is being held so a ministick can scroll
  faster the further it is pushed. The window is `input.multi_click_ms`. Click counters live by
  control rather than with the bindings, so a rebind — which is what any settings save is — doesn't
  throw away a tap that is still being counted, and a press within `BOUNCE_MS` of its own release
  is that press bouncing. `EDSSI_INPUT_LOG=1` prints every edge and every action run, which is how
  all of that was settled; `npm run hid -- --presses` says the same from outside EDSSI. Both native modules are optional at runtime: if one won't load,
  what it cost is reported and the rest still works. They are also the only runtime dependencies —
  native code can't be bundled, so `electron.vite.config.ts` externalizes them and
  `electron-builder.yml` unpacks them from the asar.
- **`src/renderer/src/settings/`** — the Settings tab: the whole settings file as a form, driven by
  the pages, sections and fields in `fields.ts` (each field can say when it applies, check its
  value, and each section can warn about a setup that won't work), plus the push-to-talk, EDHM and
  upload log panels, and the VR page's stick bindings (`VrBindingsPanel.tsx`, writing
  `vr.bindings`). Edits are a draft until saved (Ctrl+S); a field's Default button clears it
  from the file, though the binding panels write straight through. A binding is always bound by
  pressing it, never typed — a control has no name to type — and lights up while it is held, which
  is how you know you bound the one you meant. The first page, and the one a fresh install opens on,
  is Quickstart: a `guide` page of numbered steps (assistant, hearing, speaking, VR), each the few
  fields it can't work without, borrowed from their own pages with `reuse` (so they can't drift;
  search and `locate` skip the guide), a line on how it stands (`quickstart.ts`, from the saved
  settings and the assistant's setup) and a link to the rest of its settings.
- **`src/preload/`** — exposes `window.edssi` (typed by `EdssiApi` in `src/shared/api.ts`). The
  window is sandboxed, so the preload must be built as CJS (`index.cjs`, see
  `electron.vite.config.ts`).
- **`src/renderer/src/api/`** — how the window reaches the main process: `useEdssi()`, from the
  `EdssiProvider` that `main.tsx` puts round the app with `window.edssi`. Nothing else reads
  `window.edssi` (a test checks), so a page can hold several EDSSIs, each with an API of its own.
  State a window's components share lives on the provider too (`viewOptions`, `settingsRequests`),
  never in a module's `let`, and so does where the document is: `themeRoot()` for the HUD colour,
  `useOpenDialog()` (modal in the app, not embedded). Popups place themselves with `popupPlace`, and
  lists scroll with `scrollNearest`/`scrollWithin`, never `scrollIntoView`, which scrolls the page.
- **`src/mock/`**: the mock UI, the app's own windows against made-up data, for embedding in other
  pages, many to a page (`<MockApp scenario tab />`), each in a shadow root with its own React
  root so no page's styles reach it. `MockEdssi` implements `EdssiApi` from a
  `MockScenario`: reads answer from it, a visitor's changes (favourites, to-dos, a sort) stay in
  that instance, and what needs the game or the network says it is a demo. The demo scenario
  (`fixtures/demo.json`) is made by `npm run mock:scenario`: `scripts/mock/demo-journal.ts` writes
  the journal of a made-up trip (its life predicted by `predict.ts`, its ships from EDSY), and
  `scripts/mock/run-services.ts` runs the real services over it under jiti with `electron`
  aliased to a stub, saving what they'd send a window. Its builds scope the app's stylesheets to
  `.edssi-theme` and refuse anything from `extensions/` (`scripts/mock/vite-plugins.ts`). How to
  embed it, and the rules that keep new renderer code mockable, are in `src/mock/README.md`.
- **`src/renderer/src/journal/`** — `state.ts` is the sync reducer: it subscribes first, queues
  messages until the snapshot arrives, then skips messages with `seq` ≤ the snapshot's. Its session
  reset mirrors the main process's rule. `summaries.ts` maps event names to categories (ordered
  regex rules, first match wins) and one-line summaries; `format.ts` turns field names and values
  into labels with units. `grouping.ts` folds runs of related visible entries (a hyperspace jump,
  entering supercruise, one system's scans, fuel scoops) into one expandable row. Background noise
  between members never breaks a group. A group's key is its oldest entry's id, so it stays stable
  as live events join.
- **`src/renderer/src/hud/`**: the Elite HUD layout. The side panel shows the current and next
  system, the fuel (with what the next jump and the rest of the followed route will burn:
  `routeFuel` in `src/shared/jump-fuel.ts`, on the overview's `drive`), and the ledger. While
  `Status.json` flag 21 (near a surface) is set, a section for that body (`BodyPanel.tsx`) sits
  between them. Also the Route module, and the shared tables, tabs and masked SVG icons.
  An input with suggestions is `Suggest.tsx`, never a `<datalist>` (whose popup is the system's);
  checkboxes are styled once, in `hud.css`.
- **`src/renderer/src/mission/`**: the Mission tab, the default one. It shows the route as here,
  next and final; the bodies in this system with life, species by species or as a price range
  per genus, with the predicted species and, for unmapped bodies, what the unnamed signals could
  pay and what mapping the body would add when it clears the probe cutoff; the bodies worth a probe run (`probeTargets`: terraformable, water, ammonia and Earth-like
  worlds worth at least `mission.min_probe_value` once mapped, with what mapping adds from the
  tracker's `mappingValue`); and the samples since the last Vista Genomics sale, split into stops with the jumps
  between them. The tracker supplies the log (`HistorySnapshot.exobiology`), a jump count, "new
  species" flags and each ledger total's share from this game session. The pure folding lives in
  `src/shared/mission.ts`, so the assistant's `get_biology_here` and `get_exobiology_log` read it
  the same way; `mission.ts` here only adds the formatting.
- **`src/renderer/src/comms/`**: the Comms tab. The microphone lives here (the main process can't
  reach one without a native module): `recorder.ts` records Opus, `speech.ts` plays the answer's
  PCM as it streams in, and `useVoice.ts` ties both to the push-to-talk key.
- **`src/shared/`** — types and constants used by both sides. `overview.ts` folds the session's
  events into who and where the commander is, for the HUD and the assistant alike. `journal.ts` defines
  `JournalEventName` / `JournalEvent`, `COMPANION_NAMES`, and the IPC message/snapshot shapes.

### Journal event types

`src/shared/journal-events.generated.ts` is generated by `scripts/generate-journal-types.ts` from the
community schemas at `jixxed/ed-journal-schemas`, pinned by `SCHEMA_COMMIT`. Don't edit it by hand;
bump the commit and run `npm run gen:journal-types` after a game update.

Payloads are typed but **not validated at runtime**. Keep that in mind:

- Code that reads event fields must tolerate surprise shapes (e.g. `summarize()` catches throws).
- Casts from parsed JSON are allowed with a `typescript/no-unsafe-type-assertion` disable comment
  that explains why.
- `SystemAddress` and `MissionID` are typed `number | bigint`. `parse.ts` turns unsafe integers into
  `bigint`, so anything that serializes events (e.g. `JSON.stringify`) must handle bigints.

## Conventions

- oxfmt: 100-column lines, single quotes, sorted imports, LF line endings (enforced by
  `.gitattributes`).
- Tests are colocated as `*.test.ts` next to the code they cover.
- Styles: `src/renderer/src/hud.css` holds the design system (tokens mixed from one `--accent`,
  type, and the shared parts: tabs, sections, panels, tables, buttons, inputs, tags, pips, bars);
  each module has its own stylesheet beside it (`mission/mission.css`…), pulled in by
  `styles.css`, which keeps only the VR panel and dialog rules. Sizes are in px, for a 1446 px
  window; the VR panels scale them by `--vr-zoom`. The approved mockups are the "Approved" page of
  the design canvas (see the project memory). Keep the text greys' contrast floors: nothing to be
  read below `--dim` or 13 px.
