/**
 * Registering EDSSI's OpenXR API layer (`tools/openxr-layer`) with the OpenXR loader, for this
 * Windows user only: a value under `HKCU\SOFTWARE\Khronos\OpenXR\1\ApiLayers\Implicit` named by the
 * manifest's path, 0 meaning enabled. Every OpenXR program the user starts afterwards loads it; one
 * already running is not affected, so it has to be in place before the game goes into VR — which
 * is why it is registered as soon as the cockpit is switched on, not when the game is seen.
 *
 * The layer does nothing at all until the bridge EDSSI runs is up, so leaving it registered costs
 * a game nothing. It is taken out again when the cockpit is switched off or set to SteamVR only.
 *
 * `reg.exe` rather than a native module: it is on every Windows and this runs once in a while.
 * A program running as a packaged (MSIX) app, or a child of one, has its HKCU writes virtualised
 * into the package and the game never sees them; EDSSI is not packaged, so this lands for real.
 */

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';

import { openxrFile } from './host';

export const IMPLICIT_LAYERS_KEY = 'HKCU\\SOFTWARE\\Khronos\\OpenXR\\1\\ApiLayers\\Implicit';

/** The layer's manifest, where the build leaves it. */
export function layerManifestPath(): string {
  return openxrFile('edssi_openxr_layer.json');
}

export function registerArgs(manifest: string): string[] {
  return ['add', IMPLICIT_LAYERS_KEY, '/v', manifest, '/t', 'REG_DWORD', '/d', '0', '/f'];
}

export function unregisterArgs(manifest: string): string[] {
  return ['delete', IMPLICIT_LAYERS_KEY, '/v', manifest, '/f'];
}

export function queryArgs(manifest: string): string[] {
  return ['query', IMPLICIT_LAYERS_KEY, '/v', manifest];
}

/** Whether `reg query`'s output shows the value enabled (a DWORD of 0). */
export function parseRegistered(output: string): boolean {
  return /REG_DWORD\s+0x0+\s*$/m.test(output);
}

type Run = (args: string[]) => Promise<{ ok: boolean; stdout: string }>;

const runReg: Run = (args) =>
  new Promise((resolve) => {
    execFile('reg', args, { windowsHide: true }, (error, stdout) =>
      resolve({ ok: error === null, stdout: String(stdout) }),
    );
  });

/**
 * Makes sure the layer is registered (or, with `wanted` false, that it isn't). Answers what it
 * did, for the log; never throws.
 */
export async function setLayerRegistered(
  wanted: boolean,
  manifest = layerManifestPath(),
  run: Run = runReg,
): Promise<'registered' | 'unregistered' | 'unchanged' | 'missing' | 'failed'> {
  const current = await run(queryArgs(manifest));
  const registered = current.ok && parseRegistered(current.stdout);
  if (wanted === registered) return 'unchanged';
  if (wanted && !existsSync(manifest)) return 'missing';
  const done = await run(wanted ? registerArgs(manifest) : unregisterArgs(manifest));
  if (!done.ok) return 'failed';
  return wanted ? 'registered' : 'unregistered';
}
