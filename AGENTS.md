# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

EDSSI (Elite Dangerous Smart Support Interface) is an Electron + React desktop app that follows the
Elite Dangerous player journal live and presents the current game session. Windows is the target
platform.

## Commands

- `npm run dev` — run the app with the electron-vite dev server (renderer hot reload).
- `npm run check` — typecheck + lint + format check + tests; run before calling work done.
- `npm test` — all tests (Vitest). Single file: `npx vitest run src/main/journal/reader.test.ts`;
  single test: add `-t "<test name>"`.
- `npm run typecheck` (`tsc -b`, TypeScript 7), `npm run lint` / `lint:fix` (oxlint, type-aware),
  `npm run format` / `format:check` (oxfmt — not Prettier/ESLint).
- `npm run dist:win` — build and package the NSIS installer into `dist/`.
- `npm run gen:journal-types` — regenerate event types (see below).

To point the app at a test journal folder, set `EDSSI_JOURNAL_DIR`. To keep its records out of
your real database, also set `EDSSI_DATA_DIR`.

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
- **`src/main/history-service.ts`** + **`src/main/history/`**: a second `JournalReader` with
  `backfill: 'all'` feeds `HistoryTracker`. It keeps a per-commander ledger (fines, vouchers,
  unsold cartographic and organic data, valued with EDDiscovery's formulas in `values.ts`) and a
  survey of the current system's bodies. It broadcasts a versioned `HistorySnapshot`, starting
  once the replay is done. The nav route service uses this reader too.
- **`src/main/edsm.ts`**: EDSM client (traffic, ship losses, stations, primary star), cached per
  system; windows ask via `window.edssi.edsm`.
- **`src/main/config/`** — `~/.edssi/config.yaml` (override the folder with `EDSSI_CONFIG_DIR`):
  API keys, the model, and voice settings. `schema.ts` is the zod schema, where every field has a
  default and null means "not set", so a partial or missing file still runs; a broken one keeps the
  last good settings and reports the problem. `store.ts` polls the file and applies saves live.
- **`src/main/ai/`** — the assistant. `service.ts` wires it up: settings, the provider, the
  push-to-talk key (`globalShortcut`, so it works while the game has focus), transcription in,
  speech out, and the IPC. `assistant.ts` is the conversation and the tool loop, with no knowledge
  of Electron, so it is tested with a scripted provider. `model/` holds the two providers, which
  both speak the Responses API: an API key, or a ChatGPT sign-in against the Codex backend
  (`model/chatgpt-auth.ts` does the OAuth, keeping its tokens out of the Codex CLI's own file).
  `tools/` is the framework — `defineTool` with a zod schema, and a registry that validates
  arguments and caps results — and `toolsets/` is one file per area of the app, each with its
  tools, its section of the instructions, and the live state it puts in front of every question.
  A new area is a new file there plus a line in `toolsets/index.ts`.
- **`src/preload/`** — exposes `window.edssi` (typed by `EdssiApi` in `src/shared/api.ts`). The
  window is sandboxed, so the preload must be built as CJS (`index.cjs`, see
  `electron.vite.config.ts`).
- **`src/renderer/src/journal/`** — `state.ts` is the sync reducer: it subscribes first, queues
  messages until the snapshot arrives, then skips messages with `seq` ≤ the snapshot's. Its session
  reset mirrors the main process's rule. `summaries.ts` maps event names to categories (ordered
  regex rules, first match wins) and one-line summaries; `format.ts` turns field names and values
  into labels with units. `grouping.ts` folds runs of related visible entries (a hyperspace jump,
  entering supercruise, one system's scans, fuel scoops) into one expandable row. Background noise
  between members never breaks a group. A group's key is its oldest entry's id, so it stays stable
  as live events join.
- **`src/renderer/src/hud/`**: the Elite HUD layout. The side panel shows the current and next
  system, and the ledger. It swaps in the explorer panel when `Status.json` flag 21 (near a
  surface) is set. Also the Route module, and the shared tables, tabs and masked SVG icons.
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
- Anything that relies on game behaviour or UI that couldn't be checked against real journals or
  a running app goes into `docs/unverified.md`, with how to check it.
