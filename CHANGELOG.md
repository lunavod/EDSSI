# Changelog

What changed in each release, in technical detail. The notes EDSSI shows commanders after an
update are CHANGELOG_USER.md.

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
