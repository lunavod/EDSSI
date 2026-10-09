# Changelog

What changed in each release, in technical detail. The notes EDSSI shows commanders after an
update are CHANGELOG_USER.md.

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
