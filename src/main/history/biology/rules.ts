/**
 * The shape of the exobiology spawn data in `species.generated.ts`. The rules are the community's,
 * worked out from what players have logged (collected in Silarn's EDMC-BioScan); Frontier has
 * never published them. A species can spawn where any one of its rules holds in full.
 */

/** A star class, optionally with the luminosity classes it needs (`['B', 'IV']`). */
export type StarRequirement = string | readonly [starClass: string, luminosity: string];

export interface SpawnRule {
  /** `Scan.AtmosphereType` values, `None` for none. */
  atmosphere?: readonly string[];
  /** Minimum percentage of a gas in `Scan.AtmosphereComposition`. */
  atmosphereComponent?: Readonly<Record<string, number>>;
  /** In g. */
  minGravity?: number;
  maxGravity?: number;
  /** In K. */
  minTemperature?: number;
  maxTemperature?: number;
  /** In atmospheres. */
  minPressure?: number;
  maxPressure?: number;
  /** In seconds. */
  maxOrbitalPeriod?: number;
  /**
   * `None` (no volcanism), `Any` (some), `!carbon` (some, but not that), or a list of which one
   * must be part of `Scan.Volcanism`, `=` marking an exact match.
   */
  volcanism?: string | readonly string[];
  /** `Scan.PlanetClass` values. */
  bodyType?: readonly string[];
  /** Region groups from `REGION_GROUPS`, `!` marking one the species is never found in. */
  regions?: readonly string[];
  /** A star in the system that must be one of these. */
  star?: readonly StarRequirement[];
  /** The body's parent star (or the system's main star) must be one of these classes. */
  parentStar?: readonly string[];
  /** Near a large nebula (`large`), or a large or planetary one (`all`). */
  nebula?: 'all' | 'large';
  /** Inside a Guardian zone. */
  guardian?: boolean;
  /** Within a band of distances from one of `TUBER_ZONES`. */
  tuber?: 'Any' | readonly string[];
  /** A body in the system must be one of these planet classes. */
  bodies?: readonly string[];
  /** Minimum distance from the arrival star, in ls. */
  distance?: number;
  /** Only in this system. */
  system?: string;
}

export interface SpeciesRules {
  /** Codex name, e.g. `$Codex_Ent_Stratum_02_Name;`. */
  code: string;
  name: string;
  /** Base price of a complete sample. */
  value: number;
  /** Colour by the class of the star lighting the body, where the species sets its own. */
  starColours?: Readonly<Record<string, string>>;
  /** Colour by a rare element in the body's materials. */
  elementColours?: Readonly<Record<string, string>>;
  rules: readonly SpawnRule[];
}

export interface GenusRules {
  /** Codex name, e.g. `$Codex_Ent_Stratum_Genus_Name;`. */
  code: string;
  name: string;
  /** Metres between colonies of different species: how far to go for the next sample. */
  colonyDistance: number;
  /** More than one of its species can grow on the same body. */
  multiple: boolean;
  /** Colour by star class, for every species of the genus. */
  starColours?: Readonly<Record<string, string>>;
  species: readonly SpeciesRules[];
}
