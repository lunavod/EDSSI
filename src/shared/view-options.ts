/**
 * How the views are shown — which way a list is sorted, what it leaves out — kept in the main
 * process rather than in each window, so the window, the VR panels and the assistant all see and
 * change the same thing. A new option is one entry here, plus `useViewOption` where it is shown.
 */

interface ChoiceOption {
  kind: 'choice';
  /** What the assistant is told it does. */
  label: string;
  values: readonly string[];
  default: string;
}

interface ToggleOption {
  kind: 'toggle';
  label: string;
  default: boolean;
}

export const VIEW_OPTIONS = {
  'mission.bio_sort': {
    kind: 'choice',
    label:
      'Mission tab, Biology here: the order of the bodies (name as the system map lists them, distance from the arrival star, or value: most to be had first)',
    values: ['name', 'distance', 'value'],
    default: 'name',
  },
  'materials.missing_sort': {
    kind: 'choice',
    label:
      "Materials tab, Missing page: the column the materials are sorted by (order as the game lists them, grade, have, need, or short: how many they're short)",
    values: ['order', 'grade', 'have', 'need', 'short'],
    default: 'order',
  },
  'materials.missing_descending': {
    kind: 'toggle',
    label: 'Materials tab, Missing page: sort the column from the top down',
    default: false,
  },
  'materials.missing_show_covered': {
    kind: 'toggle',
    label: 'Materials tab, Missing page: also list materials the commander already has enough of',
    default: false,
  },
} as const satisfies Record<string, ChoiceOption | ToggleOption>;

export type ViewOptionId = keyof typeof VIEW_OPTIONS;

// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the keys of a literal
export const VIEW_OPTION_IDS = Object.keys(VIEW_OPTIONS) as readonly ViewOptionId[];

type ValueOf<O> = O extends { kind: 'choice'; values: readonly (infer V)[] } ? V : boolean;

export type ViewOptionValue<K extends ViewOptionId> = ValueOf<(typeof VIEW_OPTIONS)[K]>;

export type ViewOptions = { [K in ViewOptionId]: ViewOptionValue<K> };

export type ViewOptionsPatch = Partial<ViewOptions>;

export function defaultViewOptions(): ViewOptions {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- every id, with its default
  return Object.fromEntries(
    VIEW_OPTION_IDS.map((id) => [id, VIEW_OPTIONS[id].default]),
  ) as ViewOptions;
}

/** Whether `value` is one `id` can take. */
export function isViewOptionValue(id: string, value: unknown): boolean {
  if (!Object.hasOwn(VIEW_OPTIONS, id)) return false;
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- checked just above
  const option: ChoiceOption | ToggleOption = VIEW_OPTIONS[id as ViewOptionId];
  return option.kind === 'toggle'
    ? typeof value === 'boolean'
    : typeof value === 'string' && option.values.includes(value);
}

/**
 * Only the valid entries of something read from a file or sent over IPC; whatever is unknown or
 * out of range is dropped, so an option renamed or removed in a later version is simply forgotten.
 */
export function readViewOptionsPatch(value: unknown): ViewOptionsPatch {
  if (typeof value !== 'object' || value === null) return {};
  const entries = Object.entries(value).filter(([id, option]) => isViewOptionValue(id, option));
  // Each entry checked above.
  return Object.fromEntries(entries);
}

/** The options with `patch` over them, and the defaults under anything missing. */
export function withViewOptions(options: ViewOptionsPatch, patch: unknown): ViewOptions {
  return { ...defaultViewOptions(), ...options, ...readViewOptionsPatch(patch) };
}
