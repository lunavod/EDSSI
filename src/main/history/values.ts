/**
 * Estimated payouts for exploration and exobiology data, ported from EDDiscovery's
 * EstimatedValues.cs (EliteDangerousCore, Apache-2.0): the formulas the game has used since 3.3,
 * and Vista Genomics prices since Update 14.
 */

export interface BodyValueInput {
  /** Scan.StarType; set for stars. */
  starType?: string;
  /** Scan.PlanetClass; set for planets and moons. Belt clusters have neither. */
  planetClass?: string;
  terraformState?: string;
  /** Solar masses, for stars. */
  stellarMass?: number;
  /** Earth masses, for planets. */
  massEM?: number;
  wasDiscovered?: boolean;
  wasMapped?: boolean;
  /** Mapped by the commander with the surface scanner. */
  mapped: boolean;
  /** Mapped with no more probes than the efficiency target. */
  mappedEfficiently: boolean;
  /** Odyssey pays a bonus on mapped bodies. */
  odyssey: boolean;
}

const FIRST_DISCOVERY = 2.6;
const EFFICIENT = 1.25;
const FIRST_DISCOVERED_MAPPED = 3.699622554;
const FIRST_MAPPED_ONLY = 8.0956;
const ALREADY_MAPPED = 3.3333333;

/** Estimated Universal Cartographics payout for one body, in credits. */
export function estimateBodyValue(body: BodyValueInput): number {
  if (body.starType !== undefined) {
    const k = starK(body.starType);
    const base = k + ((body.stellarMass ?? 1) * k) / 66.25;
    return pick(body, { base, firstDiscovered: base * FIRST_DISCOVERY });
  }
  if (body.planetClass === undefined) return 0; // A belt cluster.

  const k = planetK(body.planetClass, isTerraformable(body.terraformState));
  const base = Math.max(k + k * Math.pow(body.massEM ?? 1, 0.2) * 0.56591828, 500);
  const ody = (value: number) => value + (body.odyssey ? Math.max(value * 0.3, 555) : 0);
  return pick(body, {
    base,
    firstDiscovered: base * FIRST_DISCOVERY,
    firstDiscoveredMapped: ody(base * FIRST_DISCOVERED_MAPPED) * FIRST_DISCOVERY,
    firstMapped: ody(base * FIRST_MAPPED_ONLY),
    mapped: ody(base * ALREADY_MAPPED),
  });
}

/** Terraformable, being terraformed, or done: the game pays the bonus for all three. */
export function isTerraformable(terraformState: string | undefined): boolean {
  return /^(terraformable|terraforming|terraformed)$/i.test(terraformState ?? '');
}

interface Payouts {
  base: number;
  firstDiscovered: number;
  firstDiscoveredMapped?: number;
  firstMapped?: number;
  mapped?: number;
}

/** Which payout applies, as EDDiscovery's `EstimatedValue` decides it. */
function pick(body: BodyValueInput, payouts: Payouts): number {
  const notDiscovered = body.wasDiscovered === false;
  const notMapped = body.wasMapped === false;
  const efficiency = body.mappedEfficiently ? EFFICIENT : 1;
  const mapped = (value: number | undefined) => Math.trunc((value ?? 0) * efficiency);

  // Discovered by nobody yet mapped by someone: only mapping it again pays extra.
  if (notDiscovered && body.wasMapped === true) {
    return body.mapped ? mapped(payouts.mapped) : Math.trunc(payouts.base);
  }
  if (notDiscovered && notMapped && body.mapped) return mapped(payouts.firstDiscoveredMapped);
  if (notMapped && body.mapped) return mapped(payouts.firstMapped);
  if (notDiscovered) return Math.trunc(payouts.firstDiscovered);
  if (body.mapped) return mapped(payouts.mapped);
  return Math.trunc(payouts.base);
}

function starK(starType: string): number {
  if (starType.startsWith('D')) return 14057; // White dwarfs: D, DA, DAB… DX.
  if (starType === 'N' || starType === 'H') return 22628; // Neutron stars and black holes.
  // EDDiscovery scales the 3.2 value like a normal black hole; not confirmed in game.
  if (starType === 'SupermassiveBlackHole') return 33.5678;
  return 1200;
}

function planetK(planetClass: string, terraformable: boolean): number {
  switch (planetClass.toLowerCase()) {
    case 'metal rich body':
      return 21790 + (terraformable ? 65631 : 0);
    case 'ammonia world':
      return 96932;
    case 'sudarsky class i gas giant':
      return 1656;
    case 'sudarsky class ii gas giant':
    case 'high metal content body':
      return 9654 + (terraformable ? 100677 : 0);
    case 'water world':
      return 64831 + (terraformable ? 116295 : 0);
    case 'earthlike body':
      return 64831 + 116295; // Always pays the terraformable bonus.
    default:
      return 300 + (terraformable ? 93328 : 0);
  }
}

/**
 * Vista Genomics base prices by codex name, without `$Codex_Ent_` and `_Name;`
 * (`$Codex_Ent_Bacterial_04_Name;` → `Bacterial_04`).
 */
const ORGANIC_VALUES: Readonly<Record<string, number>> = {
  Aleoids_01: 7252500,
  Aleoids_02: 6284600,
  Aleoids_03: 3385200,
  Aleoids_04: 3385200,
  Aleoids_05: 12934900,
  Bacterial_01: 1000000,
  Bacterial_02: 5289900,
  Bacterial_03: 4934500,
  Bacterial_04: 1000000,
  Bacterial_05: 1000000,
  Bacterial_06: 1658500,
  Bacterial_07: 1949000,
  Bacterial_08: 8418000,
  Bacterial_09: 7774700,
  Bacterial_10: 1152500,
  Bacterial_11: 4638900,
  Bacterial_12: 1689800,
  Bacterial_13: 3897000,
  Cactoid_01: 3667600,
  Cactoid_02: 2483600,
  Cactoid_03: 16202800,
  Cactoid_04: 3667600,
  Cactoid_05: 2483600,
  Clypeus_01: 8418000,
  Clypeus_02: 11873200,
  Clypeus_03: 16202800,
  Conchas_01: 4572400,
  Conchas_02: 7774700,
  Conchas_03: 2352400,
  Conchas_04: 19010800,
  Cone: 1471900,
  Electricae_01: 6284600,
  Electricae_02: 6284600,
  Fonticulus_01: 19010800,
  Fonticulus_02: 1000000,
  Fonticulus_03: 5727600,
  Fonticulus_04: 3111000,
  Fonticulus_05: 20000000,
  Fonticulus_06: 1804100,
  Fumerolas_01: 6284600,
  Fumerolas_02: 16202800,
  Fumerolas_03: 7500900,
  Fumerolas_04: 6284600,
  Fungoids_01: 1670100,
  Fungoids_02: 2680300,
  Fungoids_03: 3703200,
  Fungoids_04: 3330300,
  Ground_Struct_Ice: 1628800,
  Osseus_01: 4027800,
  Osseus_02: 12934900,
  Osseus_03: 2404700,
  Osseus_04: 3156300,
  Osseus_05: 1483000,
  Osseus_06: 9739000,
  Recepta_01: 12934900,
  Recepta_02: 16202800,
  Recepta_03: 14313700,
  Seed: 1593700,
  SeedABCD_01: 1593700,
  SeedABCD_02: 1593700,
  SeedABCD_03: 1593700,
  SeedEFGH_01: 1593700,
  SeedEFGH_02: 1593700,
  SeedEFGH_03: 1593700,
  SeedEFGH: 1593700,
  Shrubs_01: 1808900,
  Shrubs_02: 7774700,
  Shrubs_03: 1632500,
  Shrubs_04: 10326000,
  Shrubs_05: 1632500,
  Shrubs_06: 5988000,
  Shrubs_07: 1639800,
  Sphere: 1499900,
  SphereABCD_01: 1499900,
  SphereABCD_02: 1499900,
  SphereABCD_03: 1499900,
  SphereEFGH_01: 1499900,
  SphereEFGH_02: 1499900,
  SphereEFGH_03: 1499900,
  SphereEFGH: 1499900,
  Stratum_01: 2448900,
  Stratum_02: 1362000,
  Stratum_03: 2788300,
  Stratum_04: 2448900,
  Stratum_05: 1362000,
  Stratum_06: 16202800,
  Stratum_07: 19010800,
  Stratum_08: 2637500,
  Tube: 1514500,
  TubeABCD_01: 1514500,
  TubeABCD_02: 1514500,
  TubeABCD_03: 1514500,
  TubeEFGH_01: 1514500,
  TubeEFGH_02: 1514500,
  TubeEFGH_03: 1514500,
  TubeEFGH: 1514500,
  Tubus_01: 2415500,
  Tubus_02: 5727600,
  Tubus_03: 11873200,
  Tubus_04: 2637500,
  Tubus_05: 7774700,
  Tussocks_01: 5853800,
  Tussocks_02: 3227700,
  Tussocks_03: 1849000,
  Tussocks_04: 1766600,
  Tussocks_05: 1766600,
  Tussocks_06: 1000000,
  Tussocks_07: 4447100,
  Tussocks_08: 3252500,
  Tussocks_09: 1000000,
  Tussocks_10: 1766600,
  Tussocks_11: 3472400,
  Tussocks_12: 7774700,
  Tussocks_13: 19010800,
  Tussocks_14: 14313700,
  Tussocks_15: 7025800,
  Vents: 1628800,
  Thargoid_Coral_Tree: 1896800,
  Thargoid_Coral_Root: 1924600,
  Thargoid_Tower_High: 2247100,
  Thargoid_Tower_Low: 2247100,
  Thargoid_Tower_ExtraHigh: 2247100,
  Thargoid_Tower_Med: 2247100,
  Thargoid_Tower: 2247100,
  Thargoid_Barnacle_Matrix: 2313500,
};

/**
 * Cheapest and dearest base price among a genus's species, from its codex name
 * (`$Codex_Ent_Bacterial_Genus_Name;` covers `Bacterial_01`…`Bacterial_13`).
 */
export function genusValueRange(genus: string): { min: number; max: number } | undefined {
  const code = genus.replace(/^\$Codex_Ent_/, '').replace(/_Genus_Name;?$/, '');
  const values = Object.entries(ORGANIC_VALUES)
    .filter(([species]) => species === code || species.startsWith(`${code}_`))
    .map(([, value]) => value);
  if (values.length === 0) return undefined;
  return { min: Math.min(...values), max: Math.max(...values) };
}

/** Base price of a complete sample of `species` (its codex name), if known. */
export function organicValue(species: string): number | undefined {
  const code = species.replace(/^\$Codex_Ent_/, '').replace(/_Name;?$/, '');
  return ORGANIC_VALUES[code];
}
