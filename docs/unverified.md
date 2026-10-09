# Unverified assumptions

Everything EDSSI relies on that hasn't been checked against the real game or a running app yet.
Each item says what is assumed, why it isn't verified, and how to check it. Remove an item once it
is verified (or fix the code if it turns out wrong). Add new ones as features land.

Most checks need real journals. Replaying a copy of a session into a scratch folder works well:
`EDSSI_JOURNAL_DIR=<folder> EDSSI_DATA_DIR=<scratch> npm run dev`.

## CSV routes

- **Copying while the game has focus.** Loading a route and a jump along it were driven on a
  synthetic journal in a scratch EDSSI, and the next system did reach the Windows clipboard; it
  was never tried with the game in front, nor pasted into the galaxy map's search.
  _Check:_ load a Spansh CSV, jump to the next system on it, and paste into the galaxy map search.
- **Paste from the stick (`input.paste`).** A bound control presses Ctrl+V with `SendInput` by
  scan code (`send-keys.ts`), holding it 40 ms. The first version used `uiohook-napi`'s `keyTap`,
  which sends virtual keys with no scan code, and the game ignored it. Windows was seen to accept
  the scan-code input, but the paste landing in the galaxy map's search was never watched.
  _Check:_ bind a stick button under Settings → Routes → Paste, open the galaxy map's search in
  the game with a system on the clipboard, and press it.
- **Dropping a file from Explorer.** Only the Load button's path was tried; the drop handler reads
  the file with `File.text()` in the sandboxed window, which should work but wasn't exercised.
  _Check:_ drag a CSV from Explorer onto the CSV route page.
- **Other Spansh plotters.** Only the exact plotter's export was loaded. The neutron, Road to
  Riches, fleet carrier and exobiology plotters are assumed to name their system column `System
Name`, and a system listed once per body is folded into one stop.
  _Check:_ export a route from each and load it.
- **Distances when it stands in for a plotted route.** With no route plotted and the commander in
  one of its systems, the Mission tab and the side panel show the CSV route (`followed-route.ts`).
  Each jump's length is taken from the drop in `Distance Remaining` between rows, else a column
  named exactly `Distance`, assumed to be the galaxy plotter's jump length; `Distance To Arrival`
  is never used, as in Road to Riches it is in-system. Only a synthetic CSV was tried.
  _Check:_ fly a Spansh route unplotted and compare the Mission tab's "ly left" and "Next" with
  the CSV page.
- **A plot that is a stretch of it.** A plotted route whose last system is a later CSV system,
  starting from a CSV system or the last one reached, is taken for part of the CSV route
  (`plottedAlongCsv`): the Mission tab and side panel show the CSV route instead, and the spoken
  EDSM line about the plot is skipped. Names are matched ignoring case, assuming `NavRoute.json`
  spells systems as Spansh does. Only tested on synthetic routes; between a neutron route's
  waypoints the "Next" shown is the next CSV system, not the plot's next jump.
  _Check:_ load a Spansh route, paste the copied system into the galaxy map and plot to it; the
  Mission tab should still say "CSV route" and nothing should be spoken about the plot.

- **The Map page.** Drawn with react-three-fiber (only while shown, and only when something
  moves). It was looked at on a real 330-stop route and a route beside it to compare in a scratch EDSSI, through
  DevTools screenshots: labels, colours, Fit, From above and the layer toggles. Dragging, zooming,
  hovering a stop and clicking to copy its name were never done with a real mouse.
  _Check:_ open Route → Map, orbit and zoom with the mouse, hover a dot and click it, then paste.
- **Refuel as scoopable.** A Spansh `Refuel` of Yes is taken for a scoopable star when nothing
  better says (the star's class from the file or a lookup comes first, then EDSM). A real export
  refuelled at most scoopable stars but not all (a G star said No), so No is read as nothing.
  _Check:_ fly a Spansh route unplotted with no extension looking stars up and compare the side panel's
  "Scoopable" with the star in the game.
- **The Inject column.** A route's `Inject` column (Spansh's says Yes where to synthesize an FSD
  injection for the next jump; a grade, such as Basic, is shown as written) is drawn as a tag, and
  left out when every row says No. Only checked in tests, never drawn in the running app, and no
  real Spansh export with an injection was looked at. _Check:_ load a route whose Inject column
  has a Yes and look at the CSV route page.
- **The Mine Tritium column.** A carrier route's `Mine Tritium` column (tonnes at a stop the
  tritium runs out at, empty elsewhere) is drawn as a red "Mine 921 t" tag. Never seen drawn in
  the running app. _Check:_ load a CSV with a `Mine Tritium` column holding a number on one row
  and look at the CSV route page.

## Extensions

A build with an extension and one without were both made with `electron-vite build` and run from
scratch folders: the extension's Route tab page, Settings section, IPC and extra main entries all
worked, and the build without it had none of them. The rest wasn't run:

- **`npm run dev` with an extension.** The renderer's `import.meta.glob` reaches `extensions/`,
  outside the renderer's root, through the dev server. _Check:_ `npm run dev` with an extension in
  place; its pages should show, and editing one should hot-reload.
- **A packaged build with an extension.** Its extra main entries are assumed to land beside
  `index.js` in the asar and to load from there. _Check:_ `npm run dist:dir` with one in place.

## Nav routes

- **Recording while EDSSI runs.** Route capture was verified by replaying a copied session with a
  `NavRoute.json` rebuilt from its jumps, not by plotting a route with the app open.
  _Check:_ plot a multi-jump route in the galaxy map with EDSSI running; the Route tab and jump
  entries should show it within a second, and `nav_route` should gain a row with its systems.
- **Arrival after the clear.** The game clears a route ~12 s before the final `FSDJump` (seen in
  every route in the local journals). EDSSI still counts a jump into the destination up to 60 s
  after the clear. A manual clear followed by jumping to the old destination within 60 s would be
  miscounted as on-route.
  _Check:_ cancel a route one jump before its end, then jump to the destination at once.
- **Routes aren't per commander.** Routes are stored globally; two commanders sharing a journal
  folder would see each other's routes.
- **Rows without systems for old plots.** The route service now reads every journal, so the first
  start records a row for every past plot (without systems).
  _Check:_ after the first start, `SELECT count(*) FROM nav_route` should match the number of
  `NavRoute` lines in all journals.
- **Systems not in EDSM.** Each route being followed is looked up on EDSM's
  `/api-v1/systems?systemName[]=…&showId=1`, 50 names a request, matched back by id64. The
  endpoint was tried with three names (two known, one made up) but never with 50, nor with a long
  route plotted in game; EDSM's rate limit on it is unknown, and a failure shows "Couldn't reach
  EDSM" with no retry until the next plot. The spoken line (`voice.speech.route_callouts`) comes
  only for a route plotted live, once NavRoute.json lists its systems; a replot to the same
  destination is a new route and is announced again.
  _Check:_ plot a 50+ jump route out in the black with EDSSI running: the callout should come
  within a few seconds, the Route module's "Not in EDSM ahead" and the Mission tab's summary should
  agree with it, and the count should drop as you jump.

## Journal grouping

- **Multi-jump chains in the real view.** Grouping a route's chain (StartJump → next FSDTarget →
  FSDJump, repeated) is covered by unit tests modelled on real sequences, but the real-session
  preview only had single-jump routes (the 5-jump route fell outside the 1,000-entry window).
  _Check:_ follow a multi-jump route with EDSSI open; each jump should be one row with "next X".

## Ledger (fines, bounties, cartographics, exobiology)

The local journals now hold exploration and organic sales (September 2026), but only one crime and
no voucher redemptions, so the fines and voucher rules are still untested against real data.

- **Body values.** Ported from EDDiscovery's `EstimatedValues.cs` (3.3+ formulas, unchanged on
  its master as of 2026-09) and unit-tested against the formulas, not against real payouts.
  _Check:_ note "Pending cartographics" before selling everything at Universal Cartographics and
  compare with the sale's `TotalEarnings` (`MultiSellExplorationData`/`SellExplorationData`).
  A script could replay old journals and compare the estimate before every sale.
- **Nav beacon scans count as sellable.** `NavBeaconDetail` scans are included like any other scan.
  They may not pay, which would overstate the total.
- **Rescanning after a sale.** A system whose data was sold is forgotten once the commander leaves
  it; scanning it again counts again. Universal Cartographics may not pay twice.
- **A sale sells everything more than 20 ly away.** `MultiSellExplorationData.Discovered` doesn't
  name every system sold: at a carrier on 2026-09-24, three sales paid 19.7M and named 39 of the
  118 systems scanned that trip (the first paid 11.7M and named four worth 27k), and the game
  said everything was sold. So each `MultiSellExplorationData` marks sold every system more than
  20 ly from the current one, plus any it names. The 20 ly rule comes from one sale at Explorer's
  Anchorage: the station's system and Sagittarius A\* (3.7 ly) stayed unsold, and the nearest
  system that sold was 41 ly away. Selling only some systems isn't modelled; Odyssey's Universal
  Cartographics is believed to sell all it can. The legacy `SellExplorationData` still sells only
  the systems in `Systems`, matched by name, case-insensitively.
  _Check:_ sell with data from both nearer than and just beyond 20 ly aboard, and see what Universal
  Cartographics keeps; also whether it ever offers selling a single system.
- **Odyssey mapping bonus.** Applied when the latest `LoadGame` has `Odyssey: true`.
- **First footfall bonus ×5 for organics.** Taken from the old ImmerseDangerous code and
  community knowledge. EDDiscovery doesn't apply it, and there's no local data.
  _Check:_ sell organics from a body whose scan had `WasFootfalled: false`; `SellOrganicData`
  shows `Value` and `Bonus` per species.
- **Organic prices.** Vista Genomics prices since Update 14 (plus the Thargoid entries EDDiscovery
  added in 2024). _Check:_ compare a `SellOrganicData` `Value` with the table in `values.ts`.
- **Sampling order.** `Log` → `Sample` → `Sample` → `Analyse`; the second `Sample` is the third
  sample taken, and `Analyse` follows a few seconds later. Only `Analyse` completes a species: on
  2026-09-24 the commander boarded 5 s after a third sample, no `Analyse` was logged, and Vista
  Genomics didn't buy it. Still assumed: that logging a different species throws away a sample in
  progress, and that an unanalysed third sample can't be analysed later.
  _Check:_ start another species halfway through a first one; take a third sample and board at
  once, then go back and see whether the game still holds two samples.
- **What dying loses.** Assumed: unsold exploration and organic data, and uncashed bounty and
  combat bond vouchers, are lost on `Died`; outstanding fines are settled at the rebuy
  (`Resurrect`). The journal's `Died` line now shows that loss priced, body by body and species by
  species. An on-foot or SRV death writes the same `Died` line, and it isn't known here whether
  that one costs the ship's data at all — if it doesn't, the line will overstate it.
  _Check:_ a death with data and vouchers on board, and separately a death on foot; compare the
  figures with the ledger just before.
- **Fines.** Only `CommitCrime.Fine` is counted, per faction. Not modelled: fines turning into
  bounties after a while, or fines tied to a particular ship. `PayFines` without a faction and
  without `AllFines` pays down factions oldest first (a guess).
- **Vouchers through a broker.** `RedeemVoucher.Amount` is taken as net of the broker's cut, so the
  voucher's worth is `Amount / (1 − BrokerPercentage / 100)`. Only `Type` `bounty` and
  `CombatBond` are handled.
- **Commanders.** Events before a session's `Commander`/`LoadGame` count for an unnamed commander.

## System panels and EDSM

- **Threat and traffic grading.** Threat is graded from EDSM's ship losses in the last 24 h
  (0 low, 1–4 medium, 5+ high); traffic warns above 10 and turns red above 100 (the old app's
  thresholds). Both are judgement calls.
- **Closest starport.** The EDSM station nearest the arrival star, skipping fleet carriers only
  (settlements and megaships count).
- **EDSM limits.** Four requests per new system, cached 15 min (1 min after a failure). EDSM's rate
  limits aren't read; long neutron runs could hit them. _Check:_ watch the console for 429s.
- **Scoopability.** From the star class in the jump countdown (`StartJump.StarClass`) or the
  arrival scan, else EDSM's primary star. After loading into a system without scanning its star,
  only EDSM knows.
- **Security colours.** Matched on the English localised text ("Anarchy", "Low Security").

## System panel

Checked against 24 of the commander's own journals (408 `FSDJump`s, 28 honks) unless noted.

- **The honk writes one line and nothing else.** Confirmed: in all 29 honks no `Scan`,
  `FSSBodySignals` or other event followed within 30 s that wasn't ambient (`Music`, `FuelScoop`,
  `StartJump`). Every body row in the panel needs the commander to resolve bodies in the FSS.
- **`FSSBodySignals` arrives one body at a time, a second before that body's `Scan`.** Confirmed
  from a live FSS pass: resolving a body writes `FSSBodySignals` and then `Scan`/`Detailed` for
  the same `BodyName`, and only for bodies that have signals. So `signalsRow` fills in gradually
  as the commander works through the FSS, not all at once.
- **`FSSDiscoveryScan.Progress` is how much of the system is already resolved**, not how much of
  it other commanders had discovered. Every honk with `Progress === 1` was either a nav-beacon
  system or a one-to-three-body system whose bodies the arrival auto-scan had covered, and each
  was followed by `FSSAllBodiesFound` or by nothing. The exact weighting is unknown — three
  bodies reported `0.778`, which is not a whole fraction of three — so only the `=== 1` case is
  relied on, and then only in a tooltip. _Check:_ honk a large untouched system and watch whether
  `Progress` tracks bodies resolved or their value.
- **"Charted" reads the arrival star.** `chartedRow` takes the first `kind: 'star'` body in the
  survey (sorted nearest first) as the arrival star and uses its `WasDiscovered`. Confirmed that
  the game auto-scans an arrival body a median of 6 s after `FSDJump` (257 of 408 jumps; the
  other 151 wrote no `AutoScan` within 60 s, and why is not established). Only 1 of those 257 was
  undiscovered, so the undiscovered branch has never been seen live.
  _Check:_ jump into unexplored space and confirm the row turns green before the honk.
- **"Not in EDSM" as a fallback for charted.** EDSM answering `unknown` is treated as nobody
  having been there. It really means nobody _uploaded_ it, which is not the same thing.
- **Hiding the bubble rows.** Security, economy, government, allegiance, population and the
  closest starport are dropped when `Population` is 0. Confirmed from journals that an
  uninhabited system reports `SystemAllegiance: ""`, `SystemEconomy_Localised: "None"`,
  `SystemGovernment_Localised: "None"` and `SystemSecurity_Localised: "Anarchy"` — the last being
  why security is hidden rather than shown as a threat.

## Current body section

- **When it shows.** Under the current system while `Status.json` flag 21 ("Has Lat Long") is
  set: orbital cruise, glide, landed, SRV, on foot. Not tried live, nor seen in the app since it
  replaced the full body list. _Check:_ drop to orbital cruise over a scanned body.
- **Current body.** Matched by `Status.BodyName` equal to the scan's `BodyName`. An unscanned body
  shows only its name and "Not scanned".
- **Bio signal count.** Taken from the `Biological` signal in `FSSBodySignals`/`SAASignalsFound`.
  No journal so far contains one, so the bio row and list have never had real data through them.
  The signal types seen are `Planetary Mining Location` (156), `Geological` (16), `Human` (6) and
  `Thargoid` (3). _Check:_ FSS a body with life and confirm the green "Bio signals" row appears.
- **Which signals get a row.** Mining locations sit on nearly every rocky body and would drown out
  the rest, so they're summarised in the tooltip only; biological has its own row. Whether
  `Guardian` and the other types the game can emit read well there is untested — no journal has
  any.

## Mission tab

- **Not seen running.** The tab was checked with unit tests and by replaying the local journals
  through the tracker (11 unsold species, jump numbers in order). Nobody has looked at it in the
  app yet. _Check:_ open the Mission tab mid-trip. Look for overflowing columns in the species
  lists, long system names, and a long "since last sale" list scrolling.
- **Selling organics.** No local journal has a `SellOrganicData`. The last sale's value is taken as
  the sum of `Value + Bonus`. A partial sale is assumed to keep the unsold species in the log, and
  lost samples drop out of it at the next sale. _Check:_ sell at Vista Genomics; the log should
  empty and show the sale time and total the game paid.
- **"New".** A species is new if EDSSI never saw the commander analyse it in the journals it has.
  It is not read from the codex, so species analysed before the oldest journal in the folder show
  as new. A genus is new if no species of it was ever analysed.
- **Genus price ranges.** A genus code (`$Codex_Ent_Bacterial_Genus_Name;`) is matched to the
  species whose codex names start with it. Only `Bacterial`, `Fonticulus` and `Stratum` genus
  codes appear in local journals, so the others are assumed to follow the same naming.
- **Jumps between samples.** Only `FSDJump` counts. A carrier jump, or a rebuy that moves the
  commander, changes the system without adding a jump.
- **Session share.** "This session" starts at each `Fileheader` with `part` 1, the same rule the
  journal service uses. A body scanned in an earlier session and mapped in this one counts only
  its mapping bonus toward the session. Organics count toward the session they were analysed in.

## Worth a probe (Mission tab)

- **Not seen running.** The section is unit tested only. _Check:_ arrive in a system with an
  Earth-like or terraformable world, honk and FSS it; the section should list it with its value
  once mapped and a green "+… CR", and drop it once it's mapped.
- **The order.** Credit targets are ranked by earnings per light second from arrival, with every
  body under 500 ls counted as 500, since distance from arrival isn't the detour from where the
  ship is, and supercruise time doesn't grow in line with distance. _Check:_ in a system with
  several targets, see whether following the list top to bottom is a sensible loop; tune
  `NEAR_LS` in `src/shared/mission.ts` or rank by an estimate of supercruise time if not.
- **What the probes earn.** The figure is `estimateBodyValue` mapped efficiently less unmapped,
  so it assumes staying within the probe target, and inherits that function's assumptions (see
  the ledger section). _Check:_ map a water world within the target, sell it, and compare the
  payout with the value before mapping plus the figure shown.

## Life predictions (spawn rules)

Checked by replaying the local journals through the tracker. All 58 species analysed were among
the predicted candidates, with the right colour. Every one of the 65 genera the surface scanner
named on 35 bodies was in the list of possible genera for its body. On average a mapped body had
2.6 possible genera for 1.9 real ones, and a named genus 1.05 candidate species. All of those
bodies are in one small area of the galaxy (the Inner Orion Spur), so the region, nebula, Guardian
and tuber rules, and most genera, have never been tested against a real find.

- **Not seen running.** The predicted line ("2 unnamed", italic) and the "could be …" line under it
  weren't looked at in the app. _Check:_ open the Mission tab in a system with unmapped bio bodies.
  Look for wrapping, the tooltip and whether the range reads clearly next to real values.
- **The rules are the community's.** They are copied from EDMC-BioScan
  (`scripts/generate-bio-data.py`, commits pinned in the generated headers). Some rules rest on a
  single sample, and a species with no rules (Stratum Aranaemus) is never predicted. When a genus is
  missing, a named genus falls back to its full price range, and an unnamed signal gets no value.
  _Check:_ note any `ScanOrganic` species that wasn't among its body's candidates. Rerunning the
  generator against a newer BioScan picks up their fixes.
- **Units.** `SurfaceGravity` is read as m/s² and `SurfacePressure` as Pa, converted with BioScan's
  constants (9.797759, 101231.66). Local scans agree: a 0.25 g HMC body logs 2.45.
- **Stars not yet scanned.** Star rules and colours only know the stars scanned so far. Before the
  FSS resolves a secondary star, species needing it (or coloured by it) are missing. Its moons'
  prediction fills in once the star's `Scan` arrives.
- **Parent stars from names.** As in BioScan, a body's parents are the capital letters leading its
  name ("AB 1 a" → A and B), or the main star in a single-star system. `Parents` in the scan is
  ignored. BioScan's special case for a black hole parent (colour from its companions) isn't
  ported. _Check:_ sample a star-coloured species (Aleoida, Bacterium Aurasus) on a moon orbiting a
  black hole.
- **Pre-map range.** The value of N unnamed signals is taken as the N cheapest possible genera at
  least and the N dearest at most. That assumes one species per genus per body, which isn't true of
  Brain Trees and Sinuous Tubers. It also counts a genus's cheapest species toward the low end,
  though that species is often not the one that grows there.

## Window position

Ported from OverLooker, whose version runs daily on this machine; the geometry is unit tested but
none of it has been through a real Electron window here.

- **Size on a scaled display.** Measured with Electron 44 on this machine: a window on the 150%
  portrait monitor made 968×845 reads back 968×848 from `getBounds`, so sizes are stored as
  reported. (The OverLooker port divided them by the scale factor, which shrank the window to
  2/3 at every restart.) Not measured: a window saved on one display's scale and restored on
  another's. _Check:_ resize the window on the 150% monitor, restart, and see it come back the same
  size.
- **Re-maximizing on start.** `win.maximize()` is called before `ready-to-show`. Whether that
  paints a maximized window straight away or flashes the restored size first is untested.
- **A straddling window is pulled fully onto one display.** Deliberate — it's what OverLooker
  does — but it means a window deliberately spanning two monitors won't come back that way.
- **The final save on `close`.** EDSSI writes once more when the window closes, which OverLooker
  does not, so a move made inside the last 300 ms isn't lost. Untested that the write lands before
  the process exits. _Check:_ move the window and quit immediately.

## Assistant

Nothing here has been run against the real APIs or a running game: the assistant was built and
unit-tested offline. The first live run should go through this whole section.

- **Starting over by voice.** "Start over", "new conversation", "reset the conversation", "clear
  comms" and "forget all that" are caught locally (`startOverCommand`) and clear the conversation
  with a chirp, as New does. Anything worded otherwise goes to the model, which has `start_over`:
  the conversation is forgotten once that answer finishes. Whether the model reaches for it only
  when asked, and says nothing after it, hasn't been seen with a real model.
  _Check:_ say "let's wipe the slate clean"; the Comms log should empty with a chirp and no reply.
  Then ask something about the earlier conversation and see that it is gone.

- **Push-to-talk while the game has focus.** `voice.push_to_talk` is registered with Electron's
  `globalShortcut`, which uses Windows' `RegisterHotKey`. Whether that fires while Elite Dangerous
  is in the foreground, and whether it swallows the key so the game never sees it, is untested.
  _Check:_ with the game focused, press the key and watch EDSSI's Comms tab for "Listening".
  A fullscreen (not borderless) game is the case most likely to fail.
- **Recording.** `MediaRecorder` records Opus in WebM in the sandboxed window, and the permission
  handler in `main/index.ts` allows `media`. Untested against a real microphone, as is the
  1500-byte floor that throws away an accidental key press.
- **Transcription hints.** `gpt-transcribe` is sent `keywords` (system, station and body names in
  play). The parameter is in the SDK's types but has not been exercised, and there's no word on
  how many keywords it will take; EDSSI caps it at 40.
  _Check:_ say a system name with an awkward spelling (Hyades Sector DR-P b6) and see what comes
  back.
- **Speaking before the answer is finished.** Each sentence is sent to the speech model as soon as
  it is written: the first one as-is, later ones gathered to about 120 characters
  (`FOLLOW_UP_CHARS` in `ai/service.ts`). Requests run one at a time to keep the audio in order, so
  a long reply could still leave a gap mid-answer if a request is slow. The split itself is unit
  tested; the timing is a guess.
  _Check:_ ask something with a two or three sentence answer and listen for a pause between them.
  If there is one, raise `FOLLOW_UP_CHARS` (fewer, longer requests) or start the next request
  while the previous is still streaming.
- **Speech playback.** Answers are streamed as 24 kHz PCM and scheduled with WebAudio. Chunk
  boundaries that fall mid-sample are covered by unit tests; the 80 ms lead-in was measured as
  enough on this machine, but clicks between chunks would mean it is too tight. Playback relies on
  the `autoplay-policy` switch, since nothing in the window is clicked before a spoken answer.
  Timed end to end here: a short answer reaches the speakers about 1.1 s after the model finishes
  it, nearly all of it the speech model's own first-byte time. The audio device is opened when the
  window mounts (`SpeechPlayer.warmUp`), at the device's own sample rate: opening it on the first
  chunk instead, or forcing 24 kHz, cost about four seconds of silence, because an AudioContext's
  clock does not start until Windows has the device open.
  _Check:_ if speech is ever late again, log `context.currentTime` when the first chunk arrives —
  0.000 means the device is still starting, and the wait is the device, not the API.
- **The ChatGPT provider.** `provider: codex` signs in with the Codex CLI's OAuth client and posts
  to `https://chatgpt.com/backend-api/codex/responses`, mirroring what OverLooker does. Unverified:
  that a ChatGPT plan can run `gpt-5.6-luna` at all, that the backend accepts
  `include: ['reasoning.encrypted_content']` and `prompt_cache_key`, and that dropping item ids
  (what the Codex CLI does) is right for both backends. A round trip with a tool call is the test:
  it is the second request, carrying the model's own reasoning back, that would break.
  _Check:_ sign in from the Comms tab, ask something that calls a tool, and watch for a 400.
- **Reasoning items on the OpenAI provider.** `store: false` plus encrypted reasoning is what the
  docs describe, but EDSSI strips the ids there too. If the API complains about an item id, that's
  why.
- **What a question costs.** Every question carries the instructions, the toolsets' descriptions
  and a state brief, and `gpt-5.6-luna` with `reasoning_effort: low` is assumed to be enough for
  the tool loop. Neither the token cost nor the quality has been measured.
- **Ultrathink.** A question containing "ultrathink" (also "ultra think", "ultra-think") is
  answered, every tool round of it, with `assistant.ultrathink` (default `gpt-5.6-terra` at `high`).
  The model id is inferred from `gpt-5.6-luna`'s naming, not checked against either provider, and
  nor is whether a ChatGPT plan can run it. The word is put first in the transcriber's keywords so
  a spoken "ultrathink" survives, which hasn't been heard either. A high-effort answer may think
  for a long while before anything is spoken.
  _Check:_ ask "ultrathink: what's the best way to Colonia?"; the transcript should show an
  `ultrathink` line with the model, and no 400 for an unknown model.
- **Settings reloading.** `~/.edssi/config.yaml` is polled once a second and applied without a
  restart, including rebinding push-to-talk. Untested while a question is in flight.

## Assistant: the web

`fetch_page` was run against live sites from a script (Inara's community goals, EDSM, Fandom and
Wikipedia read; the Frontier forums serve bots an empty 202). Nothing here has run inside the app
with a real model.

- **Hosted web search on the codex provider.** `{ type: 'web_search' }` is assumed to be accepted
  by the ChatGPT backend the way it is by the API (the Codex CLI sends the same tool).
  _Check:_ with `provider: codex`, ask "what's the current community goal?"; the transcript should
  show a `web_search` line and an answer, not a 400.
- **Leaving `web_search_call` out of the history.** Assumed the next request is still valid with the
  search call dropped and its reasoning and cited message kept.
  _Check:_ ask a follow-up question right after an answer that searched.
- **Citations are taken out of the text.** Seen once in the app: a searched answer ended in
  `([site](url?utm_source=openai))`. `citations.ts` removes that shape (one or more links in
  brackets, or a bare link) as it streams and shows the links under the answer. Other shapes the
  search might use (footnote marks like `【1】`, a bare URL) are not handled.
  _Check:_ with speech on, ask something that needs a search; nothing of the link should be heard,
  and a "Sources:" line should show under the answer.
- **The search line comes before its answer.** Assumed the `web_search_call` item is finished
  before the answer's text starts streaming.
  _Check:_ in the same answer, the `web_search` line should sit above the ship's reply.
- **Source links open in the system browser.** Clicked through the window-open handler, which only
  lets `https:` out. _Check:_ click a site under a searched answer.
- **The model uses search sensibly.** That it prefers game data and tools, and reads pages a window
  at a time rather than fetching everything. Watch the transcript's tool lines over a few sessions.

## Assistant: Spansh

Every tool was run from a script against the live site on 2026-09-14 (carriers from a spot 850 ly
from the nearest one, an 8A scoop, encoded traders, tritium, ringed bodies, all nine plotters, a
route read back in windows). Nothing has run inside the app with a real model.

- **No documented API.** The endpoints, request shapes and answers were read out of the site's
  own JavaScript bundle and tried by hand. Spansh can change any of them without notice.
  _Check:_ when a tool starts answering "Could not perform search" or a plotter fails, rerun the
  requests in `src/main/spansh/` against the site in a browser's network tab.
- **Unknown filter fields are silently ignored by Spansh**, so a filter with a misspelt name would
  return everything. `filters.ts` checks names against `searchable_fields` for that reason; a
  misspelt _value_ (a service name, a module name) still just matches nothing.
- **Bounds.** Ranges with a huge upper bound fail the whole search, so an open bound is sent as a
  one-sided comparison (`>=`, `<=`). A named amount with no bound is sent as "at least 1".
- **Galaxy plotter ship figures.** Worked out from the journal's `Loadout` the way the site does for
  an imported loadout: base FSD figures from coriolis-data (two misprinted SCO rows corrected by
  hand in `fsd.ts`), engineered optimal mass and max fuel from the journal's modifiers, the
  Guardian booster by size. Only an engineered SCO Mk II Mandalay was sent. The drive's
  supercharge (×6 for the Mk II, ×4 otherwise) is also used by the neutron plotter.
  _Check:_ plot the same trip with `spansh_plot_exact_route` and on the site with the ship
  imported; the jump counts should match.
- **Default jump range** for the neutron, riches, exobiology and tourist plotters is the loadout's
  `MaxJumpRange` (unladen, fuel for one jump), which is longer than the ship manages loaded.
- **Carrier tritium.** Mass 25,000 t and capacity 25,000 t (squadron carriers 15,000 / 60,000) are
  the site's own figures. With no tritium given, Spansh works out what to start with.
- **Waiting on a plotter.** A tool waits up to 75 s, then hands back the job id. A trade loop took
  longer than that; `spansh_route_result` then read it. Whether the model follows up is untested.
- **Traffic.** Spansh publishes no rate limit. Field lists are cached for six hours; nothing else
  is cached. A model that pages through many results could make a lot of requests.
- **"Find the next sell stop"** (`find_next_sell_stop`, `src/main/spansh/sell-stop.ts`). Run from
  a script against the live site on 2026-09-26 (from Pru Aihm, towards Sol plotted and Colonia as a
  CSV route); never by voice with a real model. Unchecked:
  - That the model reaches for it on the words "find next sell stop" and turns "with repair and
    refuel" into `services`. _Check:_ say both, and read the tool call in the Comms tab.
  - Carriers are searched with `carrier_docking_access` = `All`, so the many whose access Spansh
    doesn't know (about 40% on the day) are left out, unlike the carrier alert, which keeps them.
  - Only the nearest 300 stations and 300 carriers with Vista Genomics are looked through for one
    nearer the destination; deep in the black, heading away from everything, none may be found.
  - The pad each ship needs comes from lists of the journal's `Ship` names in `sell-stop.ts`;
    anything unnamed is taken for medium. The newer ships' names (`explorer_nx`, `panthermkii`,
    `cobramkv`…) were written from memory. _Check:_ ask with each ship, and compare its `Loadout`
    `Ship` with the lists.
  - A CSV route's end is looked up on Spansh by name, trying up to five systems back from the end;
    a route of systems Spansh has never heard of is searched in any direction instead.

## Assistant: the browser

Checked in Electron (see `docs/web-and-browser.md`), but not with a real model driving it, and not
in a packaged build.

- **Window zoom.** The frame's rectangle is scaled by the window's zoom factor; only zoom 1 was
  tried. _Check:_ set `display.zoom: 1.5`, open the Browser tab; the page should still fit its frame.
- **Moving the frame without resizing it.** The tab re-reports its rectangle on its own resize and
  the window's; a layout change that moves the frame without resizing it would leave the page
  behind. None is known. _Check:_ resize the window and toggle the side panel's contents.
- **What the outline misses.** Content inside cross-origin iframes (embedded maps, some cookie
  banners) isn't in `getFullAXTree`'s answer, and a banner that arrives after the read isn't
  either. _Check:_ `browser_read` on a page with a consent dialog, compared with a screenshot.
- **Private network by name.** Page requests are blocked for `localhost` and private IPs, but a
  host name that resolves to a private address isn't looked up. Model-given addresses are.
- **Sign-ins persist.** Assumed from the `persist:` partition. _Check:_ sign in to Inara in the
  tab, restart EDSSI, reopen it.
- **The model's use of it.** That it tries `fetch_page` first, reads rather than screenshots, and
  says when it shows a page. Watch the transcript's tool lines.
- **The gate's guesses.** What needs a yes is read from markup: submit buttons, `method`, labels
  in English. A site that submits from a plain `<div>` with script, or labels its buttons in
  another language or with icons only, gets through without asking; a GET form that changes
  something (rare, but it happens) too. `browser_eval` always asks, so it can't be used to go
  around it. _Check:_ try the tools on Inara's and the forums' real forms, signed in.
- **Spoken prompts.** The prompt is queued into the answer being spoken; with speech on, it has
  only been reasoned about, not heard. _Check:_ ask for something that needs a yes with speech on,
  and answer "yes" by push-to-talk.
- **Replies that aren't answers.** "Yes, but use the other address" is read as a yes. A reply
  that doesn't start with an answer word starts a new question and cancels the waiting one.
- **Focus emulation side effects.** With it on, a page always believes it has focus, which may
  keep animations or autoplay going in the hidden tab.
- **Tool rounds.** `assistant.max_tool_rounds` defaults to 8, which a form of several fields
  (read, type, type, click, read…) can use up. Watch for "Gave up after too many steps".

## Assistant: the commander's journey

`main/activity/` was replayed over the local journals (20k events, 2.8k records, 0.25 s), and the
tools' output read by hand. It has not been tried in a conversation with the model.

- **Time played.** A gap of more than 20 minutes between journal lines (`IDLE_GAP_MS`) is counted
  as time away. A long supercruise, or sitting docked in a menu, can be that quiet, and a game left
  running overnight writes `Music` lines that would count as play. Today's replay gave 8 h 14 min
  for a 19:10–03:41 evening, which looked right.
  _Check:_ compare a session's `minutes_played` with how long you know you played.
- **"Today" starts at 06:00 local time** (`DAY_START_HOUR`). The model is told so and passes
  period names; whether it reliably does so rather than inventing a calendar date is untested.
  _Check:_ after midnight, ask "what did I do today?" and see that the evening is included.
- **Earnings and spending.** Sources are the events listed in `tracker.ts`; fleet carrier
  finances, Powerplay, colonisation and on-foot sales (`SellMicroResources`, `SellSuit`…) are not
  counted. Trade profit uses `AvgPricePaid`, which is 0 for mined or mission cargo, so it reads as
  all profit. Mission rewards are counted both under missions and in money earned (the same
  credits, reported twice in different sections).
- **Mapping value.** A map's added value is the estimate for the mapped body less the unmapped one,
  so an already-mapped body that is scanned again before the journals start is missed.
- **Species values in the journey** use the Vista Genomics base price times the first footfall
  bonus, but don't know whether a sale paid the first-logged bonus. The Mission tab's own log
  (`get_exobiology_log`) is the one to trust.
- **Active missions** are kept from `MissionAccepted` and pruned by the `Missions` list at login.
  A mission accepted before the first journal never shows; one that expired in the game stays
  listed (flagged `expired`) until the next login.
- **Codex entries** from stars and planets (`$Codex_Category_StellarBodies;`) are counted but
  don't make a system a stop. Other categories (geology, anomalies, Thargoid and Guardian sites)
  weren't in the local journals.
- **`first visit`** only knows the journals EDSSI can read; the game's own `Systems_Visited`
  statistic (in `get_career`) is the real count.
- **Searching the whole history** (`search_activity`, `activity/search.ts`) scans every record
  with no index. Over the local journals (42 files, 39k lines, 8k records) the slowest search, free
  text over everything, took 18 ms. At that rate a commander with a hundred times as much history
  would wait about 2 s; an FTS table would help then. Free text matches the record's own line, so
  body types have to be the journal's words ("Earthlike body", not "Earth-like world"); whether
  the model picks those from the tool's description is untested.
  _Check:_ ask "how many Earth-like worlds have I found?" and "when did I last die?" and see which
  arguments it passes.

## Transcription

- **Why a named microphone recorded silence, and whether turning echo cancellation off fixes it.**
  `voice.microphone` picks an input by name. With it unset the commander's microphone worked; with
  the same device named explicitly, EDSSI listened and then did nothing — a live stream carrying no
  audio. The reading taken is that Chromium on Windows runs its echo canceller against the default
  capture and render pair, so forcing any other input through it yields a processed stream of
  silence; `constraintsFor` in `recorder.ts` now switches echo cancellation off whenever a device
  is named, and asks for the device with `exact` so a wrong one fails loudly instead of quietly.
  This is a reading of one report, not a diagnosis: the other candidate is that the `deviceId`
  matched by label belongs to a different endpoint than the label suggests.
  _Check:_ name the microphone under Voice in Settings and hold push-to-talk. The console now
  prints `[voice] opened "<label>"` with the track's settings and `[voice] recorded <n> bytes`.
  A four-figure byte count that still transcribes to nothing means the canceller was not the
  cause and the device itself is wrong; zero bytes now says so on screen rather than doing
  nothing at all.
- **Whether any of this fixes the real errors.** "Nine" came back as "Okay" in testing, along with
  other mistakes. Four changes were made on the strength of reasoning, not evidence: the microphone
  is held open between questions, recording carries on for 200 ms past the release, the transcriber
  is told what it is listening to and what the ship just asked, and `temperature` is 0.
  **None of them is confirmed to fix anything.** Speech generated with the TTS voice transcribed
  correctly both before and after the change, even with 120 ms cut off the front, so that test
  reproduces nothing — real microphone audio is the missing piece.
  _Check:_ run with `EDSSI_VOICE_DEBUG_DIR` set, reproduce a mistake, and work from the recording:
  level, how much of the first word is there, and what other transcription settings make of it.
- **Opening the microphone costs audio.** Measured on this machine: 211 ms from `getUserMedia` to
  the first audio on a cold open, 60 ms warm. That much of the first word does not exist when the
  device is opened on the key press, which is why it is now held open. Automatic gain control also
  settles over the first moment of a stream, so a fresh one may start quiet — untested, and a
  likelier cause of a mangled first word than the missing milliseconds.
- **Holding the microphone open.** `voice.keep_microphone_open` defaults to true, so the indicator
  light stays on while EDSSI runs. Nothing is recorded except while a binding is held, but the
  light is what a commander will notice; turning it off restores the old behaviour.
- **The 200 ms tail.** Recording continues past the release so a trailing word survives. It delays
  every question by that much. Neither the gain nor the delay has been judged in use.
- **Prompting the transcriber.** `gpt-transcribe` accepts `prompt`, `keywords` and `temperature`
  together — checked against the API. Whether quoting the ship's last line helps more than it
  steers is unknown: it could equally push a misheard word towards whatever the ship just said.

## Speech playback

- **The crackle.** Every piece of the answer was made into its own 24 kHz `AudioBuffer` and left
  for Web Audio to resample to the device's rate (48 kHz here), which it does to each buffer
  separately — so every join between pieces, dozens a second, was a discontinuity. `resample.ts`
  now does it once, carrying its place across the join, and the buffers handed to Web Audio are
  already at the device's rate. Measured in the tests rather than heard: pieces resampled
  separately now have no larger step between samples than the same audio resampled whole.
  _Check:_ ask for a long answer and listen for crackle over the whole reply.
- **The stutter: a gap in the middle of a word.** Measured cause — `hid.devices()`, the joystick
  hot-plug scan, blocks for 202 ms (up to 368 ms) on Windows and was running on the main thread
  every 2 seconds, while the audio pipeline carries only 120 ms of lead-in. It now runs through
  `devicesAsync()`, which leaves the event loop free (13 ms worst lag against 209 ms).
  With that gone, what was left was measured in use: pieces arriving 40-139 ms late, over and over,
  against a lead of 120 ms. The speech model streams at about the speed the words are spoken, so
  the lead is the whole of the jitter the audio can absorb, and it was smaller than the jitter.
  It now starts at 350 ms and widens by whatever was missed, up to 1.2 s, giving a little back each
  reply. Unverified: whether 350 ms holds on this connection, and the extra delay before the ship
  starts speaking has not been lived with.
  A later console log showed why widening alone didn't cure it: one reply ran dry twelve times,
  the gaps shrinking by ~28 ms each (189, 161, 132 … 18 ms), and every one was played as silence
  wherever the audio happened to end. The wider lead only helped the next reply. Now, when the
  audio runs dry mid-reply, the player gathers a full lead of audio before carrying on (one pause
  instead of a dozen), and while playing it holds back the tail after the last quiet 12 ms window
  (peak under 0.03, `quietCut`), up to 400 ms, so a pause falls between words. Unverified: that
  threshold against the real voice, and whether the held tail itself causes extra dry spells.
  _Check:_ the console says `[speech] ran dry N ms after the last sound` per stall, and at the end
  of such a reply `X s of audio arrived over Y s`. If Y is well above X plus the model's first-byte
  time, the speech stream itself is slower than real time, and no buffer in the window will fix
  that; look at the requests in `ai/service.ts` instead.
- **Ruled out, with measurements, so they are not tried again.**
  - _Background throttling._ A hidden window's timers drop to 1 s granularity, but IPC delivery
    stays at 33 ms, and the player schedules straight off the IPC event without a timer. It also
    happens with the window focused.
  - _The per-token snapshot broadcast._ The whole transcript goes to every window on every
    streamed token, which sounds expensive but costs 35 ms spread over a 250-token answer even
    with 200 entries in it.
- **Sentence boundaries.** Each sentence is its own request, and the next only started once the
  previous had finished streaming — a round trip of silence at every boundary. Requests now start
  as soon as the sentence is written and are sent on in order. This was found by reading rather
  than reported, and is a different fault from the one above. Unverified: how many requests run at
  once on a long answer, as nothing caps it.
- **Stopping mid-answer.** A reply that is interrupted now says `stopped`, which the window acts
  on; before, an interrupt and a normal finish were the same message, so the Stop button left the
  audio playing to the end. Found by reading, not reported — worth confirming that Stop, a new
  question, and push-to-talk all cut the voice off.
- **Sample rates other than 48 kHz.** The resampler is tested at 44.1 kHz too, but only this
  machine's 48 kHz output has actually been heard.
- **The acknowledgement chirp.** `acknowledge` plays a synthesised rising three-note chirp
  (`comms/ack.ts`) instead of a spoken "Done". Not yet heard: whether it sounds right and is loud
  enough over the game, and whether the model really leaves the reply empty after calling it
  rather than saying "Done" anyway. It was first heard seconds after the tab switched, because the
  model called `acknowledge` a round after `open_tab`; `open_tab` now chirps itself, and the model
  is told to call `acknowledge` alongside other actions, not after. Unverified that it does.
  _Check:_ say "open the mission panel" — the tab should
  switch, one chirp, no voice. Then "open the route and tell me how many jumps are left" — a
  chirp and a spoken answer. Every window running `useVoice` plays it, like speech.
- **Exobiology callouts.** After the FSS resolves a body with biological signals, EDSSI says
  e.g. "2: 1 bio, 5 to 95 million" (`main/callouts/exobiology.ts`).
  The trigger follows the journal order seen locally (`FSSBodySignals` then `Scan` in the same
  second) and is unit tested, but hasn't been heard live. Unchecked: how a system name the
  body name doesn't start with (e.g. named systems) sounds, whether several bodies resolved
  quickly read well as one joined utterance, and how a callout during an answer feels — it
  waits until the assistant is idle, and a question cuts it off. A callout is sent `queued`, so
  the window plays it after the audio still coming out rather than stopping it; heard only in
  theory, since the main process finishes sending a callout well before it finishes playing.
  _Check:_ FSS a system with life and listen; switch `voice.speech.exobiology_callouts` off and
  confirm it stays quiet.
- **Probe callouts.** On `FSSAllBodiesFound`, EDSSI says how many bodies are worth mapping (the
  Mission tab's "Worth a probe", cut off at `mission.min_probe_value`) and their total value once
  mapped, e.g. "2 bodies worth mapping, 14 million together" (`main/callouts/probes.ts`). It
  relies on `FSSAllBodiesFound` coming after the last body's `Scan`, as in every local journal
  checked, but hasn't been heard live. A system where the honk reveals everything at once may log
  it before the scans; such a system would then be called out short, or not at all.
  _Check:_ FSS a system with a terraformable or water world and listen for one line after the last
  body; switch `voice.speech.probe_callouts` off and confirm it stays quiet.

## Speech from Inworld

Speech plays with the default model and voice; the rest is still unheard.

- **`instruction` on `inworld-tts-2` only.** Flash is documented as taking inline tags only, so
  the delivery instructions aren't sent to it. Whether a long instruction is refused is unknown.
  _Check:_ switch between the two models; both should speak, and TTS-2 should sound like the
  Delivery setting.
- **Voice names.** `Ashley` is the voice in Inworld's own examples. The other suggestions in the
  Settings tab are from memory of Inworld's library (the voice list page needs a sign-in).
  _Check:_ try a few; a wrong one fails with Inworld's "voice not found" in Comms.
- **Latency.** Each sentence is its own request. Inworld claims under 200 ms to the first audio.
  _Check:_ listen to the gap before the first word, and between sentences.

## Speech from Kokoro

`src/main/ai/kokoro/` was run end to end outside Electron: downloaded into an empty folder, loaded,
three sentences asked for at once came back in order, and its phonemes matched kokoro-js's own on
numbers, money, times and abbreviations. Not yet heard through EDSSI's own playback.

- **In the packaged app.** onnxruntime-node is loaded from the unpacked asar, with only its
  Windows x64 binaries shipped (`electron-builder.yml`). DirectML's DLLs ship with it, unused.
  _Check:_ `npm run dist:win`, install, pick Kokoro, and listen; Comms shows any load error.
- **CPU while the game runs.** Four threads gave about four times real time on a 32-thread CPU
  with nothing else running. A busier CPU, or a smaller one, may fall behind the voice.
  _Check:_ ask something long mid-flight and listen for the gaps the player reports in the console
  (`[speech] ran dry`).
- **The first sentence after starting.** The model loads (about 1.5 s) at startup, but each voice
  file is fetched, and the session warms up, on the first sentence.
  _Check:_ the delay before the first spoken answer after a restart.

## Listening with whisper.cpp

`src/main/ai/whisper/` was run end to end outside Electron (downloaded into an empty folder,
transcribed, switched model, stopped mid-setup), and inside a second copy of EDSSI: a recording
made by MediaRecorder in the window, decoded to WAV there and sent through `askByVoice`, came back
right, "Shinrarta Dezhra" included. Not yet tried with a real microphone.

- **A crash leaves the server running.** A normal quit stops it, but a killed EDSSI leaves
  `whisper-server.exe` holding its model's memory until it is ended by hand; the next start runs
  a new one on another port.
  _Check:_ only matters if it is seen; a job object (koffi) would tie it to EDSSI.
- **Antivirus and downloaded executables.** whisper.cpp's build is fetched from GitHub and run
  from the data folder; it is checked by SHA-256, but an antivirus may still quarantine it.
  _Check:_ the first setup on a machine with Defender's cloud protection on.
- **Languages.** Only `large-v3-turbo-q5_0` hears anything but English; `language` unset sends
  `auto`.
  _Check:_ a question in another language with that model.

## Wyoming

`src/main/ai/wyoming.ts` was tested against wyoming-piper and wyoming-faster-whisper in Docker
(`rhasspy/wyoming-piper`, `rhasspy/wyoming-whisper`): describe, synthesize, transcribe, an unknown
voice, a server that isn't there, a cancelled request; and both ways inside a second copy of
EDSSI. Piper's audio was played by the window at its own 22,050 Hz, in a muted test window.

- **Names over Wyoming.** Wyoming's `transcribe` has no prompt, so the name hints OpenAI and
  whisper.cpp get can't be sent: "Shinrarta Dezhra" came back as "Shin Rata Deshra".
  _Check:_ wyoming-faster-whisper's own `--initial-prompt` option, set on the server.
- **Heard through speakers.** The in-app test ran muted.
  _Check:_ pick Wyoming with a Piper voice and listen for clicks between sentences.

## Stick bindings (capture by moving, clicks, repeat)

EDSSI now learns a binding from the device's own descriptor rather than from how its bytes behave:
`native/hid-usages` says what each control is, and `pressedControls` answers what is held that
wasn't when the capture began. It was checked against both Gladiator EVOs at rest — `Rx`/`Ry` sit
at 512 of 0..1023, the hat reads 8 of 0..7 when centred, which is what the code takes for "centred"
— and the decoding and the click logic are unit tested. What follows needs hands on a stick.

- **A stick that sends more than one kind of report.** The EVO L sends report ids 1 and 12, about
  68 a second between them, and the EVO R only id 1. `HidP_GetUsages` refuses a report whose id
  isn't the one a control lives in, so decoding id 12 answers "nothing is down" about id 1's
  buttons: held in one state per device, that wiped every button for as long as it took the next
  id-1 report to arrive, and turned one press into two — a command run twice, and two taps counted
  as the three a triple click wants. The state is now kept per report id and `held` is the union,
  and a report that decodes to nothing at all no longer counts as everything being at rest. Seen in
  the reports, and the cockpit behaved after the fix; only briefly, and not yet in flight.
  _Check:_ `npm run hid -- --presses` (the `--` matters, npm eats the flag without it), tap the
  bound button, and confirm one `DOWN` and one `up` per tap.
- **Capture picks the control the commander moved.** A button, a hat direction and a ministick
  pushed one way are all bound the same way: hold it for `CAPTURE_HOLD_MS` and the newest candidate
  wins. Whether a hand reaching across a stick brushes something on the way, and whether 120 ms is
  long enough to settle a ministick that flicks past its threshold on the way back to centre, has
  not been seen.
  _Check:_ Settings → VR cockpit → Bind a control on `toggle`, press a button, and confirm the row
  names the button you meant and lights up while it is held.
- **A control already held when the capture starts.** The baseline is what makes this work: the
  EVO L's `Z` sits at 0 of 0..2047 at rest, which is fully pushed as far as the maths is concerned,
  and it must never bind itself. Provably ignored in the unit tests, not yet watched on the device.
  _Check:_ start a capture, wait, and confirm nothing binds until something is actually moved.
- **Which way an axis binding points.** `direction: low` is the end of the declared range nearer
  `logicalMin`. Whether that is "up" or "down" on the commander's ministick is the device's
  business, and it is bound by pushing it, so the only way it can be wrong is if it feels
  backwards.
  _Check:_ bind `scrollUp` by pushing the ministick up, and confirm the panel scrolls up.
- **Double and triple clicks.** `MULTI_CLICK_MS` is 280 ms. Whether that is comfortable on a stick
  button — which is stiffer than a mouse — is a guess, and a control with a double bound waits that
  long before its single click fires, which is the part that will feel wrong if it is wrong.
  _Check:_ bind `toggle` to a press and `place` to a double click on the same button, and see
  whether both are easy to hit on purpose.
- **Auto-repeat while held.** `REPEAT_DELAY_MS` (350 ms) then `REPEAT_EVERY_MS` (60 ms), scaled by
  how far an axis is pushed. Whether a shoved ministick scrolls a panel at a readable speed, or
  flies past what the commander wanted, has only been reasoned about.
  _Check:_ bind the ministick to `scrollUp`/`scrollDown` and read a full Mission panel with it.
- **A stick binding while the game has focus.** Push-to-talk on a stick works this way already, so
  a cockpit command should too — it is the same watcher. Not tried in flight.
  _Check:_ summon the cockpit with a stick button while flying.
- **A device Windows can't describe.** `buttons.ts` is still the fallback, and it can learn a button
  but not a hat or an axis. A packaged EDSSI has no addon today, so that is the path it would take:
  binding a ministick there simply wouldn't work, and nothing says so.
  _Check:_ `npm run dist:win`, install, and try to bind a ministick.

## Push-to-talk and joysticks

- **Telling a button from an axis.** `buttons.ts` — now only the fallback for a device the addon
  couldn't describe — uses four rules together (one bit, not a busy
  byte, quiet while held, no neighbouring byte moving). They come from a recording of a real
  Gladiator EVO made through four prompted phases, kept as the fixture behind `buttons.test.ts`;
  the replay finds every button pressed and nothing from the axis bytes. What that recording
  showed, and what two earlier attempts got wrong:
  - The axes **jitter at rest** — tens of report changes a second with nobody touching the stick —
    so any rule that assumes an idle device is silent ends up binding axis noise.
  - A press is **mirrored into two blocks at once**, 260 bits apart (byte 17 bit 3 together with
    byte 49 bit 7), so "exactly one bit changed in the whole report" never matches a VKB button.
  - The axis **high** bytes creep once and then sit still, which looks exactly like a held button
    unless the neighbouring low byte is taken into account.
    Still unverified: only the right-hand stick is in the fixture, and only these two devices have
    been seen at all. A stick that packs buttons next to axis bytes, or whose buttons read active-low
    (a press clearing a bit rather than setting one), would still defeat this.
    _Check:_ Settings → Push to talk → Add a binding, hold one stick button, and confirm the row
    lights up while it is held. Then hold it and speak.
- **Holding the stick still during a capture.** The rules lean on a button's byte going quiet, so
  the capture asks for the button to be held for a moment and the stick to be left alone. Sweeping
  the axes throughout a capture binds nothing in the recording; whether another kind of control —
  a ratchet, an encoder, an analogue trigger — can still slip through is unknown.
- **Report ids.** Reports are grouped by their first byte, which is the report id for a device
  that uses numbered reports (the VKBs send `01`). A device that sends _unnumbered_ reports would
  have its first data byte read as an id, which would fragment the grouping and make a binding on
  a bit in that report unreliable. No such device was to hand.
- **Sharing the stick with the game.** hidapi opens HID devices shared on Windows, so Elite should
  keep reading the stick as usual while EDSSI has it open. Not tried with the game running.
  _Check:_ fly with EDSSI open and confirm no input is lost.
- **Buttons are numbered by bit position.** `button 35` is `byte * 8 + bit`, which will not match
  the number VKB's own configuration software shows. This is why the settings screen lights a
  binding up while it is held: that, not the number, is how you confirm you bound the right one.
- **Keys the game swallows.** The keyboard hook sees key-up even while the game has focus, but if
  a release is ever missed the microphone would stay open; the recording limit
  (`voice.max_recording_seconds`) is the backstop.
  _Check:_ hold a binding in the game, let go, and confirm the question is sent at once.
- **Two identical sticks.** The VKBs report no serial number, so a binding is matched on vendor
  and product id. The left and right sticks have different product ids, so they are told apart;
  two of the _same_ model would not be, and a binding made on one would follow whichever is
  plugged in. Untested.
- **The native modules.** `uiohook-napi` and `node-hid` ship N-API prebuilds and loaded under
  Electron 44 without a rebuild. They are unpacked from the asar by electron-builder; a packaged
  installer has not been built and run since.
  _Check:_ `npm run dist:win`, install, and confirm the Settings tab still lists the sticks.

## UI

- **The look.** Styled after ImmerseDangerous from its CSS. Neither Eurostile nor Euro Caps is
  installed here, so it renders in the bundled Saira fallback. Screenshots were checked only at
  the default 1280×800 window, on fixture folders built from a real session (mid-route, and a
  synthetic landing on a moon with life). Not tried: other window sizes, a live game, and a body
  section with a long life list pushing the side panel into scrolling.
- **Zoom.** `display.zoom` is applied with `webContents.setZoomFactor` when the page loads and
  whenever the settings file changes. Not tried in the app. Layout at 0.5 and 3 is untested, and
  so is whether a save from the Settings tab applies at once. _Check:_ set 1.5 on the Settings tab
  and save. The window should grow straight away and still be 1.5 after a restart.
- **Unsaved settings.** The Settings tab has Save and Discard pinned to its bottom. With unsaved
  changes, switching tabs (by click or by the assistant's `open_tab`) is refused until they are
  saved or discarded, or the commander chooses Stay. Not tried in the app. Closing the window still
  drops unsaved changes without asking. _Check:_ change a field, click Journal, and confirm the
  warning appears and Save or Discard then opens Journal.
- **Icons.** `bio`, `planet`, `orrery_map` and `galaxy-map` come from the old project and appear
  to be from edassets.org (fan-extracted game art); check the licence before distributing. The
  other icons were drawn for EDSSI.
- **Copying a system name.** Every system name in the HUD panels, the Mission tab, the route list
  and a journal event's system fields carries a copy button, which goes through the main process
  (`clipboard:write`) because the sandboxed window has no `navigator.clipboard`. Not tried in the
  app: whether the button sits well beside the big panel name, and whether what it copies pastes
  into the galaxy map's search as the game spells it. The assistant's `copy_text` does the same
  thing from a spoken request, and is untested against a real model.
  _Check:_ click one beside the current system, and paste into the galaxy map; then ask the
  assistant to copy the system you're in and paste that.

## Uploads (EDSM and Inara)

- **Send-session script.** Only tried as a dry run on the local journals (3,219 EDSM events and
  213 Inara events for the Sep 11–12 sessions). Not yet sent for real. Assumed: EDSM takes events
  that are days old and puts them in the flight log and on the systems; old Inara travel events
  land in the right place in its log. _Check:_ run
  `npm run send-session -- --session 2026-09-11 --session 2026-09-12 --send`, then look at the
  EDSM flight log and a system from the trip (e.g. Sifaea SG-Z b57-0) on EDSM.
- **Duplicates.** The script stops at the live cursor, so nothing should go twice. With
  `--include-sent`, or if a cursor was lost, EDSM is assumed to ignore journal lines it already
  has. Not checked.
- **Upload log.** Written for every request, live and backfilled. Not seen in the app yet. The
  Settings tab refetches when the live upload logs; rows the script writes show after Refresh.

Nothing has been sent to either service yet: no keys were used while building this. The
protocols come from EDMarketConnector's plugins (EDSM's own docs sit behind a Cloudflare check)
and Inara's API docs. A replay of the 24 local journals through both translators ran without
errors, but nothing reached the services. Server logs are in the main process console under
`[uploads]`.

- **Inara whitelisting.** Inara only answers applications it has approved, by exact `appName`
  (`EDSSI`). Until it is approved, every request should come back rejected at the header.
  _Check:_ apply at inara.cz (Inara API → application), then watch the Inara status line on
  the Settings tab after a jump.
- **`isBeingDeveloped`.** Sent as `true` when the app isn't packaged (`npm run dev`), which by
  Inara's docs only skips shared events such as community goals. If Inara actually stores nothing
  in that mode, dev runs won't update your profile.
- **EDSM accepts the software name.** `fromSoftware: EDSSI` is assumed to need no registration
  (msgnum 204 would say otherwise). _Check:_ fill in the EDSM key, jump, and look for a 1xx
  status and the jump in your EDSM flight log.
- **Transient fields.** `_systemAddress`, `_systemName`, `_systemCoordinates`, `_marketId`,
  `_stationName` and `_shipId` are added to every event (EDMC sends only four of them).
- **EDSM refusal codes.** 201–205 are taken to mean the key, commander or software is wrong, so
  uploads stop until the settings change. Other 2xx codes drop the batch instead of retrying it.
- **Pointer lines skipped.** `Cargo`, `ShipLocker` and `Backpack` lines that don't list their
  contents (they point at the companion file) are sent to neither service. EDSM may therefore see
  cargo changes later than EDMC reports them.
- **Materials drift.** Inara gets materials only from the `Materials` line at login; what is
  collected or spent during a session shows up at the next login (EDMC tracks it live).
- **First start.** With no cursor, a service starts from the moment it is switched on, so the
  session already played isn't sent. Events written while EDSSI was closed are sent on the next
  start only if they belong to the session it replays (the newest one).
- **Docked suppression.** The `Docked` written at login, after a carrier jump, after buying or
  swapping a ship, and when re-docking without leaving normal space isn't sent to Inara as travel
  (copied from EDMC). _Check:_ undock, fly a few km, dock again; Inara shouldn't log a new dock.
- **Rate.** EDSM gets at most one request per 2 s (arrivals at once, others within 30 s). Inara
  gets at most one per 35 s (travel at once, the rest within 2 min).

## EDDN

Built from EDDN's schema READMEs and EDMC's `plugins/eddn.py`. One message of every schema EDSSI
sends (journal/1 for Location, FSDJump, Scan, SAASignalsFound and Docked; fsssignaldiscovered,
fssdiscoveryscan, fssallbodiesfound, scanbarycentre, fssbodysignals, codexentry, dockinggranted,
commodity, navroute, outfitting, shipyard), made from the local journals and companion files, was
posted to EDDN's `/test` schemas on 2026-09-17 and accepted. Nothing has gone to the live schemas
from a running app yet. `EDSSI_EDDN_TEST=1` sends everything to the test schemas.

- **Reaching Spansh.** Assumed: a `Docked` at a carrier on journal/1 updates its system and
  `updated_at` on Spansh within the hour. _Check:_ dock at a carrier Spansh has as old (e.g.
  T4B-BHB, last reported 2026-07-28), then search it on spansh.co.uk.
- **Schemas never sent.** CarrierJump, approachsettlement, navbeaconscan, dockingdenied and
  fcmaterials_journal had no local events to try, so they follow the schemas unchecked.
- **Companion files read on the line.** Market, Outfitting, Shipyard, NavRoute and FCMaterials
  messages are made from the file as it is when the journal line is read, and only if the file's
  timestamp matches the line. Assumed the game writes the file first, as EDMC relies on. If it
  doesn't, those messages are silently skipped. _Check:_ open a market with EDSSI running; the
  upload log should show a `Market` request to EDDN.
- **No codex body.** CodexEntry goes without `BodyName` unless the game's line has it (EDMC adds
  it from `Status.json`, cross-checked); allowed by the schema, but less useful to listeners.
- **Refused messages.** A 400/426/413 is logged and dropped, never retried, as EDDN asks. Any
  other failure holds the rest of the batch for a minute.

## Carrier tracking (Ships tab)

- **Squadron carriers.** Their `CarrierStats` (capacity 60,000 t) list less space than they use
  (13,000 t of one real carrier's shows as Other), and it isn't known whether the jump fuel
  formula, their tank size (taken as 1,000 t) or `CargoTransfer` work as a fleet carrier's do,
  so a squadron carrier gets no jump or fuel predictions, only its last reading.
  _Check:_ open a squadron carrier's management screen before and after one of its jumps.
- **Cargo moved by others.** Trades at the carrier's market by other commanders, and moves on a
  squadron carrier by its members, never reach this commander's journal. EDSSI shows the
  difference from `CarrierStats` as unaccounted rather than guessing which commodity it was.
  _Check:_ have someone sell to a buy order, then open the management screen.
- **Tritium from the carrier's own hold into its tank.** Only deposits from the ship's hold were
  seen (`CarrierDepositFuel`, the carrier's cargo unchanged). If the depot can also draw from the
  carrier's storage, that would show as unaccounted cargo until the next `CarrierStats`.
  _Check:_ fill the tank from carrier storage in the tritium depot and compare the cargo figure.
- **Upkeep costs.** The weekly fee is 5M (a squadron carrier 10M) plus each installed service's
  running or suspended cost, plus 100,000 CR a jump (200,000 for a squadron carrier), all from the
  Elite Dangerous wiki (Drake- and Javelin-Class Carrier pages), not the journal, which never
  records a charge. The first charge after buying is assumed not to be prorated, and every jump
  (a hop between bodies too) to count. A `CarrierStats` crew role with `Activated` true and
  `Enabled` false is taken as suspended, and `CarrierCrewServices`' `Pause` / `Resume` /
  `Deactivate` as suspend, restart and uninstall; only `Activate` was seen.
  _Check:_ open the management screen before and after a Thursday 07:00 UTC and compare the
  balance drop with the Next charge the carrier panel showed.
- **Jumps while the game is off.** A jump that leaves while the game isn't running is taken from
  the request's `DepartureTime`, and the next login's `CarrierLocation` confirms it. Several
  jumps in a row made offline (only possible for a squadron carrier) count as one.
  _Check:_ schedule a jump, quit the game, and log in after it has left.

## Carrier alert

Queries tried against live Spansh from a script (Pru Aihm, Beagle Point, Sol), not from the app.

- **Range from `MaxJumpRange`.** The search reaches `jumps × Loadout.MaxJumpRange`, the ship's
  best unladen figure, as a straight line. Laden or around a void the real jump count is higher.
- **Quiet near stations.** Any non-carrier station with Repair on Spansh within range silences
  the alert. A settlement with repairs counts, which may be too eager on the edges of the bubble.
  _Check:_ jump out from the bubble's edge and note when the first alert comes.
- **Spoken, or written when speech is off.** Shown in the Comms transcript either way. Not yet
  heard in the app. _Check:_ jump in the black with a carrier within range.
- **Only the session's jumps after start.** The replayed session never alerts; the first jump
  after EDSSI starts looks from the new system, not the one the commander logged in at.

## Flight alerts

Unit tested with made-up events shaped like the local journals; not yet heard in the app. The
Spansh query (`is_main_star` and the scoopable `subtype`s, nearest first) was tried from a script
at Pru Aihm on 2026-09-18.

- **Fuel from Status.json.** `Fuel.FuelMain` over `Loadout.FuelCapacity.Main`, read only while
  flag 24 (in the main ship) is set. Assumed the game rewrites Status.json as fuel burns, and
  that fuel drops while flag 30 (FSD jump) is set, which is why those updates are skipped.
  _Check:_ fly below the threshold in normal space; the warning should come once, not again
  after the next jump's start, and again on arrival in the next system.
- **Scooping silences it.** Flag 11 set means the commander is already at a star, so nothing is
  said (and nothing is marked as told). _Check:_ drop low, then scoop; nothing should be said.
- **A star "here".** Taken from the scanned stars in the survey or from the `StartJump`
  `StarClass`. After a login in a system (no `StartJump`) before the honk, Spansh is asked, and
  its answer names the current system at 0 ly; that reads as "the star here".
- **Route preference.** A scoopable star up to 3 jumps along the route is named over any nearer
  one off it; further along, Spansh's nearest is named, and the route's star only if Spansh
  fails. Whether 3 is right is a guess.
- **Next jump from `FSDTarget`.** Its `StarClass` decides (seen in the local journals). An
  empty one falls back to EDSM's `isScoopable`. On a route the game writes the next hop's
  `FSDTarget` mid-jump (StartJump, FSDTarget, FSDJump), so nothing is said from a hyperspace
  `StartJump` until 5 s after the `FSDJump` (or 90 s after a `StartJump` that never arrives).
  Every non-scoopable target warns, neutron routes included. _Check:_ follow a neutron plot;
  each warning should come a few seconds after arriving, and see whether it's too many.
- **Fuel for the stretch ahead.** On a target that is a system ahead on the followed route and
  can't be scooped, the jumps from here to the next scoopable star on it (or its end) are costed
  with the FSD fuel formula over the drive `shipBuild` reads from `Loadout`; checked against
  nine logged jumps of one explorer (Mk II SCO, Guardian booster, 12 t cargo), plain and
  supercharged: 0.5-1.1% high every time. A departure from a neutron star counts as supercharged,
  one from a white dwarf only when the jump is too long without it; a star the route doesn't
  name counts as unscoopable, so a Spansh neutron CSV not yet located may warn early. A jump
  targeted past the next system is costed along the route, not straight. Not heard in the app.
  _Check:_ follow a route with a run of brown dwarfs or neutrons on a low tank and target the
  first; the warning should come in place of the plain one, and not while scooping.
- **Gravity needs a scan.** `SurfaceGravity` from the body's `Scan` in the survey; a body not
  scanned (or scanned in a session the history reader missed) is never warned about. Near a
  surface only a change of `BodyName` is looked at, so a scan made while already near it waits
  for the next approach. _Check:_ approach a scanned body of 3 g or more; also lift off from a
  port on one.
- **Quiet while docked or landed.** Flags 0 and 1, and Flags2 taxi or multicrew. A next-jump
  warning held back while docked is given on undocking. _Check:_ plot to a neutron star while
  docked, then launch.

## Personal bests

- **Binary separation.** "Closest binary" adds the semi-major axes of two planets that share a
  barycentre, both scanned. The journal gives each one's axis around that barycentre, which
  should sum to their separation, but this hasn't been checked against the system map. Pairs
  with a star, a barycentre or a third body are left out.
  _Check:_ scan a close binary pair of planets and compare with the orbit shown in the system map.
- **Star classes.** Spoken class names for stars (`N`, `H`, `DA`, supergiants…) follow the
  journal's documented `StarType` values, not ones seen in local journals.
  _Check:_ beat a record for a white dwarf or a neutron star and listen to how it is named.
- **Callout volume.** Only a class scanned five times before is announced, which was reasoned
  about, not played with. A commander new to exploration may still hear many.
  _Check:_ play an exploration session and see whether the callouts come too often.

## Window title bar

- **Frameless window behaviour.** The window is `frame: false` and the HUD header is its title bar.
  The buttons were seen drawn in a running dev build, but dragging by the header, double-click to
  maximize, Aero Snap, resizing from the edges and the maximize/restore icon swap weren't tried.
  _Check:_ drag the window by the header, double-click it, snap it to a screen edge, resize it
  from each edge, and maximize/restore with the button; the icon should follow each change.

## FSS Exobio Overlay (EDHM)

- **It shows at all, in the right place.** The band positions were measured from the FSS-Overlay
  mod's own texture, and the `.ini` was written from scratch; neither has been seen in the game.
  _Check:_ install it from the Settings tab, open the FSS, and look for the green MR / HMC / R /
  I / RI bands over the left half of the frequency bar, on each graphics quality.
- **Brightness at 50%.** The strength was a guess from the original's colours.
  _Check:_ in the FSS; change `OPACITY` in the generator script, or `w6` in EDHM-UI.
- **EDHM-UI reads our `.json`.** It was written by hand from the FSS-Overlay mod's shape, with only
  our own options and no `types` or `dependencies` (EDHM-UI deletes dependencies with a mod).
  _Check:_ open EDHM-UI's 3rd party mods window; FSS-Overlay-Exobio should list with its thumbnail,
  a toggle, a brightness slider and a key binding that saves into the `.ini`.
- **Only Steam's install layout was seen.** `EDHM-ini` and `ShaderFixes` were junctions into
  `~/EDHM_UI`; Epic and Frontier installs, and EDHM without EDHM-UI (not found at all), weren't.
- **The theme's main colour.** Read from `ThemeSettings.json`, which EDHM-UI writes when it applies
  a theme; the most used colour among elements in "Custom Color" mode, greys left out. Seen only
  with RAPTOR (`#83ffe3`, shown in the app). A theme edited in-game with EDHM's hotkeys, or one
  applied by something other than EDHM-UI, may not update that file.
  _Check:_ apply a differently coloured theme in EDHM-UI; EDSSI should change colour within a few
  seconds, and turning "Match HUD colour" off should bring back the default orange.

## Ships tab

Checked: all 340 `Loadout`s in one commander's journals (8 hulls, including the Panther Clipper
Mk II, Caspian Explorer, Type-9 and Krait Phantom) fit EDSY's slot tables with no slot left over,
and an exported Panther opened in both EDSY and Coriolis.

- **Slot names of slots never filled.** EDSY's `slotnames`, and its pattern for the rest, only
  meet the journal where something was fitted; an empty slot's name is EDSY's word. A mismatch
  shows as a fitted module marked "Not in EDSY" beside an empty slot that is really the same one.
  _Check:_ fit something in a slot that has only ever shown empty, and look for that tag.
- **Hulls EDSY lists that nobody here flies.** Only 8 hulls were checked against real loadouts.
  _Check:_ the same, in any other ship.
- **The shipyard list as the whole fleet.** Ships missing from `StoredShips` (and not being
  flown) are dropped, on the belief that it lists every ship owned, remote ones included.
  _Check:_ own ships in several places, open a shipyard, and see they all stay on the tab.
- **Cosmetic slots.** `layout.ts`'s `COSMETIC_SLOT` leaves out paint, decals, voice, cockpit,
  cargo hatch, the approach suite, ship kits and a few more by name; a new kind of cosmetic slot
  would show up as an optional internal with no size.
  _Check:_ a ship with every kind of livery fitted.
- **Stock fits and prices.** EDSY's stock fit matched the first `Loadout` after buying a Panther
  Clipper Mk II and a Caspian Explorer module for module, and its retail price matched what was
  paid, to the credit; no other hull's stock fit has been compared with the game.
  _Check:_ buy any other ship and compare the Ships tab's Stock tags with its first loadout.
- **CSV save.** The save dialog and the file it writes were covered by tests only.
  _Check:_ press CSV on the Ships tab and open the file in a spreadsheet.

## Materials

Checked against the local journals: synthesis, engineering rolls and experimental effects all
matched a recipe, and the Materials/cargo/locker counts were read. Not yet seen:

- **Ship locker contents.** The local journals only have empty `ShipLocker` lists, so reading
  Odyssey resources (and matching `UpgradeSuit`/`UpgradeWeapon` crafts) is untested. It assumes a
  `ShipLocker` line with lists, or `ShipLocker.json`, always carries the whole locker.
  _Check:_ with goods, assets or data in the locker, the suit and weapon recipes should show them.
- **Counts drifting between logins.** Ship materials are counted from `Materials` plus each change
  since. Anything that moves materials without one of the handled events (collected past the cap,
  a change we don't know about) drifts until the next login's `Materials` list.
  _Check:_ after a long session, compare a few counts against the game's Materials screen.
- **Technology broker and suit/weapon names.** No `TechnologyBroker`, `UpgradeSuit` or
  `UpgradeWeapon` lines locally; EDDiscovery marks several broker unlocks as `unknown`, so those
  are matched by their ingredients only.
  _Check:_ unlock something at a broker and upgrade a suit; each should appear in Crafting history
  under its recipe's name.
- **Recipe data.** Recipes are EDDiscovery's (pinned commit), which lags the game after an update.
  Engineer unlock requirements aren't included. It files the mine launcher's four blueprints
  and three canister experimentals under life support; the generator moves them (`MISFILED`),
  judging by their engineers (Juri Ishmaak, Liz Ryder, Petra Olmanova) and life support taking no
  experimentals. _Check:_ the mine launcher's blueprints at one of them
  should match High Capacity Magazine, Light Weight Mount, Rapid Fire and Sturdy Mount.
- **Material trader rates.** `tradeRate` in `src/shared/crafting.ts` assumes six of a grade for
  one of the next up and one for three of the next down within a family, and across families
  six for one at the same grade with the same steps from there (so 36:1 up a grade, 2:1 down one,
  2:3 down two). Remembered from the game, not read from it; the Missing page's trades are only as
  right as these. _Check:_ at a trader, compare a few offers in each direction, same family and
  not, against what the Missing page suggests.
- **Guardian and Thargoid materials can't be traded.** Their families are left out of trades and
  marked "No trade" in the inventory. _Check:_ a trader's lists shouldn't offer them.
- **Grade slots.** The inventory's caps are 300/250/200/150/100 by grade, for every family.
- **Syntheses counting down.** A live `Synthesis` counts down the first synthesis to-do of that
  recipe and grade still wanting one (blueprint rolls aren't tracked). Only tried with lines
  written by hand. _Check:_ with an AFM refill on the list, synthesise one; it should tick down.
- **Engineer standing.** The Blueprints page picks "most suitable" from `EngineerProgress` (rank
  once `Unlocked`, else not), matching the journal's names to EDDiscovery's with nicknames left
  out (`Tod 'The Blaster' McQuinn` is `Tod McQuinn`). Odyssey engineers' progress and a rank
  update without `Progress` are assumed to keep the last `Progress` seen.
  _Check:_ the engineer shown beside a blueprint should be one you can use at that grade.
- **Rolls.** Every grade is planned maxed, as Inara plans it. The journal agrees: at rank 5 a
  roll fills 1/grade of it (Felicity Farseer: G1 in 1, G2 in 2 … G5 in 5); at a rank equal to the
  grade a fifth, the engineer ranking up on the third roll and the last two filling a quarter each,
  five rolls in all (Professor Palin, ranks 1 to 5). A rank between (e.g. G1 at rank 3) is taken to
  fill 1/(5 − (rank − grade)) a roll, which fits Palin's G1 at rank 2 but wasn't seen further off.
  The wiki says a grade needn't be maxed to move on; the commander never tried it (68 of 68 grades
  maxed first), and the plan doesn't count on it. _Check:_ engineer at an engineer of rank 3.
- **Engineer workshops.** Systems, bases, planets, coordinates and unlock requirements are
  EDDiscovery's (`Engineers.cs`, same pinned commit), shown on each blueprint with the distance
  from the commander's last `StarPos`. _Check:_ a few against the galaxy map.
- **Importing builds.** EDSY's SLEF export was read from its source (`exportSLEF`) and Coriolis'
  SLEF and detailed build from its serializer and test fixtures; a SLEF made from a real `Loadout`
  was pasted into a scratch EDSSI. A real export copied out of either site wasn't. Coriolis'
  detailed build names hulls its own way (`Federal Corvette`), so it may find no ship of yours
  to compare with where SLEF would. The sites' own share links (`edsy.org/#/L=`,
  `coriolis.io/outfit/…`) aren't read; the dialog says to use Export instead.
  _Check:_ build a ship in EDSY and in Coriolis, Export → SLEF, paste each into Import a build.
- **Coriolis' blueprint names.** Coriolis names the generic blueprints after the module
  (`LifeSupport_LightWeight`, `AFM_Shielded`, `Scanner_LongRange`) where EDDiscovery and EDSY
  have `misc_lightweight`, `misc_shielded`, `sensor_longrange`; the importer falls back to those.
  Which spelling the game's own `Loadout` uses for them isn't known (no such module in the
  commander's journals). _Check:_ engineer a life support light-weight and read its `Loadout`.
- **Grades already fitted.** A build's module is compared with the commander's ship of that hull
  (the one flown, else the last seen) in the same slot, else any such module with that blueprint.
  A module with another blueprint starts from G1. _Check:_ import a build of a ship you own and
  have partly engineered.
- **Material traders from Spansh.** `material_trader` (Raw/Manufactured/Encoded) was searched
  around Sol and around a real system from a scratch EDSSI; whether Spansh's answer is current
  after a station's economy changes (which changes its trader) isn't known.

## Commodities tab

The Spansh requests were tried from a script and from a scratch EDSSI (search, plan, minimising
planetary markets) around Sol; the tab was looked at in a running app. Not yet seen:

- **Bought going up in the game.** A live `MarketBuy` adds its `Count` to the first line of that
  commodity still short, naming the journal's `Type` through EDDiscovery's table (else
  `Type_Localised`) and comparing names without case or punctuation. No purchase was made to see
  it. _Check:_ with Steel on the list, buy some; its Bought should rise by the tonnes bought.
- **Market names matching.** Assumed Spansh's commodity names and EDDiscovery's differ at most in
  case and punctuation (e.g. "Liquid oxygen"). A commodity named quite differently would be
  searched fine but never counted as bought. _Check:_ buy one each of a few colonisation goods.
- **Supply.** Plans take Spansh's last reported supply at face value, which may be days old; a
  station can have sold out. Only markets reported in the last `Market age` days are searched.
- **Fewest stops.** The plan only sees stations that turned up in the nearest-25 and cheapest-25
  searches for each commodity, plus the nearest 25 stocking all of it, so a better hub further out
  can be missed. _Check:_ compare a plan with Inara's or Spansh's own search for a hub.
- **Carrier docking.** Carriers are kept only with `carrier_docking_access` of `All`.
- **Pinned plan and MarketID.** Purchases count against the pinned plan's stop whose Spansh
  `market_id` equals the `MarketBuy`'s `MarketID`; tested with a `MarketBuy` line written by hand,
  not a real purchase. If Spansh's id ever differs from the game's, a purchase there still counts,
  just against the plan's first stop with that commodity. _Check:_ pin a plan with two stops
  selling the same commodity and buy at the second; that stop's line should fill first.
- **In this system and Market.json.** The last `Market.json` the game wrote stands in for Spansh's
  record of that station while its `StarSystem` is the current one, with items named `$steel_name;`
  mapped through EDDiscovery's table. Seen once, in a colony system; a fleet carrier's market and a
  non-English client aren't. _Check:_ open a carrier's market with something on the list, then
  Check; it should show "seen" with the time the market was opened.
- **The Sell page.** Written from the Search page's requests, never sent to Spansh: each
  commodity is a `marketplace` item with `demand >=` that chip's tonnes (at least 1), and Best price
  sorts by `market_sell_price` of the first commodity, `desc`. Assumed Spansh takes `demand` and a
  descending market sort as it takes `supply` and the ascending buy-price sort. Markets whose
  demand is 0 are left out, though the game may still buy there at a lower price; carriers
  reporting a demand of 1 (as for Tritium) will show. _Check:_ search Gold with Best price and
  compare the top rows with Inara's commodity search, selling.
- **Selling from a hold.** The Sell page's From hold reads the ship's hold from `Cargo.json` (only
  while its `Vessel` is `Ship`; in the SRV the ship's hold shows empty) and each carrier's from the
  tracker's cargo, which only counts what the commander's own journals moved. Mission cargo and
  stolen tonnes are left out, taken to be unsellable at an ordinary market. "Brings in" is the
  price times the tonnes picked, though the price falls once more is sold than the market wants.
  _Check:_ with stolen goods aboard, compare what the dialog offers with the game's market.
- **Splitting a sale between markets.** Plans take Spansh's last reported demand as what a market
  will take, as buying takes supply; selling past demand in the game only lowers the price, so a
  plan may stop more often than it needs to. Never run against Spansh. _Check:_ split a load of a
  few commodities and compare the stops with the Sell page's single-commodity results.

## Session strip (Mission tab)

- **A sale cashes in everything.** The tally takes data and vouchers off again when the ship is
  lost, but treats any sale of exploration data (or organic data, or bounties) as clearing all of
  that kind. After a partial Universal Cartographics sale followed by a death, the strip would take
  off too little. Bounty vouchers and combat bonds share one bucket, so cashing in one clears both.
  _Check:_ sell part of the cartographic data, die before selling the rest, and compare the trip's
  "lost" with the ship loss the journal shows for that death.
- **Live play.** Checked on real journals with the game running, but only for a few minutes of a
  session. Time played only moves on with journal lines, so it can lag during a quiet supercruise.
  _Check:_ leave the Mission tab open through a long session and compare with the in-game clock.

## Spoken body names

- **Moon letters are spelled out.** Before an answer goes to the voice, `forSpeech`
  (`src/main/ai/pronounce.ts`) turns a body designation such as "2 h" into "2 aitch", since the
  voice read it as "two hours". Letters are written as their names ("ay", "double-you"), which has
  only been reasoned about, not heard, on Inworld's voices. A unit written as a
  lowercase letter after a small number ("5 m") would be spelled too.
  _Check:_ ask about a system with moons "2 a" and "2 h" on a few voices, and listen.

## "Surface the app"

- **Raising EDSSI over the game.** `src/main/surface.ts` turns always-on-top on, shows, raises and
  focuses the window, then drops topmost again 300 ms later, because Windows refuses
  `SetForegroundWindow` to a process that doesn't own the foreground. This is ported from
  OverLooker, where it is known to work, but hasn't been tried against Elite Dangerous: a borderless
  full-screen game may need the window left topmost for longer, and exclusive full screen may not
  give way at all.
  _Check:_ with the game in the foreground (borderless, then exclusive full screen), say "surface
  the app" and see whether EDSSI comes up and stays up; then check it is no longer pinned above
  other windows once it has.

## VR cockpit (prototype)

- **Process names for the gate.** `vr/gate.ts` takes SteamVR to be running while `vrserver.exe`
  is, and the game while `EliteDangerous64.exe` is (the executable for Odyssey and Horizons alike),
  from memory rather than from a check on this machine.
  _Check:_ with `vr.enabled` on, start SteamVR and the game in either order; `[vr] SteamVR and the
game are running; starting the cockpit` should appear within five seconds of the second, and
  `stopping the cockpit` within five of closing either.
- **No headset is `unavailable`.** The host now reports `OpenVR.Init` failing as `unavailable`
  rather than `error`, so it is quiet without `EDSSI_VR_LOG=1`. Needs `npm run vr:build`.
  _Check:_ start SteamVR with the headset unplugged; the log should say nothing about the overlay.
- **The main panel's Commodities tab.** The tab strip was seen in a `vr:shots` capture, on
  Mission; the capture's window never leaves Mission and its scratch database has no pinned plan,
  so the Commodities page (the pinned plan, no Unpin) and the switch following the window's tab
  were not seen.
  _Check:_ pin a shopping plan, open the Commodities tab in the window and look at the main panel;
  then open any other tab, which should bring Mission back.

The cockpit has now been seen working in a headset: five panels and four seam lines up, steady,
showing what they are drawing as they draw it. What that took, and what it cost to find, is in
`docs/vr.md` — the short of it is that a frame has to be submitted as a `DXGISharedHandle` and not
as an `ID3D11Texture2D`, and that everything else was a symptom of getting that wrong.

Everything up to SteamVR has been checked without a headset: the framing and the BGRA→RGBA swizzle
round-trip through the real encoders (`vr-overlay-host.exe --selftest` now reports each frame's
panel), all five panels' placements go down the pipe and come back correct, the geometry in
`transform.ts` is unit tested (every default panel provably aims back at the commander), the host
binds the installed runtime's `openvr_api.dll`, and an offscreen transparent window paints
`width × height × 4` bytes with the background's alpha intact. What follows needs a headset.

- **Letting go when EDSSI is killed.** The host watches the pid it was given and exits when that
  process goes; checked with a stand-in parent killed outright, without SteamVR. What hasn't been
  seen is the same thing with real overlays up — that the keys are actually released in time for the
  next EDSSI to claim them rather than being held by a dying process.
  _Check:_ start the cockpit, kill EDSSI from Task Manager, start it again; all five panels should
  come up rather than reporting `KeyInUse`.
- **Whether the layout is comfortable.** The side panels sit at ±1.02 m and 24 cm closer than the
  main one, so reaching them is a head turn rather than a body turn; the strips are 26 cm and 30 cm
  tall. Those numbers are reasoned about, not looked at.
  _Check:_ sit in the cockpit and see what has to move. `Control+Shift+Tab` switches the move keys
  to the panel being looked at.
- **Gaze picking the right panel.** The host picks the panel nearest the line of sight, within a
  cone of about 37°. Panels that overlap from where the commander sits could make this jumpy, and
  there is no on-screen mark saying which one is picked.
  _Check:_ switch to panel scope, look at each panel in turn and nudge it; the one you are looking
  at should move.
- **The seam lines.** Four quads, 2 mm thick, hung in the gaps between the main panel and the ones
  hinged to it, each running the edge it trims bar the fade at either end, drawn in the EDHM
  accent. Whether stopping at the fade reads as the line matching the panel or as it being short
  is the first thing to look at. The geometry is unit tested — they provably sit at the midpoint
  of each gap and split the fold — but 2 mm at 1.45 m is about a twelfth of a degree, which is one
  or two pixels on the headsets of the day: whether that reads as a clean line, as a row of dots,
  or as nothing at all cannot be settled from a capture. Nor can whether SteamVR takes a texture
  only a pixel or two across.
  _Check:_ look along each seam. Too faint or too ragged, raise `seams.thickness` in
  `~/.edssi/vr-overlay.json`; the whole set goes away with `seams.enabled: false`.
- **The gaze ignores the seams.** Each seam is sent with `gaze: false`, so the host skips it when
  picking what the tuning keys act on — its middle sits exactly where the eye passes going from one
  panel to the next, and without this a glance across the cockpit would land on a line.
  _Check:_ switch to panel scope, look slowly from the main panel to the sidebar and nudge; the
  panel you end on should move, and nothing should happen while crossing the gap.
- **The faded backing.** The slab is a masked layer that fades out over the last `fade` metres
  (2 cm) at each edge, so the panel ends in the starfield rather than against it. It has only been
  seen on a flat capture, where it looks right; against a bright starfield the fade may simply read
  as the panel being too small, and text near an edge may lose its backing sooner than expected.
  _Check:_ fly somewhere bright and read the edges of the Mission panel. `fade: 0` per panel puts
  the hard edge back.
- **The strips' cells follow `background`.** The route and stats strips have no slab, so that key
  now sets how solid their cells are (0.88 by default, which is what they were fixed at before).
  Whether the range is useful at the bottom end — a strip of nearly transparent cards over a
  starfield — has not been looked at.
  _Check:_ `Control+Shift+9` while looking at either strip and see where it stops being readable.
- **Whether the seam lines still blink.** They are still sent as pixels, because a line is one
  flat colour that is sent once and never again — so `SetOverlayRaw` is called for them about as
  often as the commander changes the cockpit, rather than fifteen times a second.
  _Check:_ the lines should sit still while the panels update.
- **A blank panel asking for a frame.** The host sends `want <panel>` every second until one of that
  panel's frames reaches SteamVR, and EDSSI repaints it by changing the page (`paintAgain`):
  `invalidate()` on a shared-texture window paints with no texture, so it never delivered one.
  Seen in a headset: with the cockpit switched on mid-session, only the panel that happened to
  change came up, and Comms appeared on push-to-talk. That the nudge fixes it was checked against
  a real offscreen window (it hands over a texture every time; `invalidate()` never did), not yet
  in the headset.
  _Check:_ with SteamVR and the game running, switch `vr.enabled` on. All five panels should come
  up within a second or two; with `EDSSI_VR_LOG=1` the log may say which were asked for (`the host
has nothing to show yet`), but none should stay blank.
- **Scrolling.** Precise wheel events are sent to the middle of the panel being looked at, stepped
  at 60 fps by `vr/scroll.ts`. It has been checked against a real offscreen window that each event
  moves the page by exactly its pixels, on that frame, and that the physics never stalls between
  the notch and the glide. Still unchecked: whether the page under the middle of each module
  actually scrolls (that module has to have something to scroll), whether it looks smooth in the
  headset (the host passes on every frame, but a panel at 60 fps has never been watched there), and
  whether the numbers feel right: a notch of 4 lines, 4 to 30 lines a second held, the glide after
  220 ms. They are `SCROLL_NOTCH_REM`, `SCROLL_SPEED_REM` and `GLIDE_AFTER_MS`.
  _Check:_ tap and hold `Control+Shift+PageUp`/`PageDown` while looking at a full Mission panel,
  then push a bound ministick a little and all the way.
- **The cockpit coming back by itself.** Hiding it took effect at once and was written to
  `vr-overlay.json` `SETTLE_MS` later, while the file was polled every `WATCH_INTERVAL_MS` — so a
  poll landing in between read the state from before the press, found it differed, and applied it.
  The cockpit reappeared a second after being hidden, which from a headset is indistinguishable
  from the button having fired twice. `reload` now leaves the file alone while a save of our own is
  pending. Seen in the log and fixed; the cockpit behaved afterwards, but only for a few minutes at
  the desk.
  _Check:_ hide the cockpit and wait a few seconds. `[vr] the cockpit was edited by hand; applied`
  in the log without anyone having edited it means it is back.
- **Stick bindings reaching the cockpit.** `vr.bindings` is read at startup and rebound whenever
  the settings file is saved, which is how a button bound from the desk starts working without a
  restart. Checked only that it binds; not that a save while the cockpit is up in a headset carries
  through.
  _Check:_ with the cockpit up, bind a button on the Settings tab and press it.
- **The panels' own layouts at these shapes.** The modules were built for a 1280x800 window. The
  route and stats strips are far wider than they are tall, and the side panels far narrower.
  _Check:_ look for clipping, and use the size keys to find shapes that work.
- **Frame cost with five panels.** A frame is now a handle rather than pixels, so what it costs is
  one GPU-to-GPU copy per painted frame rather than megabytes down a pipe; offscreen windows only
  paint on change.
  _Check:_ watch EDSSI's CPU with the whole cockpit up while flying.

- **Which way the rotation keys turn it.** The yaw/pitch/roll signs in `VR_COMMANDS`
  (`src/main/vr/layout.ts`, over the axes in `rig.ts` and `panels.ts`) follow the right-handed
  convention on paper; whether
  `Control+Alt+Shift+Left` actually turns the panel left is a guess.
  _Check:_ press each rotation key; if one goes the wrong way, swap the two bindings in
  `~/.edssi/vr-overlay.json` and then fix `DEFAULT_KEYS`.
- **Premultiplied alpha.** The host sets `VROverlayFlags.IsPremultiplied` because Chromium's bitmap
  is premultiplied. If the translucent background comes out ringed with dark edges, that flag is
  wrong for this path.
  _Check:_ look at the edge of the panel against a bright starfield.
- **Whether the overlay draws over Elite at all.** Elite uses OpenVR natively, so a SteamVR overlay
  should composite over it. A commander running OpenComposite has no SteamVR, and would see
  nothing.
  _Check:_ open the panel in the cockpit rather than in the SteamVR void.
- **The default chords don't collide with the game.** `Control+Shift` plus an arrow or a
  punctuation key (and the same with `Alt` for turning) is assumed to be free in Elite's own
  bindings. The low-level hook observes rather than swallows, so the game sees every one of these
  presses too, and will act on any it has bound.
  _Check:_ press each adjustment key in the cockpit and watch for anything happening in-game; move
  whatever collides in `~/.edssi/vr-overlay.json`.
- **Frame cost.** 1280x800 at up to 15 fps is ~61 MB/s down a pipe when the panel is animating, and
  the panel can be grown to 2560x1600, which is four times that. Offscreen windows only paint on
  change, so this should be near idle for a page of text, but it hasn't been measured while flying.
  _Check:_ watch EDSSI's CPU while the panel is up and the session strip is ticking, at the default
  size and at the largest.
- **Resizing the panel while it is up.** `setContentSize` on an offscreen window does change the
  size of the frames it paints (checked standalone, up to 2560x1600, including on a 1.5x display).
  What is still assumed is that SteamVR copes with a texture that changes shape between one
  `SetOverlayRaw` and the next: the host now lets go of the old texture with `ClearOverlayTexture`
  first, and reads the error `SetOverlayRaw` returns instead of dropping it, so a refusal says so.
  _Check:_ press the size keys with the panel up and watch the log. `SteamVR refused a WxH frame`
  means the runtime won't take it; silence means it did.

## Shopping list from colonisation screenshots

- **The model reads the panel right.** Only checked against a scripted answer, never a real
  model and real screenshots. The instructions assume the panel's number is the tonnes still
  needed, and that a row showing several numbers has one headed as what is still needed.
  _Check:_ import a few screenshots of a construction site's list, including two that overlap after
  a scroll, and compare the dialog's list with the panel.
- **The ChatGPT (Codex) backend takes images and a request with no tools.** `requestBody` leaves out
  `tool_choice` when there are no tools; the OpenAI API accepts that, the Codex backend is assumed
  to.
  _Check:_ with `assistant.provider: codex`, read a screenshot; an error in the dialog names what
  the backend refused.

## The redesigned window (Sept 2026)

Checked against screenshots of a scratch EDSSI replaying real journals at 1446×1255 and 1620×1011.
Not checked:

- **VR panels at their real density.** The components are drawn in the window's pixels and scaled
  by `--vr-zoom` (the panel's type size over 20 px), set by the main process. Only looked at in a
  flat window at 1.25×. _Check:_ `npm run vr:shots`, then in the headset: the type the size it was,
  nothing cut off at the strips' edges, the side panel filling its panel.
- **Station services' names.** The side panel's Station block names `commodities`, `shipyard` and
  `outfitting` from `Docked.StationServices`. _Check:_ dock at a large station and compare.
- **Cargo in the hold.** Read from `Status.json`'s `Cargo`, which the game only writes in some
  states. _Check:_ dock with cargo aboard; the Station block should say `Cargo n / cap t`, or
  `Hold cap t` when the game hasn't said.
- **"Pinned" on the plan the pinned one came from.** Matched by kind, markets and quantities, so
  a plan run again from another reference with the same result also shows Pinned.
  _Check:_ plan, pin one option, plan again.
- **The In this system page with live results** and Comms with a real conversation were only
  drawn from mocked data. _Check:_ use each once for real.

## Carrier jumps to Discord

The events were checked against real journal lines; nothing has been posted to a real channel.

- **Discord takes the embeds.** Built to match the SWS Carrier Tracker plugin's, less its `key`.
  _Check:_ fill in `carrier_webhook.webhook_url`, press Send Test Alert on the Uploads page, then
  schedule and cancel a carrier jump.
- **Squadron carrier jumps.** Whether a member who didn't schedule the jump gets a
  `CarrierJumpRequest` in their own journal, which would post it too (the plugin would as well).
  _Check:_ have another member schedule the squadron carrier's jump while you are in game.

## Carrier departure warning

`DepartureTime` and the `CarrierJump` that follows were checked against real journal lines; the
warning itself hasn't been heard in game.

- **Departure is when the carrier leaves.** The warning is timed a minute before `DepartureTime`;
  in the journals the `CarrierJump` lands about a minute after it, which reads as the jump's own
  tunnel. _Check:_ dock on your carrier, schedule a jump, and see whether the warning comes a
  minute before the countdown ends.
- **Another owner's carrier.** Nothing in a passenger's journal says when it jumps, so it isn't
  warned about. _Check:_ stay docked on someone else's carrier through a jump and look for any
  line before the `CarrierJump`.
- **Squadron carriers.** Warned about only if the member docked gets the `CarrierJumpRequest`
  (see above).
- **The side panel's countdown** was only checked in tests, not drawn in the running app. It
  counts to `DepartureTime` by this PC's clock, then says Departing until the `CarrierJump` (or
  three minutes). _Check:_ dock on your carrier, schedule a jump, and compare the Station block's
  countdown with the game's.

## Fuel the route will use

The drive formula was checked against jumps a real journal logged (it reads up to 2% over); the
side panel's two figures haven't been watched against the game's tank over a route.

- **Next jump** is the route's next leg on the fuel and cargo `Status.json` gives, supercharged
  when the star here is a neutron star (or a white dwarf and the jump is too long without it).
  _Check:_ note the figure, jump, and compare with the drop in the tank (or `FSDJump`'s
  `FuelUsed`).
- **Route** adds every leg left, the tank counted as filled whenever it wouldn't cover the next
  one, and a leg longer than a jump (a neutron CSV route's waypoints) as one full jump and the
  rest in equal ones. _Check:_ note the figure at the start of a plotted route and add up
  `FuelUsed` over it; then the same along a Spansh neutron route.
- **During a jump** both figures and the bar's sections stand as they were before the countdown
  (`StartJump`) until the arrival's `FSDJump`, since the tank drops in between. _Check:_ watch the
  bar through a jump on a route: only its filled end should move, the blue section emptying.

## Updates and releases

Verified on 2026-10-10 with the dev channel: `dev-v0.1.0-dev.1` and `.2` were built, signed and
uploaded by the workflow; an installed dev.1 found dev.2, downloaded it differentially over R2
(5.4 MB of 188 MB), accepted its signature, and "Restart and update" installed it silently and
started dev.2, which cleared the marker. dev.3 → dev.4 did the same from EDSSI Dev's own data
folder and download cache, and dev.4 showed "What's new" with its notes. dev.4 → dev.5 installed at the next start instead
(closed once downloaded, then started), before any service came up. Not yet seen:

- **The production job.** Only `build-dev` has run. The `v*` path (`npm run check` on the runner,
  the signature step, `latest.yml`, the GitHub release, the Discord post) hasn't.
  _Check:_ the first `v*` release.
