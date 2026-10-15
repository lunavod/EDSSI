import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * EDSSI's own folder, outside the app's data directory so it is easy to find and edit by hand.
 * `EDSSI_CONFIG_DIR` moves it, which tests and a second instance rely on.
 */
export function configDir(): string {
  return process.env['EDSSI_CONFIG_DIR'] ?? join(homedir(), '.edssi');
}

/** The settings file, written as a commented template the first time EDSSI runs. */
export function configPath(): string {
  return join(configDir(), 'config.yaml');
}

/** Where the window's last position and size are kept. */
export function windowBoundsPath(): string {
  return join(configDir(), 'window-bounds.json');
}

/** Where the views' sorting and the like are kept (`src/shared/view-options.ts`). */
export function viewOptionsPath(): string {
  return join(configDir(), 'view-options.json');
}

/** Where a ChatGPT sign-in is kept. Deliberately not the Codex CLI's own file. */
export function chatGptTokenPath(): string {
  return join(configDir(), 'chatgpt-auth.json');
}

/** Where the VR panel's last position, rotation and size are kept. */
export function vrOverlayPath(): string {
  return join(configDir(), 'vr-overlay.json');
}

/** Which extensions are turned off (`src/shared/extensions.ts`). */
export function extensionsStatePath(): string {
  return join(configDir(), 'extensions.json');
}
