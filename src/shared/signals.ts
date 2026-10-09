/** Reading the surface signals a survey collected, for the HUD and the assistant alike. */

import type { SurveyBody } from './history';

/** Totals each signal type across the bodies, largest first. */
export function countSignals(
  bodies: readonly SurveyBody[],
  keep: (type: string) => boolean = () => true,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const body of bodies) {
    for (const signal of body.signals) {
      if (!keep(signal.type)) continue;
      counts.set(signal.type, (counts.get(signal.type) ?? 0) + signal.count);
    }
  }
  return new Map([...counts].toSorted((a, b) => b[1] - a[1]));
}

/** Short enough for the side panel: "Geological" is the only one that needs it. */
export function shortSignal(type: string): string {
  return /^geolog/i.test(type) ? 'Geo' : type;
}
