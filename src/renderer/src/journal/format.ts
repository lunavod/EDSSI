/** Turns raw journal names and values into text for people. */

const ACRONYMS = new Set([
  'afmu',
  'cg',
  'cqc',
  'em',
  'fc',
  'fid',
  'fsd',
  'fss',
  'hud',
  'id',
  'ls',
  'ly',
  'npc',
  'pvp',
  'saa',
  'slf',
  'srv',
  'uss',
]);

const FIELD_LABELS: Record<string, string> = {
  DistFromStarLS: 'Distance from star',
  DistanceFromArrivalLS: 'Distance from arrival',
  JumpDist: 'Jump distance',
  StarPos: 'Coordinates',
  MassEM: 'Mass',
  FID: 'Frontier ID',
  LocalisedName: 'Title',
};

/** Splits identifiers like `FSDJump`, `DistFromStarLS` or `Age_MY` into words. */
export function splitWords(name: string): string[] {
  return name.split('_').flatMap((part) => part.match(/[A-Z]+(?![a-z])|[A-Z]?[a-z]+|\d+/g) ?? []);
}

function asAcronym(word: string): string | undefined {
  return ACRONYMS.has(word.toLowerCase()) ? word.toUpperCase() : undefined;
}

/** `FSDJump` → "FSD Jump", `NpcCrewPaidWage` → "NPC Crew Paid Wage". */
export function humanizeEvent(name: string): string {
  return splitWords(name)
    .map((word) => asAcronym(word) ?? word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/** `StarSystem` → "Star system", `MarketID` → "Market ID". */
export function humanizeField(key: string): string {
  const label = FIELD_LABELS[key];
  if (label) return label;
  return splitWords(key)
    .map((word, index) => {
      const acronym = asAcronym(word);
      if (acronym) return acronym;
      const lower = word.toLowerCase();
      return index === 0 ? lower.charAt(0).toUpperCase() + lower.slice(1) : lower;
    })
    .join(' ');
}

const numberFormats = new Map<number, Intl.NumberFormat>();

export function formatNumber(value: number, maximumFractionDigits = 2): string {
  let format = numberFormats.get(maximumFractionDigits);
  if (!format) {
    format = new Intl.NumberFormat(undefined, { maximumFractionDigits });
    numberFormats.set(maximumFractionDigits, format);
  }
  return format.format(value);
}

export function formatCredits(value: number): string {
  return `${formatNumber(value, 0)} CR`;
}

const compactFormat = new Intl.NumberFormat(undefined, {
  notation: 'compact',
  maximumFractionDigits: 1,
});

/** 18,320,926,115 → "18.3B". */
export function formatCompact(value: number): string {
  return compactFormat.format(value);
}

/**
 * 73,300,000 → 73.3 and M, so the unit can be set smaller; whatever the locale calls a million.
 */
export function formatCompactParts(value: number): { value: string; unit?: string } {
  const text = formatCompact(value);
  const [, figure, unit] = /^([^\p{L}]*\d)\s*(\p{L}.*)?$/u.exec(text) ?? [];
  return figure ? { value: figure, unit: unit || undefined } : { value: text };
}

type NumberFormatter = (value: number) => string;

const withUnit =
  (unit: string, digits = 2): NumberFormatter =>
  (value) =>
    `${formatNumber(value, digits)} ${unit}`;
const credits: NumberFormatter = (value) => `${formatNumber(value, 0)} CR`;
const fractionAsPercent: NumberFormatter = (value) => `${formatNumber(value * 100, 1)} %`;
const metres: NumberFormatter = (value) =>
  Math.abs(value) >= 1000 ? `${formatNumber(value / 1000, 0)} km` : `${formatNumber(value, 0)} m`;
const metresAsLightSeconds: NumberFormatter = (value) =>
  `${formatNumber(value / 299_792_458, 2)} ls`;
const gravity: NumberFormatter = (value) => `${formatNumber(value / 9.80665, 2)} g`;
const duration: NumberFormatter = (seconds) => {
  if (Math.abs(seconds) >= 86_400) return `${formatNumber(seconds / 86_400, 1)} days`;
  if (Math.abs(seconds) >= 3600) return `${formatNumber(seconds / 3600, 1)} h`;
  return `${formatNumber(seconds, 0)} s`;
};

const FIELD_FORMATS: Record<string, NumberFormatter> = {
  JumpDist: withUnit('ly'),
  DistFromStarLS: withUnit('ls'),
  DistanceFromArrivalLS: withUnit('ls'),
  FuelUsed: withUnit('t'),
  FuelLevel: withUnit('t'),
  FuelMain: withUnit('t'),
  FuelReservoir: withUnit('t'),
  Scooped: withUnit('t'),
  Radius: metres,
  SurfaceGravity: gravity,
  SurfaceTemperature: withUnit('K', 0),
  SurfacePressure: withUnit('Pa', 0),
  MassEM: withUnit('Earth masses', 4),
  StellarMass: withUnit('solar masses', 4),
  Age_MY: withUnit('million years', 0),
  SemiMajorAxis: metresAsLightSeconds,
  OrbitalPeriod: duration,
  RotationPeriod: duration,
  Percent: withUnit('%', 1),
  Health: fractionAsPercent,
  UnladenMass: withUnit('t', 1),
  CargoCapacity: withUnit('t', 0),
  MaxJumpRange: withUnit('ly'),
  FuelCapacity: withUnit('t'),
  Influence: fractionAsPercent,
  Proportion: fractionAsPercent,
  PowerplayStateControlProgress: fractionAsPercent,
  ConstructionProgress: fractionAsPercent,
};

/** Where the same field name means different things in different events. */
const EVENT_FIELD_FORMATS: Record<string, Record<string, NumberFormatter>> = {
  Loadout: { HullHealth: fractionAsPercent, Main: withUnit('t'), Reserve: withUnit('t') },
  ShipTargeted: {
    ShieldHealth: withUnit('%', 1),
    HullHealth: withUnit('%', 1),
    SubsystemHealth: withUnit('%', 1),
  },
  ProspectedAsteroid: { Proportion: withUnit('%', 1), Remaining: withUnit('%', 0) },
  RefuelAll: { Amount: withUnit('t') },
  RefuelPartial: { Amount: withUnit('t') },
  FuelScoop: { Total: withUnit('t') },
  NpcCrewPaidWage: { Amount: credits },
  PayFines: { Amount: credits },
  PayBounties: { Amount: credits },
  RedeemVoucher: { Amount: credits },
};

const CREDIT_FIELD =
  /(Price|Cost|Reward|Earnings|Bonus|Profit|Credits|Balance|Fine|Wage|Donated|Payment|Value|Loan|Rebuy)$/;
const ID_FIELD = /(ID|Id|Address)$/;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const GAME_SYMBOL = /^\$.*;$/;

export function formatValue(eventName: string, key: string, value: unknown): string {
  switch (typeof value) {
    case 'boolean':
      return value ? 'Yes' : 'No';
    case 'bigint':
      return value.toString();
    case 'number': {
      if (ID_FIELD.test(key)) return String(value);
      const format =
        EVENT_FIELD_FORMATS[eventName]?.[key] ??
        FIELD_FORMATS[key] ??
        (CREDIT_FIELD.test(key) ? credits : undefined);
      return format ? format(value) : formatNumber(value);
    }
    case 'string':
      return ISO_TIMESTAMP.test(value) ? formatDateTime(value) : value;
    default:
      return String(value);
  }
}

/** Formats an array of plain values, e.g. `StarPos` → "12.3, -4.5, 67.8 ly". */
export function formatList(eventName: string, key: string, values: unknown[]): string {
  if (key === 'StarPos') {
    return `${values.map((value) => (typeof value === 'number' ? formatNumber(value) : String(value))).join(', ')} ly`;
  }
  return values.map((value) => formatValue(eventName, key, value)).join(', ');
}

/** Internal game identifiers such as `$int_cargorack_size7_class1_name;`. */
export function isGameSymbol(value: unknown): boolean {
  return typeof value === 'string' && GAME_SYMBOL.test(value);
}

const timeFormat = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});
const dateTimeFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'medium',
});

/** Journal timestamps are UTC; these show them in the viewer's local time. */
export function formatTime(timestamp: string): string {
  return timeFormat.format(new Date(timestamp));
}

export function formatDateTime(timestamp: string): string {
  return dateTimeFormat.format(new Date(timestamp));
}

const shortTimeFormat = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });
const shortDateTimeFormat = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

/** "00:34": to the minute, for a glance. */
export function formatShortTime(timestamp: string | number): string {
  return shortTimeFormat.format(new Date(timestamp));
}

const shortDateFormat = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

/** "Thu 8 Oct 2026": the day alone. */
export function formatShortDate(timestamp: string | number): string {
  return shortDateFormat.format(new Date(timestamp));
}

/** "23 Sep, 02:02": to the minute, no year. */
export function formatShortDateTime(timestamp: string | number): string {
  return shortDateTimeFormat.format(new Date(timestamp));
}

export interface DisplayField {
  key: string;
  label: string;
  value: unknown;
  /** The internal value behind a localised one, for a tooltip. */
  raw?: string;
}

/**
 * The fields of a journal object worth showing: localised text replaces its internal symbol
 * (`Name` + `Name_Localised`), and empty values are left out.
 */
export function displayFields(record: object, isEvent: boolean): DisplayField[] {
  const entries: [string, unknown][] = Object.entries(record);
  const values = new Map(entries);
  const fields: DisplayField[] = [];
  for (const [key, value] of entries) {
    if (isEvent && (key === 'timestamp' || key === 'event')) continue;
    const isLocalisedTwin =
      key.endsWith('_Localised') && values.has(key.slice(0, -'_Localised'.length));
    if (isLocalisedTwin || isEmpty(value)) continue;

    const localised = values.get(`${key}_Localised`);
    if (typeof localised === 'string' && localised !== '') {
      fields.push({ key, label: humanizeField(key), value: localised, raw: String(value) });
    } else {
      fields.push({ key, label: humanizeField(key.replace(/_Localised$/, '')), value });
    }
  }
  return fields;
}

function isEmpty(value: unknown): boolean {
  return value === '' || value === null || (Array.isArray(value) && value.length === 0);
}
