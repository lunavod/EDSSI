/**
 * One spoken line once the FSS has found every body in a system: how many are worth a probe run and
 * what they come to once mapped. Not which ones — the Mission tab lists them, and a string of body
 * names is no use to listen to. The game writes `FSSAllBodiesFound` after the last body's `Scan`,
 * so the survey is complete by then.
 */

import type { SystemSurvey } from '../../shared/history';
import type { JournalEvent } from '../../shared/journal';
import { type ProbeTarget, probeTargets } from '../../shared/mission';
import { spokenCredits } from './exobiology';

export class ProbeCallouts {
  /** Systems already called out, so honking one again stays quiet. */
  #called = new Set<string>();

  /** What to say after `event`, given the survey it produced and the probe cutoff, or undefined. */
  after(
    event: JournalEvent,
    readSurvey: () => SystemSurvey | undefined,
    minValue: number,
  ): string | undefined {
    if (event.event !== 'FSSAllBodiesFound') return undefined;
    const survey = readSurvey();
    if (!survey || String(survey.systemAddress) !== String(event.SystemAddress)) return undefined;
    const key = String(survey.systemAddress);
    if (this.#called.has(key)) return undefined;
    this.#called.add(key);
    const targets = probeTargets(survey, minValue);
    return targets.length > 0 ? probeCallout(targets) : undefined;
  }
}

/** "3 bodies worth mapping, 14 million together." */
export function probeCallout(targets: ProbeTarget[]): string {
  const worth = targets.reduce((sum, target) => sum + target.worth, 0);
  return targets.length === 1
    ? `1 body worth mapping, ${spokenCredits(worth)}.`
    : `${targets.length} bodies worth mapping, ${spokenCredits(worth)} together.`;
}
