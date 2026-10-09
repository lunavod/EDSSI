# EDSSI

**Elite Dangerous Smart Support Interface**: a companion for Elite Dangerous on Windows. It follows
the game's journal while you play and keeps the session in front of you: where you are, where
you're heading, what's worth scanning, what your data is worth, and an assistant you can ask about
any of it, by voice, without leaving the cockpit.

## Download

Get the installer from the [latest release](https://github.com/lunavod/EDSSI/releases/latest) and
run it. EDSSI keeps itself up to date: new versions download in the background and install the
next time it starts.

It needs Windows 10 or 11 and Elite Dangerous (Odyssey or Horizons). It finds the game's journal
by itself.

## What it does

- **The HUD.** The current and next system, the star and whether it can be scooped, fuel with what
  the next jump and the rest of the route will burn, and a ledger of unsold cartographic and
  exobiology data, bounties and fines. Near a planet, that body's details.
- **Mission tab.** The route as here, next and final; the bodies in the system with life, with the
  species likely to grow there (from the planet's atmosphere, gravity, temperature and stars) and
  what each could pay; the bodies worth a probe; and the samples taken since you last sold.
- **An assistant.** Ask about your trip, your ship, your carrier or the galaxy, by push-to-talk or
  typed in Comms. It knows your session and your history, searches Spansh for stations, systems
  and bodies, plots routes with every Spansh plotter, reads the web, and can drive a browser for
  you. It answers aloud and calls out what matters as it happens: new species, bodies worth a
  probe, personal bests, low fuel.
- **Routes.** Every route you plot, and routes loaded from a Spansh CSV: after each jump the next
  system goes on the clipboard (or is pasted into the galaxy map from a stick button), with a 3D
  map of the trip. Routes can be saved and picked up where you left them.
- **Materials.** Your materials as the game lays them out, engineering and synthesis to-do lists,
  what they're short of, the trades that make it up, and the nearest material traders. Paste a
  build from EDSY or Coriolis and it plans the blueprints.
- **Commodities.** A shopping list (typed, from a CSV, or read off screenshots of the colonisation
  panel), market searches through Spansh, and plans that buy it all in the fewest stops or the
  cheapest, ticked off as you buy.
- **Ships and carriers.** Every ship you own, slot by slot (empty ones too), with export to EDSY,
  Coriolis or CSV. Your fleet carrier's position, cargo, tritium and upkeep, and Discord posts for
  its jumps.
- **Warnings in flight.** Low fuel, with the nearest scoopable star; an unscoopable star ahead, or
  a run of them the tank won't last through; high-gravity planets; and, when no station with
  repairs is in reach, the fleet carriers that have them.
- **Uploads.** Sends your journal to EDSM, Inara and EDDN as it is written, so you don't need EDMC
  or EDDI running for that.
- **EDHM.** One button installs an overlay that marks the FSS bands where life can be found, and
  EDSSI can take its colour from your EDHM theme.
- **VR (prototype).** EDSSI's panels hung around you as SteamVR overlays, moved and scrolled from
  your stick.

## Getting started

The first time it opens, EDSSI shows **Settings → Quickstart**: a few steps that set up the
assistant, how it hears you and how it speaks. Everything else has sensible defaults and can be
left alone.

- **The assistant** needs either an OpenAI API key (billed per request) or a ChatGPT plan you sign
  in with.
- **Hearing you**: OpenAI's transcription, or whisper.cpp running on your own machine (downloaded
  on first use), or a Wyoming server.
- **Speaking**: Inworld (with a key), Kokoro running on your own machine (downloaded on first use),
  or a Wyoming server. Or turn speech off and read the answers in Comms.
- **Push-to-talk** binds to any key or stick button: press it in Settings to bind it.

Settings live in `%USERPROFILE%\.edssi\config.yaml`, which you can also edit by hand; EDSSI picks up
changes as you save. Its own records (routes, lists, personal bests) are in
`%APPDATA%\EDSSI\edssi.db`.

## What leaves your machine

- **EDDN** gets what any player could see (systems, bodies, stations, markets) from your journal,
  from the moment EDSSI first runs. Your commander name is hashed. Turn it off under Settings →
  Uploads.
- **EDSM and Inara** get your journal only once you've entered their API keys.
- **The assistant** sends your questions, and the parts of your game state that answer them, to
  OpenAI (or ChatGPT). Nothing is sent while it isn't being asked.
- **Lookups**: EDSM and Spansh are asked about systems, stations and routes; EDSY's ship data comes
  from GitHub; the local voice and transcription models download from Hugging Face and GitHub the
  first time they're used; updates come from `updates.edssi.app`.

## Building from source

You'll need Windows and Node.js 22 or later.

```bash
npm install
npm run dev
```

- `npm run check` runs the typecheck, lint, format check and tests.
- `npm run dist:win` builds an (unsigned) installer into `dist/`.
- `npm run hid:build` builds the stick addon (needs the Visual Studio C++ build tools), and
  `npm run vr:build` the VR overlay host (needs the .NET SDK). Both are optional.

`EDSSI_JOURNAL_DIR`, `EDSSI_DATA_DIR` and `EDSSI_CONFIG_DIR` point a development copy at a test
journal folder, a scratch database and a scratch settings file. `CLAUDE.md` describes how the code
fits together, and `docs/releasing.md` how releases and updates work.

## Credits

EDSSI stands on the community's work: the journal schemas from
[jixxed/ed-journal-schemas](https://github.com/jixxed/ed-journal-schemas), recipes and materials
from [EDDiscovery](https://github.com/EDDiscovery/EDDiscovery), life prediction from Silarn's
[EDMC-BioScan](https://github.com/Silarn/EDMC-BioScan) and
[EDMC-ExploData](https://github.com/Silarn/EDMC-ExploData), ship data from
[EDSY](https://github.com/taleden/EDSY), uploads modelled on
[EDMC](https://github.com/EDCD/EDMarketConnector), and search and routing from
[Spansh](https://spansh.co.uk), [EDSM](https://www.edsm.net) and [Inara](https://inara.cz).

Elite Dangerous is a trademark of Frontier Developments plc. EDSSI is not affiliated with or
endorsed by Frontier.
