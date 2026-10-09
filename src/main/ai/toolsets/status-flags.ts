/**
 * Status.json carries the ship's state as two bitfields. The meanings are the ones documented in
 * the journal manual (and repeated in the generated `StatusEvent` doc comment).
 */

const FLAGS = [
  'docked',
  'landed',
  'landing gear down',
  'shields up',
  'supercruise',
  'flight assist off',
  'hardpoints deployed',
  'in wing',
  'lights on',
  'cargo scoop deployed',
  'silent running',
  'scooping fuel',
  'srv handbrake',
  'srv turret view',
  'srv turret retracted',
  'srv drive assist',
  'mass locked',
  'fsd charging',
  'fsd cooldown',
  'low fuel',
  'overheating',
  'has lat long',
  'in danger',
  'being interdicted',
  'in ship',
  'in fighter',
  'in srv',
  'analysis mode',
  'night vision',
  'altitude from average radius',
  'fsd jump',
  'srv high beam',
];

const FLAGS2 = [
  'on foot',
  'in taxi',
  'in multicrew',
  'on foot in station',
  'on foot on planet',
  'aiming down sight',
  'low oxygen',
  'low health',
  'cold',
  'hot',
  'very cold',
  'very hot',
  'glide mode',
  'on foot in hangar',
  'on foot in social space',
  'on foot exterior',
  'breathable atmosphere',
  'telepresence multicrew',
  'physical multicrew',
  'fsd hyperdrive charging',
  'supercruise overcharge',
  'supercruise assist',
  'npc crew active',
];

/** The GUI panel the commander is looking at, by `GuiFocus`. */
const GUI_FOCUS = [
  'none',
  'internal panel',
  'external panel',
  'comms panel',
  'role panel',
  'station services',
  'galaxy map',
  'system map',
  'orrery',
  'fss',
  'saa',
  'codex',
];

/** Every flag that is set, in plain words. */
export function describeFlags(flags: number | undefined, flags2: number | undefined): string[] {
  return [...names(flags, FLAGS), ...names(flags2, FLAGS2)];
}

export function guiFocus(focus: number | undefined): string | undefined {
  return focus === undefined ? undefined : (GUI_FOCUS[focus] ?? `unknown (${focus})`);
}

function names(bits: number | undefined, meanings: readonly string[]): string[] {
  if (!bits) return [];
  return meanings.filter((_name, index) => (bits & (1 << index)) !== 0);
}
