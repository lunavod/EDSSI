# The VR cockpit

Five panels of EDSSI hung in front of the commander as SteamVR overlays. A prototype: off unless `vr.enabled`
is on in `config.yaml` (the Settings tab's VR page), and then only up while SteamVR and the game
are both running — `src/main/vr/gate.ts` looks for `vrserver.exe` and `EliteDangerous64.exe` every
five seconds and starts or stops the whole cockpit with them. The code is `src/main/vr-overlay-service.ts` + `src/main/vr/`, the renderer's
`#vr/<id>` routes, and `tools/vr-overlay-host` (C#). CLAUDE.md has the architecture paragraph.

## Running it

```
npm run vr:build                         once, and after changing the C# host
npm run dev                              with vr.enabled on
```

The log stays quiet about the cockpit's comings and goings — panels shown and hidden, overlays
made, frames going through, SteamVR started with no headset — unless EDSSI is started with
`$env:EDSSI_VR_LOG = '1'`. Warnings and errors always print, and an error the host repeats on every
retry prints once.

Close any other EDSSI first — only one can own the overlay keys — and start SteamVR. Then
`Control+Shift+H` to summon the cockpit where you are looking.

A running EDSSI holds `out/vr-overlay-host/vr-overlay-host.exe` open, so `npm run vr:build` fails
to copy over it while the cockpit is up. It says so plainly (`the file is locked by
vr-overlay-host`), but the compile succeeds first, which makes it easy to read as a success and
then wonder why a change had no effect. Close EDSSI, build, start it again.

## The keys, and the stick

All of the keys are in `~/.edssi/vr-overlay.json`, which is the only place they can be rebound —
you can't be shown a settings screen with a headset on. The file is polled, so an edit applies
within a second.

|               | `Control+Shift`                    | with `Alt`           |
| ------------- | ---------------------------------- | -------------------- |
| arrows        | move the rig                       | turn it (pitch, yaw) |
| `,` `.`       | less / more opaque                 | roll left / right    |
| `[` `]`       | narrower / wider                   | shorter / taller     |
| `;` `'`       | less / more curve                  | coarser / sharper    |
| `9` `0`       | less / more backing                |                      |
| `-` `=`       | further / nearer                   |                      |
| `PgUp` `PgDn` | scroll the looked-at panel         |                      |
| `H`           | show / hide                        | world ↔ head lock    |
| `R`           | reset everything                   |                      |
| `P`           | pin it where you are looking       |                      |
| `Tab`         | move the rig ↔ the looked-at panel |                      |
| `Backspace`   | turn the looked-at panel off       |                      |

Stick buttons are the other way round, and so they live somewhere else: a control has no name to
write down, so the only way to bind one is to press it — which is a settings screen. The VR page of
the Settings tab lists every command; press **Bind a control** and then the button, the hat
direction or the ministick, and hold it for a moment. It is written to `vr.bindings` in
`~/.edssi/config.yaml`, keyed by the command's name (`scrollUp` or `scroll_up`, either spelling),
and the cockpit binds it afresh the moment it is saved.

The page lists what is bound rather than every command there is — a stick has two or three buttons
to spare and the cockpit has thirty-odd commands, so a row apiece is a page of nothing. **Rebind**
swaps the control and keeps how it is pressed; **Remove** takes it off.

Two things can be set per binding, because a stick has fewer buttons than the cockpit has commands:

- **Press once, twice or three times.** One control can carry three commands — a press shows the
  cockpit, a double click pins it where you are looking. Only a control that actually has a double
  or a triple bound waits `MULTI_CLICK_MS` to find out which it was; every other binding, and every
  key, runs the instant it goes down. The logic is `src/main/input/clicks.ts`, unit tested.
- **Repeat while held.** Off for everything except scrolling, which is on by default: a page is
  longer than one notch of a wheel. Moving and resizing deliberately don't repeat — a step per
  press is what makes them possible to aim.

`input.multi_click_ms` (the VR page of the Settings tab) is how long that window is, 280 ms by
default. It is worth knowing which way to move it: too short and a triple click arrives as a single
and a double, too long and every press of that control feels slow — and it only ever costs anything
on a control that actually has two or three presses bound.

An unmatched count falls back to the most presses anything on that control asked for: two taps on a
button carrying a single and a triple runs the single. Nothing at all would be indistinguishable,
from inside a headset, from the binding not working.

Scrolling glides rather than steps (`src/main/vr/scroll.ts`, unit tested). A tap scrolls one
notch, eased out over a few frames. Held, the page creeps at once and after `GLIDE_AFTER_MS` rises
to a speed set by how hard the control is held, and on release it comes to a stop over a few frames.
The service is told how hard the control is being held (1 for a key or a button, and how far past
its threshold an axis has gone), and a ministick is asked again every 20 ms, so easing it back slows
the page as it eases. Distances are in `rem`, the panel's line height, so a notch is the same number
of lines on every panel. While it moves, the panel being scrolled paints at 60 fps instead of 15. The
wheel events are sent with `hasPreciseScrollingDeltas`. Without that, Chromium animates each event
on its own clock and trails behind the glide; with it, the page moves by exactly the pixels sent, on
that frame (measured against a real offscreen window). The VKB EVO's ministick reports as `Rx`/`Ry`
when its LED is one colour and as the `Hat switch` when it is the other — pressing it swaps modes —
and both bind the same way, since the binding names the control the device itself declares.

## The backing, and the trim

Two different things fade, and they are worth keeping apart:

- **`alpha`** (`Control+Shift+,` / `.`) is the overlay's own, in the compositor. It fades the whole
  quad, words and all.
- **`background`** (`Control+Shift+9` / `0`) is what the panel paints behind its words, and leaves
  them as bright as they were. On the main panel and the two sides that is a slab; the strips have
  no slab — a black bar across the cockpit is worse than a bright one — so theirs sets how solid
  each of their cells is instead. One key, the same meaning either way: how much of the cockpit
  this panel hides.

The slab fades out over the last `fade` metres before each edge, so a panel ends in the starfield
rather than against it. Set it to 0 for a hard edge. It is in metres, like everything else here,
and the padding is in `rem` so the words always clear it whatever density the panel is drawn at.

The accent lines in the gaps are **seams**: real quads, hung halfway across the gap in the plane
that splits the fold, one per edge that has a panel hinged to it. They are not pages — a seam is a
texture of one flat colour made in `seams.ts` — and they are never what the tuning keys act on, so
looking at the gap between two panels leaves the gaze where it was. Each runs the length of the
edge it trims — as tall as the panels on the sides, as wide as them above and below — less the
`fade` at either end, because that is where the backing stops and a line carrying on past it would
end in mid-air. No key binds them; `seams` in `vr-overlay.json` has `enabled`, `thickness`,
`length` and `alpha`.

## What the panels leave out

A headset has no pointer, so anything that must be clicked or typed into is left out rather than
shown greyed. The Comms panel is the worked example (`vr` in `CommsView`): no question box, no mic
button, no Stop/New, no setup chips, no source links, and a tool call is one line instead of a
disclosure. In their place is a single status line — listening, thinking, speaking — which is the
only thing that panel is for in flight. The stats strip hides its period chips the same way. The
copy buttons beside system names are gone too: `VrPanel` provides `InVr` (`vr/in-vr.ts`), and
`CopyButton` draws nothing under it. That context is the way to reach a control buried several
modules deep without passing a prop through each. The Mission tab's sort chips have not been done
yet.

The main panel has tabs of its own, but nothing in a headset presses them: it shows whichever tab
the window on the desk is on (the window reports it with `ui.setTab`, and the main process keeps
and broadcasts it), falling back to Mission for a tab with no VR version yet. `VR_TABS` in
`VrPanel.tsx` lists those that have one; so far only Commodities, which shows the pinned plan and
nothing else. The panels around it stay the same whichever tab is up.

## How a frame reaches SteamVR

The panels paint with `useSharedTexture`, so a frame never leaves the GPU: EDSSI sends the host an
NT handle and the host opens it and hands SteamVR the texture. The handle belongs to EDSSI's
process, which is the second thing `--parent` is for — the host duplicates it across.

**Submit the handle, not the texture.** `SetOverlayTexture` takes an `ETextureType`, and the
difference between the two that look right is the difference between a cockpit that works and one
that does not:

- `DXGISharedHandle` — the legacy shared handle of one of our own textures, from
  `IDXGIResource.SharedHandle`, which is what `MiscFlags.Shared` is for. The compositor opens the
  surface itself and reads what is in it. This is the one to use.
- `DirectX` — a pointer to an `ID3D11Texture2D`. It is accepted, it reports no error, and the
  panel appears: but the pointer belongs to _this_ process's device, and the compositor runs in
  `vrcompositor.exe`, so it has to copy the texture into a shared one of its own — on its
  schedule, not ours. That copy lands a frame late. Every panel then shows the frame before the
  one it was given, and a panel with nothing more to paint sits on a stale picture until something
  unrelated pushes it along.

That last paragraph cost an evening. The symptoms point everywhere except at the submission: the
handle is current, the copy provably holds the frame that was just painted, no call returns an
error, and the panels report themselves shown. Valve's own advice on it is in a forum thread
rather than the wiki.

The alternative is sending the pixels, and it is only a fallback. `SetOverlayRaw` rebuilds the
overlay's texture on every call, and rebuilding it while the compositor is drawing is what made
the cockpit blink whenever Comms said anything. `[vr] frames stay on the GPU` at startup says
which path is in use.

The host does not hand Chromium's texture to SteamVR. It copies it into one of its own first, and
that copy is the part to leave alone. Three devices are involved — Chromium renders the frame,
the host opens it, SteamVR reads it — and a `bgra` shared texture carries no keyed mutex, so
nothing keeps them in step or says the drawing has finished. Submitting a pointer into another
process's live render target is how a panel comes out empty with every call along the way
returning success.

The copy settles it: it is ordered against Chromium's writes by the driver, SteamVR gets a texture
nothing else will touch, and the frame goes straight back to Chromium. The destination is kept and
reused, so it is one blit and no allocation. `SetOverlayTexture` does not copy — it takes note of
the texture and the compositor reads it when it next draws — so that destination is held for the
life of the overlay.

EDSSI still holds each frame until the host answers `took`, which is now as soon as it has copied
it. Holding too many would run Chromium's pool dry and stop the panel painting, so past
`TEXTURES_IN_FLIGHT` the oldest is let go unanswered — and said so in the log, because EDSSI
outrunning the host is what makes a panel show something that stopped being true seconds ago.

The host keeps only the newest frame per panel, exactly as it does for pixels. Queuing them all
looks kinder — no frame is wasted — but a queue that grows is latency that grows, and nobody wants
to read a stale panel.

The seam lines still go as pixels. A line is one flat colour, sent once and not again, so there is
nothing for `SetOverlayRaw` to rebuild.

Handles are sent whether or not the cockpit is up, because a handle costs nothing to send and the
panel is then already right when it is summoned.

**A panel that has never had a frame asks for one.** A page paints only when something on it
changes, so a panel whose frames all went astray stays blank with nothing coming. Frames go astray
at startup: sent before the host was running or had made the overlay, or refused while SteamVR was
still starting. EDSSI repaints every panel when the host says `ready`, but that frame can be lost
the same way. Started a minute before SteamVR, the Comms panel stayed missing until push-to-talk
changed its status line, because the other panels soon repainted on their own and it didn't. So
the host sends `want <panel>` once a second for any overlay that has yet to take a frame, and EDSSI
repaints that panel, or sends a seam's colour again.

Repainting means changing the page, not `webContents.invalidate()`. In a window that shares its
texture, `invalidate()` fires `paint` with no texture at all — checked against a real offscreen
window — so for a page with nothing new to say, every `want` came to nothing. That went unseen
while the cockpit started with EDSSI, because replaying the journals kept every page changing;
started mid-session, with everything already loaded, all but one panel stayed blank until
something on it changed. `paintAgain` flips `--vr-nudge`, one pixel in a corner between two
shades that both come out transparent, and a page that has changed hands over a texture. Frames
are also no longer sent before the host says `ready`, since it has no overlays to put them on. `[vr] <panel>: the host has nothing to show
yet` in the log (with `EDSSI_VR_LOG=1`), once per panel, says it happened. Pixels are not: a frame is megabytes, so the
fallback path still waits until there is something to look at.

## When a binding misbehaves

`EDSSI_INPUT_LOG=1` prints every edge of every watched control and every action it runs:

```
[input] control:231d:0201::9:5:button:: down — 72ms since it was let go
[input] toggle ran (VKBsim Gladiator EVO L · button 5)
[input] control:231d:0201::9:5:button:: up
```

The gap is the whole answer. A few milliseconds is the control bouncing or a report that doesn't
carry it — `BOUNCE_MS` in `input/service.ts` eats those — and a hundred is the commander pressing
twice. `npm run hid -- --presses` says the same thing from outside EDSSI, one line per edge with
the report id it came from; the `--` matters, or npm swallows the flag.

Both were written for one bug and are worth reaching for before theorising about the next. What
they settled, in order: a press counted twice because the decoded control state was kept per
_device_ while `HidP_GetUsages` answers per _report id_ — the EVO L sends ids 1 and 12, so every
id-12 report said "no buttons are down" about id 1's buttons. Then a report that decoded to nothing
at all being taken for "everything is at rest". And then the one that was never the stick: see the
layout file, below.

## When something is wrong in the headset

A panel's page has no devtools anyone can open, so whatever it says to its console is forwarded
into EDSSI's log as `[vr:<panel>] …`. That is usually the quickest way in: the panels are the one
part of EDSSI nobody can look at directly, and several evenings went into guessing at their state
from the outside before this existed.

`vr-overlay-host.exe --selftest --parent <pid>` reads the same messages without touching SteamVR,
and opens each texture handle for real — reporting its size, format and a pixel sampled out of the
copy. It is how the GPU path is checked on a machine with no headset, and it is the difference
between "every call succeeded" and "the frame actually arrived", which this path has hidden before.

The host names what it does, and EDSSI prints it with a `[vr]` prefix: `<panel>: overlay created.`
and `overlay destroyed.` when the set changes, `<panel>: shown.` / `hidden.` when one goes up or
down, `<panel>: texture cleared for a new WxH.` when a frame changes shape, and
`SteamVR refused a <panel> frame: <error>` when an upload is rejected. Something going wrong with
none of those printed means the overlay is up, the right size and being fed — and the trouble is
in the handover itself.

## Seeing it without a headset

```
npm run vr:shots      photograph the five panels from a real EDSSI (your layout, your journals)
npm run vr:preview    draw the cockpit, and show those photographs with px-per-degree
```

`vr:shots` runs the app with its own scratch config, database and Electron user-data, picks journals
that contain actual play, and never touches SteamVR. `--defaults`, `--layout <file>`, `--live` and
`--seconds` are the flags worth knowing. This is how the layout was fixed without a headset; use it
before asking the commander to put one on.

## What is worth knowing before changing anything

- **The geometry is in TypeScript** (`transform.ts`), unit tested. The host only composes what it is
  given with the anchor it took from the head. Keep it that way — geometry guessed at in a headset
  costs a round trip every time.
- **The four outer panels are hinged to the main one.** Their places are derived, not stored: the
  sides take its height, the strips its width, and each folds about its seam. Resizing the middle
  carries the rest, the seam lines included.
- **A seam is placed and then turned, not folded.** The gap runs straight from the main panel's
  edge to the hinge the other panel turns about, so the middle of it is the midpoint of that run;
  folding a line out to reach it lands it on the arc instead. Turning it in place by half the fold
  leaves it in the middle while pointing it between the two panels. Both facts are unit tested.
- **Pixels follow metres.** `panel.ts` works a frame's size out from the panel's size in metres,
  and the service sets the page's root font size from the resulting density — so a line of text is
  the same physical height on every panel. Never size type in pixels here.
- **A binding is learnt by moving the control, never typed.** Windows has already parsed the
  device's report descriptor, so `native/hid-usages` can say "that was Rx, and it runs 0 to 1023"
  rather than EDSSI guessing which byte moved. What capture does is subtract: what is held now that
  wasn't when the screen started listening. The baseline is the whole of it — a throttle already
  sitting forward must not bind itself the moment the commander is asked.
- **EDSSI must not read the layout file back while it owes it a write.** A command applies at once
  and is saved `SETTLE_MS` later; the file is polled every `WATCH_INTERVAL_MS`. A poll landing in
  between read the state from before the press, found that it differed, and applied it — so hiding
  the cockpit brought it back a second later, which from a headset is indistinguishable from the
  button having fired twice. `reload` leaves the file alone while a save of its own is pending,
  and the settle timer clears its own handle so that question can be asked at all.
- **A rebind is not an input.** Saving the settings, or any edit to the layout, unbinds everything
  and binds it again; a tap already made and waiting to find out whether it is a double has to
  survive that. Click counters live by control in `input/service.ts`, not with the bindings.
- **The file only stores what the commander changed.** Everything else follows the defaults, so a
  better default reaches them without a reset. Writing the whole layout back froze the defaults and
  caused three separate "why hasn't that changed" bugs.
- **The host must never be left running.** It is told EDSSI's pid and exits when that process goes;
  an orphan holds the overlay keys and the next EDSSI silently shows a stale cockpit.
