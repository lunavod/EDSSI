# VR: what is left

Working notes, not documentation. Delete the sections as they land. `docs/vr.md` is the durable
description; this is only the unfinished half.

The commander asked for three things, and all three have landed: the cockpit is up in a headset,
steady, and showing what it draws as it draws it; the bindings are on the stick with click modes;
and the ministick scrolls. What is left is the smaller things noticed on the way.

## Done since: bindings on sticks, click modes, scroll on the ministick

Both of the commander's remaining asks have landed. What they came to:

- `native/hid-usages` (an N-API addon over Windows' `HidP_*`) says what a device's controls are and
  `src/main/input/usages.ts` decodes them; capture now **subtracts a baseline** — `pressedControls`
  answers what is held that wasn't when the screen started listening — so a button, a hat direction
  or a ministick all bind by being moved. `src/main/input/buttons.ts` is still there and still used,
  but only for a device Windows couldn't describe (the addon has to be compiled, and a packaged
  build doesn't carry it yet — see below). Delete it when packaging ships the addon.
- `InputService.hotkeys` is gone; `InputService.actions` takes named actions, each with any number
  of `BoundAction`s — a key chord or a stick control, `clicks` and `repeat`. It reports how hard a
  control is being held, and the settings screen's lights now cover every watched binding rather
  than only push-to-talk.
- Single / double / triple click is `src/main/input/clicks.ts`: pure, tested, and per _control_, so
  only a control that actually has a double or triple bound is ever delayed.
- `vr.bindings` in the settings file binds the cockpit's commands to those controls, and the VR page
  of the Settings tab writes it. The cockpit rebinds the moment it is saved.
- Scrolling repeats while held and scales with how far a ministick is pushed.

### What "the button fires twice" turned out to be

Three separate things, found in this order, all of which looked identical from the headset — the
cockpit hiding and then reappearing, and a triple click firing on two taps:

1. **Control state was kept per device, but `HidP_GetUsages` answers per report id.** The EVO L
   sends report ids 1 and 12 at about 68 a second between them; every id-12 report decoded as "no
   buttons are down" about the button living in id 1, wiping it, so the next id-1 report looked
   like a fresh press. `npm run hid` showed it in one line: `report id 1, 12`.
2. **A report that decoded to nothing at all** — HidP refusing it, or a short read — was still
   taken for "every control is at rest". Same effect, different path, which is why fixing the
   first only made it rarer.
3. **It wasn't the stick.** `EDSSI_INPUT_LOG=1` showed the cockpit coming back with no press
   anywhere near it: `run()` applies a command at once and saves the layout 500 ms later, the file
   is polled every second, and a poll landing in between read the state from before the press and
   applied it. EDSSI was overwriting itself with its own stale file.

The lesson is the same one the cockpit taught: two of these were settled by a measurement that
took ten minutes to write (`--presses`, `EDSSI_INPUT_LOG`), after an evening of plausible theories
about button chatter. Both are still here.

The first thing to try with hands on a stick is capture itself: bind `toggle` to a button and
see that it is the button you meant.

## Smaller things noticed along the way

- **Packaging.** Neither `out/vr-overlay-host/` nor `native/hid-usages/` is shipped; both are dev
  builds found by path. They would need to be `extraResources` like the EDHM mod. The host is no
  longer a lone exe either: `Vortice.Direct3D11` and its four companions sit beside it, so it is
  the folder that has to go, not the file. The addon matters beyond VR: without it a packaged EDSSI
  falls back to `buttons.ts`, which can learn a button but not a hat or an axis — so a ministick
  can't be bound at all there.
- **Dead controls in VR.** There is no pointer in a headset, so buttons are useless. The stats
  panel's period chips are hidden (`periods={false}`), the Comms panel leaves its own out, and the
  copy buttons are gone (`useInVr()` in `CopyButton`). The Mission tab's sort chips are still there
  doing nothing; `useInVr()` is the way to take them out.
- **Comms panel.** Now has a shape of its own (`vr` in `CommsView`): the question box, the mic
  button, the Stop/New links, the setup chips, the source links and the disclosure on a tool call
  are all left out, and the head is one status line saying whether the ship is listening, thinking
  or speaking. The microphone question is settled: it belongs to the window on the desk, and the
  panel uses `useListening`, which reports without opening anything. What is left is what happens
  when that window is closed and only the cockpit is up — nothing would be listening, and nothing
  says so.
- A hand-edit reloads the layout twice per save. The second is a no-op and cannot loop; ignored.
- In a real headset, check first whether gaze picks the panel the commander expects, because
  every tuning key depends on it.

## What the cockpit cost to get working

Worth reading before changing anything about how a frame reaches SteamVR, because every one of
these looked like a different bug and was not:

1. `SetOverlayRaw` rebuilds the overlay's texture on each call, so the cockpit blinked whenever a
   panel's content changed. Proved by freezing the frames — send one per panel and no more, and
   the blinking stops with them.
2. `useSharedTexture` hands over an **empty `image`** — the size has to come from the texture's
   `visibleRect`, and a window either shares its texture or paints pixels, never both.
3. Chromium's NT handle is local to EDSSI's process; the host duplicates it across with the
   `--parent` pid, which is the second thing that pid is for.
4. Frames were held back while the cockpit was hidden, which was right for megabytes and wrong for
   a handle: it starts hidden, so the panels' only paints were dropped and there was nothing to
   show when it was summoned.
5. The host queued handles without limit, so what the commander saw fell further behind every
   second. Newest-per-panel, like the pixel path always did.
6. **Submitting an `ID3D11Texture2D` instead of a `DXGISharedHandle`** — the one that took the
   longest by far. See `docs/vr.md`.

What made the difference in the end was measuring rather than reasoning. Two of those measurements
are still here and are the ones to reach for: `--selftest --parent <pid>`, which opens a real
texture and samples a pixel out of it, and the `[vr:<panel>]` console forwarding. The rest were
built for the evening and thrown away — a counter painted in the corner of a panel, a count of what
each panel painted and sent, a mode that sent one frame and then stopped. All three took minutes to
write and each settled a question that argument could not, so write the next one rather than
theorising.

## How to work on this

Use `npm run vr:shots` and `npm run vr:preview` before asking for a headset test — they catch
layout, legibility and clipping problems on their own, and every bug found that way saved a round
trip. Check the file sizes if a capture looks stale: a force-killed Electron can hold the scratch
folder and leave the previous run's PNGs in place, which gave two false results.

**`vr:shots` does not build.** It runs `electron .` against `out/`, so without `npm run build`
first it photographs the last build and looks entirely convincing doing it — which is one of the
two false results above. The same trap the other way round: a running EDSSI holds the host's exe
open, so `npm run vr:build` compiles and then fails to copy, and the cockpit goes on running the
old host. Both are worth a glance at the timestamps when a change seems to have done nothing.
