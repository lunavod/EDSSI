/**
 * A spoken line for each body the FSS turns up with life on it: which body, how many biological
 * signals, and what they could pay. The game writes `FSSBodySignals` just before the body's `Scan`,
 * and the value needs both, so the line is due once a body has its signals and its scan, whichever
 * came last.
 */

import type { SurveyBody, SystemSurvey } from '../../shared/history';
import type { JournalEvent } from '../../shared/journal';
import { bioBodies } from '../../shared/mission';

export class ExobiologyCallouts {
  /** Bodies already called out, by system and body id, so a later rescan stays quiet. */
  #called = new Set<string>();

  /**
   * What to say after `event`, given a way to read the survey it produced, or undefined. Only an
   * FSS event can set one off: a body first seen by the surface scanner has been heard about
   * already, or never went through the FSS at all.
   */
  after(event: JournalEvent, readSurvey: () => SystemSurvey | undefined): string | undefined {
    if (event.event !== 'Scan' && event.event !== 'FSSBodySignals') return undefined;
    const survey = readSurvey();
    if (!survey || String(survey.systemAddress) !== String(event.SystemAddress)) return undefined;
    const bio = bioBodies(survey).find((candidate) => candidate.body.bodyId === event.BodyID);
    // Both halves are needed: the signals give the count, the scan lets the rules price them.
    if (!bio || bio.body.bioSignals === 0 || !bio.body.possibleGenuses) return undefined;
    const key = `${String(survey.systemAddress)}:${bio.body.bodyId}`;
    if (this.#called.has(key)) return undefined;
    this.#called.add(key);
    return exobiologyCallout(bio.body, survey.systemName, bio.potentialMin, bio.potentialMax);
  }
}

/** "A 1: 3 bio, 1.2 to 19 million." Short, as a callout lands mid-scan. */
export function exobiologyCallout(
  body: SurveyBody,
  systemName: string,
  min: number,
  max: number,
): string {
  const value =
    max <= 0
      ? 'value unknown'
      : spokenCredits(min) === spokenCredits(max)
        ? spokenCredits(max)
        : spokenRange(min, max);
  return `${spokenBodyName(body.name, systemName)}: ${body.bioSignals} bio, ${value}.`;
}

/**
 * A body the way the system map labels it. Read out in full, a procedurally named system is a
 * mouthful ("Blu Theia WF-S c19-0 1") and says nothing the commander doesn't know.
 */
export function spokenBodyName(name: string, systemName: string): string {
  if (
    name.length > systemName.length &&
    name.toLowerCase().startsWith(`${systemName.toLowerCase()} `)
  ) {
    return name.slice(systemName.length + 1);
  }
  return name;
}

/** "1.2 to 19 million", sharing the unit when both ends have it. */
function spokenRange(min: number, max: number): string {
  const low = spokenCredits(min);
  const high = spokenCredits(max);
  const unit = high.split(' ').slice(1).join(' ');
  if (unit && low.endsWith(` ${unit}`)) return `${low.slice(0, -unit.length - 1)} to ${high}`;
  return `${low} to ${high}`;
}

/** Credits as they're said: "19 million", "1.2 million", "450 thousand". */
export function spokenCredits(value: number): string {
  if (value >= 1e9) return `${figure(value / 1e9)} billion`;
  if (value >= 1e6) return `${figure(value / 1e6)} million`;
  if (value >= 1e3) return `${figure(value / 1e3)} thousand`;
  return String(Math.round(value));
}

/** Two significant figures: enough for a price, short enough to say. */
function figure(value: number): string {
  return String(value >= 10 ? Math.round(value) : Math.round(value * 10) / 10);
}
