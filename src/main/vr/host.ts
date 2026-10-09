/**
 * The `tools/vr-overlay-host` process: spawning it, feeding it, and noticing when it goes away.
 *
 * It is a separate process because openvr is a C++ API with no maintained Node binding — see that
 * folder's README. Nothing here knows what a frame contains; `protocol.ts` builds the messages and
 * this only pushes them down the pipe.
 */

import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * How much may be waiting in the pipe before a frame is dropped rather than queued. A frame is
 * megabytes, so without this a host that stalls would be paid for in EDSSI's memory. Frames are the
 * one message worth dropping: another is along in a moment, and it will be more current.
 */
const BACKLOG_LIMIT_BYTES = 16 * 1024 * 1024;

/** What the host says on stdout, one JSON object per line. */
export interface HostReply {
  /**
   * `ready`, `error`, `unavailable` (SteamVR would not start an overlay, e.g. with no headset),
   * `quit`, `took`, `gaze` or `want` (a panel with nothing to show, asking to be painted again)
   * today; a newer host may say more, so this is not narrowed.
   */
  type: string;
  message: string;
  /** Which SteamVR runtime's openvr_api.dll it bound to, on `ready`. */
  runtime?: string;
  /**
   * On `ready`: whether the host can open the textures EDSSI's windows paint into. False means it
   * has to be sent the pixels instead — which works, but has SteamVR rebuild each panel's texture
   * on every frame, and that is what makes the cockpit blink.
   */
  textures?: boolean;
}

export interface OverlayHostOptions {
  /** Overridden by tests; otherwise `overlayHostPath()`. */
  exePath?: string;
  onReply(reply: HostReply): void;
  onExit(code: number | null): void;
}

export interface OverlayHost {
  /**
   * Sends a message. `droppable` marks a frame: it is thrown away rather than queued when the pipe
   * is already backed up. Answers whether it went.
   */
  send(message: Buffer, droppable?: boolean): boolean;
  stop(): void;
}

/**
 * Where `npm run vr:build` leaves the host. In a packaged build it would be an `extraResource`
 * beside the app, the way the EDHM mod is; the prototype only looks in the build output.
 */
export function overlayHostPath(): string {
  const exe = 'vr-overlay-host.exe';
  const candidates = [
    // Dev and `electron-vite build`: out/main/ is where this file ends up.
    join(import.meta.dirname, '..', 'vr-overlay-host', exe),
    join(process.resourcesPath, 'vr-overlay-host', exe),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0]!;
}

export function startOverlayHost(options: OverlayHostOptions): OverlayHost {
  const exe = options.exePath ?? overlayHostPath();
  // Told who we are, so it can let go if EDSSI is killed outright rather than shut down. Closing
  // stdin is the tidy wind-down, but a killed process closes nothing — and a host left holding its
  // overlay keys makes the next EDSSI's cockpit fail with `KeyInUse`.
  let child: ChildProcess | undefined = spawn(exe, ['--parent', String(process.pid)], {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });

  let rest = '';
  child.stdout?.setEncoding('utf8');
  child.stdout?.on('data', (chunk: string) => {
    rest += chunk;
    const lines = rest.split('\n');
    rest = lines.pop() ?? '';
    for (const line of lines) {
      if (line.trim() === '') continue;
      try {
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- our own process's replies.
        options.onReply(JSON.parse(line) as HostReply);
      } catch {
        console.error('[vr] the host said something unexpected:', line);
      }
    }
  });

  child.stderr?.setEncoding('utf8');
  child.stderr?.on('data', (chunk: string) => console.error(`[vr-host] ${chunk.trimEnd()}`));

  child.on('error', (error) => {
    child = undefined;
    options.onReply({ type: 'error', message: `${exe} would not start: ${error.message}` });
    options.onExit(null);
  });

  child.on('exit', (code) => {
    child = undefined;
    options.onExit(code);
  });

  // EPIPE arrives here when the host dies mid-write; `exit` reports it, so this only stays quiet.
  child.stdin?.on('error', () => {});

  return {
    send(message, droppable = false) {
      const stdin = child?.stdin;
      if (!stdin || stdin.destroyed) return false;
      if (droppable && stdin.writableLength > BACKLOG_LIMIT_BYTES) return false;
      return stdin.write(message);
    },
    stop() {
      // Closing stdin is the wind-down the host is written around: it destroys the overlay and
      // exits on its own, which leaves SteamVR tidier than killing it would.
      child?.stdin?.end();
      const dying = child;
      child = undefined;
      setTimeout(() => {
        if (dying?.exitCode === null) dying.kill();
      }, 2000).unref();
    },
  };
}
