/**
 * The VR cockpit: five panels of EDSSI, hung in front of the commander as SteamVR overlays.
 *
 * A prototype, switched on by `vr.enabled` in the settings file, and run only while SteamVR and the
 * game are both running (`vr/gate.ts`). Each panel is an offscreen window rendering
 * one of the renderer's `#vr/<id>` routes, and every painted frame goes to `tools/vr-overlay-host`,
 * which owns the overlays themselves.
 *
 * Where everything hangs is worked out here rather than in the host (`vr/transform.ts`), so the
 * geometry can be tested without a headset; the host only composes it with the anchor it takes from
 * the head. Both the layout and the keys live in `~/.edssi/vr-overlay.json`, because the commander
 * is wearing a headset and can't be shown a settings screen.
 */

import { mkdirSync, unwatchFile, watchFile, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { app, BrowserWindow, type OffscreenSharedTexture } from 'electron';

import type { HudColor } from '../shared/edhm';
import { accentFor } from '../shared/hud-color';
import { actionKey, type BoundAction } from '../shared/input';
import type { VrSettings } from '../shared/settings';
import { isVrCommand, type VrCommand, VR_REPEAT_COMMANDS } from '../shared/vr';
import { vrOverlayPath } from './config/paths';
import type { SettingsStore } from './config/store';
import type { EdhmService } from './edhm-service';
import type { InputAction, InputService } from './input/service';
import { startOverlayHost } from './vr/host';
import {
  loadLayout,
  readLayout,
  saveLayout,
  SCROLL_COMMANDS,
  VR_COMMANDS,
  type VrLayout,
} from './vr/layout';
import { vrLog } from './vr/log';
import { panelPixels } from './vr/panel';
import { effectiveSize, type PanelPlacement, VR_PANEL_IDS, type VrPanelId } from './vr/panels';
import {
  frameMessage,
  type PanelState,
  type RigState,
  stateMessage,
  textureMessage,
} from './vr/protocol';
import { Scroller } from './vr/scroll';
import { DEFAULT_ACCENT, type Seam, seamPixels, seamsFor, solidFrame } from './vr/seams';
import { panelMatrix, seamMatrix } from './vr/transform';

/**
 * Frames a second, per panel. An offscreen window only paints when something changes, so this is a
 * ceiling rather than a rate; a panel of text has no reason to be near it.
 */
const FRAME_RATE = 15;

/** The window's type size, which the VR panels' components are drawn at before scaling. */
const WINDOW_REM_PX = 20;

/** How long to wait before trying the host again after it has gone — SteamVR may start later. */
const RETRY_MS = 10_000;

/** How long after the last adjustment the layout is written. */
const SETTLE_MS = 500;

/**
 * How often `vr-overlay.json` is looked at for changes made by hand. Polled rather than watched,
 * the way the settings file is: watching is unreliable on Windows, and a second either way is
 * nothing against the time it takes to type an edit.
 */
const WATCH_INTERVAL_MS = 1000;

/**
 * How often a scroll is stepped, and how often the panel being scrolled paints meanwhile. The
 * panels' usual `FRAME_RATE` is plenty for a page of text that changes now and then, and far too
 * few for one moving under the commander's eyes: at 15 a second a glide is a series of jumps.
 * Raised only for the panel being scrolled, and only while it moves.
 */
const SCROLL_FRAME_RATE = 60;

/**
 * How often a held scroll control is asked how hard it is pushed. As often as the input service
 * looks: a ministick eased back should slow the page as it eases, not a moment later.
 */
const SCROLL_REPEAT_MS = 20;

/**
 * How many of a panel's textures may be waiting on the host at once.
 *
 * Two is the resting number: the host keeps the one SteamVR is drawing and answers for the one
 * before it, so there is always one more here than has been finished with. The third is slack.
 *
 * Chromium draws into a small pool and stops painting when none of it is free, so a texture held
 * for an answer that never comes would silently freeze the panel. Past this many the oldest is let
 * go unanswered: SteamVR may still have been reading it, which is worth a torn frame — the
 * alternative is a panel that never moves again.
 */
const TEXTURES_IN_FLIGHT = 3;

/** How often to say that the host is falling behind, at most. */
const BEHIND_EVERY_MS = 5000;

/**
 * How tall a line of type is, in metres. The panels are drawn at whatever density their size and
 * the frame limits work out to — a short strip is forced to a higher one — so type fixed in pixels
 * comes out half the size on the strips as on the main panel. Fixing it in metres instead is what
 * makes every panel read the same, which is the only thing the commander cares about.
 */
const TYPE_METERS = 0.0325;

/**
 * Where to drop a PNG of each panel the first time it paints, for `npm run vr:preview`. Set by
 * `npm run vr:shots`, and off otherwise. The panels are captured from the running app rather than
 * drawn from made-up data, so what the preview shows is what the commander would actually read.
 */
function captureDir(): string | undefined {
  return process.env['EDSSI_VR_CAPTURE'] || undefined;
}

/**
 * How often each panel is written while capturing. On a clock rather than on `paint`, because an
 * offscreen window only paints when something changes — a panel still saying "reading journals..."
 * never paints again, so capturing on paint would freeze the picture at the emptiest moment there
 * has ever been.
 */
const CAPTURE_EVERY_MS = 3000;

export interface VrOverlayServiceOptions {
  /** The keyboard hook and the sticks, which are singletons: every binding comes through them. */
  input: InputService;
  /**
   * The settings file, for `vr.bindings` — the cockpit's commands on stick buttons. Left out, the
   * cockpit answers to its keys alone.
   */
  settings?: Pick<SettingsStore, 'current' | 'onChange'>;
  /**
   * The EDHM theme, for the seam lines' colour. The panels get it through the renderer's
   * `useHudColor`, but a seam has no page to read a CSS variable out of: its texture is a flat
   * colour made here, so the colour has to be known here too. Left out, the lines are drawn in the
   * default accent.
   */
  edhm?: Pick<EdhmService, 'hudColor' | 'onHudColor'>;
}

export interface VrOverlayService {
  /** The offscreen windows, so the app can tell them apart from the HUD's. */
  windows(): BrowserWindow[];
  stop(): void;
}

/**
 * Whether the panels are being captured for `npm run vr:preview`, which runs the cockpit at once
 * whatever the settings say and whatever is running: the panels have to be rendered to be
 * photographed, but nothing is hung in SteamVR while doing it — see `connect`.
 */
export function vrCapturing(): boolean {
  return captureDir() !== undefined;
}

interface Panel {
  id: VrPanelId;
  window: BrowserWindow;
  /** The pixel size it was last asked for, so a resize is only done when one is needed. */
  pixels: { width: number; height: number };
  /** What it last actually painted at, which can differ and is invisible in a headset. */
  painted: string;
  /** Which way its frames are going, said once: there is no telling from the host's side alone. */
  reported?: string;
  /**
   * Textures the host has the handles of and has not yet said it has finished with. Chromium owns
   * them and draws over one the moment it is released, so they are held until the host answers —
   * which it does one frame late, because SteamVR reads a texture after being handed it. Kept with
   * their handles rather than in order, so an answer is matched to what it is actually about.
   */
  holding: { handle: bigint; texture: OffscreenSharedTexture }[];
  /** The state of the page's `--vr-nudge` pixel; see `paintAgain`. */
  nudge: 0 | 1;
}

export function startVrOverlayService(options: VrOverlayServiceOptions): VrOverlayService {
  let layout: VrLayout = loadLayout();
  /** What the settings file binds to the cockpit's commands, which is where the sticks live. */
  let sticks: VrSettings['bindings'] = options.settings?.current().vr.bindings ?? {};
  let stopped = false;
  let host: ReturnType<typeof startOverlayHost> | undefined;
  /**
   * Whether the host has said `ready` and been sent the rig. Before that it has no overlays, and a
   * frame sent to it is thrown away; the panels are painted again once it is.
   */
  let hostReady = false;
  let retry: NodeJS.Timeout | undefined;
  let settle: NodeJS.Timeout | undefined;
  /** Which panel the host says is being looked at; every panel-level key acts on this one. */
  let gazed: VrPanelId = 'main';

  const panels = new Map<VrPanelId, Panel>();
  /** When the host was last reported as falling behind; see `sendTexture`. */
  let behind = 0;
  /**
   * Whether the host can open the textures the windows paint into: unknown until it says, and
   * false only once it has said it cannot. The panels are opened the sharing way to begin with,
   * because that is the way that works; a host that turns out not to manage it has them opened
   * again as plain offscreen windows, which paint their pixels instead.
   */
  let sharing: boolean | undefined;
  /** The host's last error since it was last up, so one repeated on every retry is said once. */
  let lastError: string | undefined;

  /** Says once how a panel's frames are reaching the host, and says again if that changes. */
  function report(panel: Panel, how: string): void {
    if (panel.reported === how) return;
    panel.reported = how;
    vrLog(`[vr] ${panel.id}: frames are going ${how}`);
  }

  /** Hands one of Chromium's textures back, so it can be drawn into again. */
  function release(texture: OffscreenSharedTexture | undefined): void {
    try {
      texture?.release();
    } catch (error) {
      console.error('[vr] a frame could not be released', error);
    }
  }

  /**
   * Sends the handle of a texture and keeps hold of it until the host says it has been taken.
   * Chromium draws over a texture as soon as it is released, so letting go before the host has
   * read it would be a panel showing the next frame's half-drawn contents.
   */
  function sendTexture(panel: Panel, texture: OffscreenSharedTexture, handle: bigint): void {
    const size = texture.textureInfo.codedSize;
    const visible = texture.textureInfo.visibleRect;
    try {
      host?.send(
        textureMessage(panel.id, {
          handle,
          x: visible.x,
          y: visible.y,
          width: visible.width,
          height: visible.height,
          codedWidth: size.width,
          codedHeight: size.height,
        }),
      );
    } catch (error) {
      console.error(`[vr] a ${panel.id} texture could not be sent`, error);
      release(texture);
      return;
    }

    panel.holding.push({ handle, texture });
    while (panel.holding.length > TEXTURES_IN_FLIGHT) {
      release(panel.holding.shift()?.texture);
      // The host is not keeping up with this panel. Said at most once a stretch, because if it is
      // happening at all it is happening fifteen times a second — and it is worth knowing, since
      // frames piling up unanswered is what makes a panel show something that stopped being true
      // several seconds ago.
      if (Date.now() - behind > BEHIND_EVERY_MS) {
        behind = Date.now();
        console.warn(`[vr] ${panel.id}: frames are going out faster than the host takes them`);
      }
    }
  }

  /** Lets go of every texture a panel is holding, for when the host goes away or we do. */
  function releaseAll(panel: Panel): void {
    for (const held of panel.holding) release(held.texture);
    panel.holding = [];
  }

  /** The host has finished with one frame of a panel's, so Chromium may have that one back. */
  function taken(panel: Panel, handle: bigint): void {
    const at = panel.holding.findIndex((held) => held.handle === handle);
    if (at === -1) return;
    release(panel.holding[at]?.texture);
    panel.holding.splice(at, 1);
  }
  /**
   * What the seam lines are drawn in, put through the same clamp the renderer's `useHudColor`
   * applies, so a line and the text beside it are exactly the same colour.
   */
  let accent = accentFor(options.edhm?.hudColor()?.color ?? DEFAULT_ACCENT);
  /**
   * What the host was last given for each seam: its size and its colour. A seam's texture is the
   * only thing that carries its length — SteamVR reads a quad's height off the texture's shape —
   * so it has to be sent again whenever the main panel is resized, and it never needs sending for
   * any other reason.
   */
  const seamFrames = new Map<string, string>();
  /** The overlays the current host has asked to have painted again; see `repaint`. */
  const asked = new Set<string>();

  function openPanel(id: VrPanelId, placement: PanelPlacement): Panel {
    const pixels = panelPixels(effectiveSize(layout.panels, id).widthMeters, {
      ...placement,
      ...effectiveSize(layout.panels, id),
    });
    const window = new BrowserWindow({
      width: pixels.width,
      height: pixels.height,
      show: false,
      frame: false,
      transparent: true,
      // The page draws its own translucent backing; what it leaves alone stays see-through.
      backgroundColor: '#00000000',
      title: `EDSSI VR ${id}`,
      webPreferences: {
        preload: join(import.meta.dirname, '../preload/index.cjs'),
        sandbox: true,
        contextIsolation: true,
        // An offscreen window is never the foreground one, so Chromium would throttle its timers
        // and animations as though nobody were looking at it — which is exactly wrong here, since
        // the commander is looking at nothing else.
        backgroundThrottling: false,
        // The frame is already on the GPU; `useSharedTexture` is what lets it stay there, and
        // EDSSI sends the host a handle rather than six megabytes. It is one or the other, never
        // both: a window that shares its texture paints an empty `image`, so a machine whose host
        // cannot open one has its panels opened again the plain way. See `sharing`.
        offscreen: sharing === false ? true : { useSharedTexture: true },
      },
    });

    // A panel's page has no devtools anyone can open and no window anyone can look at, so anything
    // it says to the console goes nowhere. Forwarded here, it lands in EDSSI's own log beside
    // everything else — which is the difference between debugging a panel and guessing at it.
    // The overload with a `level` number is the one this Electron resolves to; 2 is a warning and
    // 3 an error.
    window.webContents.on('console-message', (_event, level: number, message: string) => {
      const said = `[vr:${id}] ${message}`;
      if (level >= 3) console.error(said);
      else if (level === 2) console.warn(said);
      else vrLog(said);
    });

    const panel: Panel = {
      id,
      window,
      pixels,
      painted: '',
      holding: [],
      nudge: 0,
    };
    window.webContents.setFrameRate(FRAME_RATE);
    window.webContents.on('paint', (details, _dirty, image) => {
      const texture = details.texture;
      // Every path out of here from now on has to let go of the texture, or the panel stops
      // painting the moment Chromium runs out of the pool.
      if (stopped) return release(texture);
      // A window that shares its texture hands over an empty `image`, so the size has to come from
      // the texture itself — taking it from the bitmap is a panel that silently sends nothing.
      const { width, height } = texture?.textureInfo.visibleRect ?? image.getSize();
      if (width === 0 || height === 0) return release(texture);

      if (`${width}x${height}` !== panel.painted) {
        panel.painted = `${width}x${height}`;
        const asked = `${panel.pixels.width}x${panel.pixels.height}`;
        const note = panel.painted === asked ? '' : ` (asked for ${asked})`;
        vrLog(`[vr] ${id} painting at ${panel.painted}${note}`);
      }

      if (host === undefined || !hostReady) return release(texture);

      const handle = texture?.textureInfo.handle?.ntHandle;
      if (texture !== undefined && handle !== undefined && handle.length >= 8) {
        // Sent whether or not the cockpit is up. A handle is a few dozen bytes, so there is
        // nothing to save by holding it back — and holding it back is what kept the panels from
        // ever appearing: a cockpit that starts hidden drops the only paints its pages have to
        // give, and a page with nothing new to say never paints again, so the panel had no
        // texture to be shown when it was finally summoned. The seams were unaffected, being
        // sent once by hand, which is why they were the only thing in the headset.
        report(panel, 'as textures, which stay on the GPU');
        sendTexture(panel, texture, handle.readBigUInt64LE(0));
        return;
      }

      release(texture);
      // Pixels are megabytes, and a hidden panel is not worth them; the same frame will be asked
      // for again when the cockpit is summoned.
      if (!layout.rig.visible) return;
      report(panel, 'as pixels, because this frame carries no shared handle');
      try {
        host.send(frameMessage(id, width, height, image.toBitmap()), true);
      } catch (error) {
        console.error(`[vr] a ${id} frame could not be sent`, error);
      }
    });

    const devServerUrl = process.env['ELECTRON_RENDERER_URL'];
    if (!app.isPackaged && devServerUrl) {
      void window.loadURL(`${devServerUrl}#vr/${id}`);
    } else {
      void window.loadFile(join(import.meta.dirname, '../renderer/index.html'), {
        hash: `vr/${id}`,
      });
    }

    applyStyle(panel, placement);
    return panel;
  }

  /**
   * How the panel is painted: its own backing, and how big the type is.
   *
   * The backing is not the overlay's alpha — this darkens what is behind the words while leaving
   * them as bright. The type is sized from the panel's real density so that a line of text is the
   * same height in metres on every panel, however many pixels that panel happens to be given.
   *
   * Pushed into the page rather than baked in, so both can be tuned in the headset.
   */
  function applyStyle(panel: Panel, placement: PanelPlacement): void {
    if (panel.window.isDestroyed()) return;
    const density = panel.pixels.width / effectiveSize(layout.panels, panel.id).widthMeters;
    const css =
      `document.documentElement.style.setProperty('--vr-background','${placement.background}');` +
      `document.documentElement.style.setProperty('--vr-fade','${(placement.fade * density).toFixed(2)}px');` +
      `document.documentElement.style.fontSize='${pixelsPerRem(panel).toFixed(2)}px';` +
      // The components are drawn in the window's pixels; this scales them to the panel's type.
      `document.documentElement.style.setProperty('--vr-zoom','${(pixelsPerRem(panel) / WINDOW_REM_PX).toFixed(4)}')`;
    panel.window.webContents.executeJavaScript(css).catch(() => {
      // The page may not have loaded yet; the next change will carry it.
    });
  }

  /**
   * Has a panel paint a frame, whether or not it has anything new to show — for a host that has
   * just come up, or has asked for a panel it has nothing of.
   *
   * Not `invalidate()`: in a window that shares its texture, that fires `paint` with no texture at
   * all (checked against a real offscreen window), which the handler above can only drop. Only a
   * page that has actually changed hands over a texture. A cockpit started while EDSSI was already
   * running showed it — its pages had loaded, painted once before the host was ready, and then had
   * nothing new to say, so every panel stayed blank until something on it happened to change,
   * however often the host asked. So the page is changed: a pixel in the corner, flipped between
   * two shades that both come out transparent (`--vr-nudge` in `styles.css`).
   */
  function paintAgain(panel: Panel): void {
    if (panel.window.isDestroyed()) return;
    panel.nudge = panel.nudge === 0 ? 1 : 0;
    panel.window.webContents
      .executeJavaScript(
        `document.documentElement.style.setProperty('--vr-nudge','${panel.nudge}')`,
      )
      .catch(() => {
        // Not loaded yet; it paints when it is.
      });
  }

  /** How many pixels a line of type is on this panel: see `TYPE_METERS`. */
  function pixelsPerRem(panel: Panel): number {
    return TYPE_METERS * (panel.pixels.width / effectiveSize(layout.panels, panel.id).widthMeters);
  }

  /** Throws every panel's window away and opens it again, for when how they paint has changed. */
  function reopen(): void {
    for (const panel of panels.values()) {
      releaseAll(panel);
      if (!panel.window.isDestroyed()) panel.window.destroy();
    }
    panels.clear();
    reconcile();
  }

  /** Opens, closes and resizes windows so that what is open matches what the layout asks for. */
  function reconcile(): void {
    for (const id of VR_PANEL_IDS) {
      const placement = layout.panels[id];
      const panel = panels.get(id);
      if (!placement.enabled) {
        if (panel !== undefined) {
          releaseAll(panel);
          if (!panel.window.isDestroyed()) panel.window.destroy();
          panels.delete(id);
        }
        continue;
      }

      if (panel === undefined) {
        panels.set(id, openPanel(id, placement));
        continue;
      }

      const size = effectiveSize(layout.panels, id);
      const pixels = panelPixels(size.widthMeters, { ...placement, ...size });
      if (pixels.width !== panel.pixels.width || pixels.height !== panel.pixels.height) {
        panel.pixels = pixels;
        if (!panel.window.isDestroyed()) {
          panel.window.setContentSize(pixels.width, pixels.height);
          // A resize alone may not dirty anything the page draws, and until it repaints the host
          // is still holding a texture of the old shape.
          paintAgain(panel);
        }
      }

      applyStyle(panel, placement);
    }
  }

  /** The seams to hang, given which panels are up and whether the lines are switched on at all. */
  function seams(): Seam[] {
    return seamsFor(layout.panels, VR_PANEL_IDS, layout.seams);
  }

  /**
   * A seam's texture: one flat colour, made here rather than rendered. Sent only when its shape or
   * its colour has changed, and always at least once — unlike a panel, which paints when it has
   * something to say, a line has nothing to say ever and would otherwise never reach the host.
   *
   * Not droppable: there is no later frame coming to make up for one thrown away.
   */
  function sendSeamFrames(all = false): void {
    if (host === undefined) return;
    const wanted = new Set<string>();
    for (const seam of seams()) {
      wanted.add(seam.id);
      const pixels = seamPixels(seam);
      const signature = `${pixels.width}x${pixels.height}|${accent}`;
      if (!all && seamFrames.get(seam.id) === signature) continue;
      try {
        host.send(
          frameMessage(
            seam.id,
            pixels.width,
            pixels.height,
            solidFrame(pixels.width, pixels.height, accent),
          ),
        );
        seamFrames.set(seam.id, signature);
      } catch (error) {
        console.error(`[vr] the ${seam.id} line could not be sent`, error);
      }
    }

    // A seam that has gone takes its overlay with it in the host's own reconcile; forgetting it
    // here is what makes the line be sent again if that edge comes back.
    for (const id of seamFrames.keys()) if (!wanted.has(id)) seamFrames.delete(id);
  }

  function sendState(): void {
    const state: RigState = {
      visible: layout.rig.visible,
      lock: layout.rig.lock,
      anchor: layout.rig.anchor,
      panels: [
        ...VR_PANEL_IDS.filter((id) => layout.panels[id].enabled).map((id): PanelState => {
          const placement = layout.panels[id];
          return {
            id,
            matrix: panelMatrix(layout.rig, layout.panels, id),
            widthMeters: effectiveSize(layout.panels, id).widthMeters,
            alpha: placement.alpha,
            curvature: placement.curvature,
          };
        }),
        // The lines are panels as far as the host is concerned — a quad, a place and a texture —
        // but never the one the tuning keys act on; see `gaze` in `protocol.ts`.
        ...seams().map((seam): PanelState => ({
          id: seam.id,
          matrix: seamMatrix(layout.rig, layout.panels, seam),
          widthMeters: seam.widthMeters,
          alpha: layout.seams.alpha,
          // Flat: a line bent along its length would no longer read as a straight seam, and one
          // bent across its thickness has nothing to bend.
          curvature: 0,
          gaze: false,
        })),
      ],
    };
    host?.send(stateMessage(state));
    sendSeamFrames();
  }

  function connect(): void {
    if (stopped) return;
    host = startOverlayHost({
      onReply(reply) {
        // The host has finished with a texture, so Chromium may have it back. Answered in order
        // per panel, so the oldest one being held is the one it means.
        if (reply.type === 'took') {
          const [id, handle] = reply.message.split(' ');
          const found = VR_PANEL_IDS.find((candidate) => candidate === id);
          const panel = found === undefined ? undefined : panels.get(found);
          if (panel !== undefined && handle !== undefined) taken(panel, BigInt(handle));
          return;
        }

        // A panel the host still has nothing to show for: its frames went astray, and a page that
        // has nothing new to say never paints again by itself. See `AskForFrames` in the host.
        if (reply.type === 'want') {
          repaint(reply.message);
          return;
        }

        // The host says which panel is being looked at; that is what the panel-level keys act on.
        if (reply.type === 'gaze') {
          const looked = VR_PANEL_IDS.find((id) => id === reply.message);
          if (looked !== undefined) gazed = looked;
          return;
        }

        if (reply.type === 'error') {
          // A host that fails the same way every retry says so once, not every ten seconds.
          if (reply.message === lastError) return;
          lastError = reply.message;
          console.error(`[vr] ${reply.message}`);
          return;
        }

        // `unavailable` is SteamVR declining to start an overlay at all — most often, running
        // with no headset connected. Nothing is wrong, and it is tried again shortly.
        vrLog(`[vr] ${reply.message}`);
        if (reply.type !== 'ready') return;
        lastError = undefined;
        asked.clear();
        const shares = reply.textures === true;
        if (sharing !== shares) {
          sharing = shares;
          if (shares) vrLog('[vr] frames stay on the GPU; the host opens them by handle');
          else {
            console.warn(
              '[vr] this host cannot open our textures, so the panels are being opened again to' +
                ' paint their pixels — slower, and SteamVR rebuilds each one on every frame',
            );
          }
          // Which way a window paints is settled when it is made, so changing our minds means
          // making them again. Only ever towards pixels: the panels start out sharing.
          if (!shares) reopen();
        }

        hostReady = true;
        sendState();
        // A fresh host holds no textures, and the pages have nothing new to say: ask for a repaint.
        for (const panel of panels.values()) paintAgain(panel);
      },
      onExit(code) {
        host = undefined;
        hostReady = false;
        sharing = false;
        // Nothing is going to acknowledge these now, and Chromium needs them back to keep painting.
        for (const panel of panels.values()) releaseAll(panel);
        // A fresh host holds no textures at all, so nothing is still in front of the commander
        // that we can claim to have sent. The panels repaint on `ready`; the lines never would.
        seamFrames.clear();
        if (stopped) return;
        vrLog(`[vr] the overlay host exited (${code ?? 'no code'}); retrying shortly`);
        retry = setTimeout(connect, RETRY_MS);
      },
    });
  }

  const scroller = new Scroller();
  /** The panel being scrolled, and the timer stepping it, while a scroll is under way. */
  let scrolling: { panel: Panel; timer: NodeJS.Timeout } | undefined;

  /**
   * A scroll control is down, or still held. The panel is the one looked at when the scroll began,
   * and stays that one until it stops: the eyes follow the text they are reading, and a glance
   * sideways mid-scroll must not send the rest of it to another panel.
   */
  /**
   * Paints one of the host's overlays again. A panel is asked to repaint itself; a seam line has no
   * page, so its colour is sent again.
   */
  function repaint(id: string): void {
    const found = VR_PANEL_IDS.find((candidate) => candidate === id);
    if (found !== undefined) {
      const panel = panels.get(found);
      if (panel !== undefined) paintAgain(panel);
    } else {
      seamFrames.delete(id);
      sendSeamFrames();
    }

    // Once per panel per host, which is enough to see it happening without a line every second.
    if (asked.has(id)) return;
    asked.add(id);
    vrLog(`[vr] ${id}: the host has nothing to show yet, so it is being painted again`);
  }

  function scroll(direction: 1 | -1, strength: number): void {
    const now = performance.now();
    if (scrolling === undefined || !scroller.active(now)) {
      const panel = panels.get(gazed);
      if (panel === undefined || panel.window.isDestroyed()) return;
      stopScrolling();
      panel.window.webContents.setFrameRate(SCROLL_FRAME_RATE);
      scrolling = { panel, timer: setInterval(stepScroll, 1000 / SCROLL_FRAME_RATE) };
    }

    scroller.hold(direction, strength, now);
    stepScroll();
  }

  /** Moves the page by however much the scroll has come to since the last frame. */
  function stepScroll(): void {
    if (scrolling === undefined) return;
    const { panel } = scrolling;
    const now = performance.now();
    if (panel.window.isDestroyed()) return stopScrolling();

    const pixels = scroller.step(now, pixelsPerRem(panel));
    if (pixels !== 0) {
      // Aimed at the middle of the panel, which is the only place a wheel event can sensibly land
      // when there is no pointer. Precise, the way a touchpad's are: Chromium then scrolls by
      // exactly this much at once, rather than animating each event on its own clock and
      // fighting the glide this is already drawing.
      panel.window.webContents.sendInputEvent({
        type: 'mouseWheel',
        x: Math.round(panel.pixels.width / 2),
        y: Math.round(panel.pixels.height / 2),
        deltaX: 0,
        deltaY: pixels,
        hasPreciseScrollingDeltas: true,
        canScroll: true,
      });
    }

    if (!scroller.active(now)) stopScrolling();
  }

  /** The scroll has come to rest: the timer stops and the panel goes back to painting slowly. */
  function stopScrolling(): void {
    if (scrolling === undefined) return;
    clearInterval(scrolling.timer);
    if (!scrolling.panel.window.isDestroyed()) {
      scrolling.panel.window.webContents.setFrameRate(FRAME_RATE);
    }
    scrolling = undefined;
  }

  /**
   * Runs one command. `strength` is how hard the control is being held — 1 for a key or a button,
   * and how far a ministick has been pushed — so scrolling with a stick goes as fast as it is
   * shoved rather than at one speed whatever the commander does.
   */
  function run(command: keyof typeof VR_COMMANDS, strength = 1): void {
    if (SCROLL_COMMANDS.has(command)) {
      scroll(command === 'scrollUp' ? 1 : -1, strength);
      return;
    }

    const before = layout;
    layout = VR_COMMANDS[command](layout, gazed);
    const shown = layout.rig.visible && !before.rig.visible;

    reconcile();
    sendState();
    if (shown) {
      // Whatever the panels were showing when they went down is stale by the time they return.
      for (const panel of panels.values()) paintAgain(panel);
    }

    clearTimeout(settle);
    settle = setTimeout(() => {
      // Cleared before the write, not after: `reload` asks whether a save is pending, and a handle
      // left behind by a timer that has already fired would tell it the wrong thing forever.
      settle = undefined;
      saveLayout(layout);
    }, SETTLE_MS);
  }

  /**
   * Everything bound to each command: the keys from `vr-overlay.json`, and the stick controls from
   * `vr.bindings` in the settings file.
   *
   * The two files rather than one because of where each binding has to be made. A key is written
   * down, and a commander in a headset can't be shown a settings screen — so the keys live beside
   * the layout, in the file that can be edited with the headset off. A stick button has no name to
   * write down at all: it is learnt by pressing it, which is a settings screen, and so the file the
   * settings screen writes.
   */
  function boundActions(): Record<string, InputAction> {
    const actions: Record<string, InputAction> = {};
    // The same control pressed the same way, bound in both files, is one binding: bound twice it
    // would run its command twice per press.
    const seen = new Set<string>();
    const add = (command: VrCommand, bound: BoundAction) => {
      const key = actionKey(bound);
      if (seen.has(key)) return;
      seen.add(key);
      const existing = actions[command];
      if (existing) existing.bindings = [...existing.bindings, bound];
      else {
        actions[command] = {
          bindings: [bound],
          // Scrolling keeps going while the control is held; a binding may say otherwise.
          repeat: VR_REPEAT_COMMANDS.has(command),
          run: (strength) => run(command, strength),
          ...(SCROLL_COMMANDS.has(command) && {
            // The glide wants to hear how hard the control is held as it changes, from the start,
            // and to know the moment it is let go; see `Scroller`.
            repeatDelayMs: SCROLL_REPEAT_MS,
            repeatEveryMs: SCROLL_REPEAT_MS,
            release: () => scroller.release(),
          }),
        };
      }
    };

    for (const [accelerator, command] of Object.entries(layout.keys)) {
      add(command, { binding: { kind: 'key', accelerator } });
    }
    for (const [command, bound] of Object.entries(sticks)) {
      if (!isVrCommand(command)) continue;
      for (const action of bound ?? []) add(command, action);
    }

    return actions;
  }

  /** Binds whatever the two files currently say; answers the function that unbinds it again. */
  function bindControls(): () => void {
    return options.input.actions(boundActions());
  }

  let unbind = bindControls();

  /**
   * The stick bindings have been saved. Bound afresh, since the commander is quite likely wearing
   * the headset and watching for the button they just bound to start working.
   */
  const unwatchSettings = options.settings?.onChange((next) => {
    if (stopped) return;
    if (JSON.stringify(next.vr.bindings) === JSON.stringify(sticks)) return;
    sticks = next.vr.bindings;
    unbind();
    unbind = bindControls();
  });

  /**
   * The seam lines follow the EDHM theme, the same as everything the pages draw. Only the lines
   * need telling: a panel reads `--accent` for itself in `useHudColor`.
   */
  const unwatchAccent = options.edhm?.onHudColor((hud: HudColor | null) => {
    if (stopped) return;
    const next = accentFor(hud?.color ?? DEFAULT_ACCENT);
    if (next === accent) return;
    accent = next;
    sendSeamFrames();
  });

  /**
   * The file has changed under us. Everything is applied: the panels are opened, closed and resized
   * to match, the rig goes to the host, and the keys are bound afresh in case the bindings moved.
   *
   * A save of our own lands here too, so what was read is compared with what is already in hand and
   * an echo is ignored. A pending save is dropped: whoever just edited the file meant it, and
   * writing over them half a second later would be maddening.
   */
  function reload(): void {
    if (stopped) return;
    /*
     * Our own newer state hasn't been written yet, so the file is stale by definition: everything
     * in it is older than what the commander is looking at.
     *
     * This is what brought a hidden cockpit back by itself. Hiding it takes effect at once and is
     * written `SETTLE_MS` later; the file is polled every `WATCH_INTERVAL_MS`, so a poll landing
     * in between read `visible: true` from the save before it, found that it differed from what
     * was in hand, and dutifully applied it. From the headset that is indistinguishable from the
     * button having fired twice, which is what it was taken for.
     */
    if (settle !== undefined) return;

    // Nothing when the file is mid-write, which happens often enough to matter; leave what we have.
    const next = readLayout();
    if (next === undefined || JSON.stringify(next) === JSON.stringify(layout)) return;

    // Only when they actually moved: rebinding throws away a click that is still being counted,
    // so a press waiting to find out whether it is a double would be lost to an unrelated edit.
    const rebind = JSON.stringify(next.keys) !== JSON.stringify(layout.keys);
    layout = next;
    if (rebind) {
      unbind();
      unbind = bindControls();
    }
    reconcile();
    sendState();
    for (const panel of panels.values()) paintAgain(panel);

    vrLog('[vr] the cockpit was edited by hand; applied');
  }

  const watched = vrOverlayPath();
  watchFile(watched, { interval: WATCH_INTERVAL_MS }, reload);

  reconcile();

  // Capturing runs on its own clock; see CAPTURE_EVERY_MS.
  const shots = captureDir();
  if (shots !== undefined) {
    // While capturing, stdout is a pipe belonging to `scripts/vr-shots.ts`, which goes away when it
    // stops us. A write into the closed pipe raises EPIPE, and an uncaught one puts a modal error
    // dialog on the commander's screen — which is a wretched thing for a screenshot tool to do.
    process.stdout.on('error', () => {});
    process.stderr.on('error', () => {});
  }
  const capturing =
    shots === undefined
      ? undefined
      : setInterval(() => {
          mkdirSync(shots, { recursive: true });
          for (const panel of panels.values()) {
            if (panel.window.isDestroyed()) continue;
            panel.window.webContents
              .capturePage()
              .then((image) => writeFileSync(join(shots, `${panel.id}.png`), image.toPNG()))
              .catch((error: unknown) =>
                console.error(`[vr] could not capture ${panel.id}`, error),
              );
          }
        }, CAPTURE_EVERY_MS);

  saveLayout(layout);
  if (!layout.rig.visible) {
    const key = Object.entries(layout.keys).find(([, command]) => command === 'toggle')?.[0];
    vrLog(`[vr] the cockpit is hidden${key === undefined ? '' : `; press ${key} to show it`}`);
  }

  // Capturing renders the panels and photographs them; it must not put overlays into a SteamVR
  // session that another EDSSI — or the commander's own game — is already using.
  if (shots === undefined) connect();
  else console.log(`[vr] capturing panels to ${shots}; SteamVR is not touched`);

  return {
    windows: () => [...panels.values()].map((panel) => panel.window),
    stop() {
      stopped = true;
      unwatchFile(watched, reload);
      unwatchAccent?.();
      unwatchSettings?.();
      unbind();
      clearInterval(capturing);
      clearTimeout(retry);
      clearTimeout(settle);
      stopScrolling();
      saveLayout(layout);
      host?.stop();
      host = undefined;
      hostReady = false;
      for (const panel of panels.values()) {
        releaseAll(panel);
        if (!panel.window.isDestroyed()) panel.window.destroy();
      }
      panels.clear();
    },
  };
}
