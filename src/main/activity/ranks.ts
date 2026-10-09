/** The names the game gives each rank number, by the field names of the journal's Rank event. */

const ELITE = ['Elite', 'Elite I', 'Elite II', 'Elite III', 'Elite IV', 'Elite V'];

const RANKS: Readonly<Record<string, readonly string[]>> = {
  Combat: [
    'Harmless',
    'Mostly Harmless',
    'Novice',
    'Competent',
    'Expert',
    'Master',
    'Dangerous',
    'Deadly',
    ...ELITE,
  ],
  Trade: [
    'Penniless',
    'Mostly Penniless',
    'Peddler',
    'Dealer',
    'Merchant',
    'Broker',
    'Entrepreneur',
    'Tycoon',
    ...ELITE,
  ],
  Explore: [
    'Aimless',
    'Mostly Aimless',
    'Scout',
    'Surveyor',
    'Trailblazer',
    'Pathfinder',
    'Ranger',
    'Pioneer',
    ...ELITE,
  ],
  Soldier: [
    'Defenceless',
    'Mostly Defenceless',
    'Rookie',
    'Soldier',
    'Gunslinger',
    'Warrior',
    'Gladiator',
    'Deadeye',
    ...ELITE,
  ],
  Exobiologist: [
    'Directionless',
    'Mostly Directionless',
    'Compiler',
    'Collector',
    'Cataloguer',
    'Taxonomist',
    'Ecologist',
    'Geneticist',
    ...ELITE,
  ],
  Empire: [
    'None',
    'Outsider',
    'Serf',
    'Master',
    'Squire',
    'Knight',
    'Lord',
    'Baron',
    'Viscount',
    'Count',
    'Earl',
    'Marquis',
    'Duke',
    'Prince',
    'King',
  ],
  Federation: [
    'None',
    'Recruit',
    'Cadet',
    'Midshipman',
    'Petty Officer',
    'Chief Petty Officer',
    'Warrant Officer',
    'Ensign',
    'Lieutenant',
    'Lieutenant Commander',
    'Post Commander',
    'Post Captain',
    'Rear Admiral',
    'Vice Admiral',
    'Admiral',
  ],
  CQC: [
    'Helpless',
    'Mostly Helpless',
    'Amateur',
    'Semi Professional',
    'Professional',
    'Champion',
    'Hero',
    'Legend',
    ...ELITE,
  ],
};

/** What the journal calls each rank, in words: the mercenary rank is `Soldier` there. */
const LABELS: Readonly<Record<string, string>> = {
  Combat: 'combat',
  Trade: 'trade',
  Explore: 'exploration',
  Soldier: 'mercenary',
  Exobiologist: 'exobiology',
  Empire: 'Empire navy',
  Federation: 'Federal navy',
  CQC: 'CQC',
};

export function rankLabel(rank: string): string {
  return LABELS[rank] ?? rank;
}

/** "Pathfinder", or "rank 20" for a number the table doesn't know. */
export function rankName(rank: string, level: number): string {
  return RANKS[rank]?.[level] ?? `rank ${level}`;
}
