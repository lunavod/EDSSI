/**
 * The cockpit's chatter: panels shown and hidden, overlays made, frames going through, a SteamVR
 * with no headset to start on. Worth reading while working on the cockpit and noise otherwise, so
 * it is only printed with `EDSSI_VR_LOG=1`. Warnings and errors are always printed.
 */

const verbose = process.env['EDSSI_VR_LOG'] === '1';

export function vrLog(message: string): void {
  if (verbose) console.log(message);
}
