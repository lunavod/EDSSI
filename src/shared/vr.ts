/**
 * The VR cockpit's commands, by the names both sides call them.
 *
 * They live here rather than in `src/main/vr/layout.ts` because three places need them: the layout
 * file's key bindings, the settings schema's `vr.bindings` (which binds the same commands to stick
 * buttons), and the settings screen that writes those. `layout.ts` re-exports them, so nothing in
 * the main process has to know where they came from.
 */

/**
 * Everything a binding can do. The layout file writes these names, and so does `vr.bindings` in
 * the settings file — `scroll_up` there too, which is what a YAML file looks like it should say.
 */
export const VR_COMMAND_NAMES = [
  'left',
  'right',
  'up',
  'down',
  'nearer',
  'further',
  'yawLeft',
  'yawRight',
  'pitchUp',
  'pitchDown',
  'rollLeft',
  'rollRight',
  'wider',
  'narrower',
  'taller',
  'shorter',
  'sharper',
  'coarser',
  'moreOpaque',
  'lessOpaque',
  'moreBackground',
  'lessBackground',
  'moreCurve',
  'lessCurve',
  'scrollUp',
  'scrollDown',
  'togglePanel',
  'toggleScope',
  'toggle',
  'place',
  'toggleLock',
  'reset',
] as const;

export type VrCommand = (typeof VR_COMMAND_NAMES)[number];

/**
 * The commands that keep going while the control is held, unless the binding says otherwise.
 *
 * Scrolling is the one that wants it: a page is longer than one press of a wheel, and a ministick
 * pushed and held should carry on down the panel rather than move it one notch and stop. Moving
 * and resizing deliberately don't — a step per press is what makes them possible to aim.
 */
export const VR_REPEAT_COMMANDS: ReadonlySet<VrCommand> = new Set(['scrollUp', 'scrollDown']);

export function isVrCommand(value: unknown): value is VrCommand {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- widening, and only to look.
  return typeof value === 'string' && (VR_COMMAND_NAMES as readonly string[]).includes(value);
}

/**
 * The command a name means, however it is spelt. The layout file writes `scrollUp` and a settings
 * file written by hand is far more likely to say `scroll_up`; both are the same command, and a
 * commander who has to find out which spelling EDSSI wanted has been let down by the file.
 */
export function vrCommandFrom(name: string): VrCommand | undefined {
  const wanted = plain(name);
  return VR_COMMAND_NAMES.find((command) => plain(command) === wanted);
}

/** What the settings screen calls each command, and which group it sits in. */
export interface VrCommandGroup {
  title: string;
  help: string;
  commands: readonly VrCommand[];
}

export const VR_COMMAND_LABELS: Readonly<Record<VrCommand, string>> = {
  left: 'Move left',
  right: 'Move right',
  up: 'Move up',
  down: 'Move down',
  nearer: 'Bring nearer',
  further: 'Push further',
  yawLeft: 'Turn left',
  yawRight: 'Turn right',
  pitchUp: 'Tilt up',
  pitchDown: 'Tilt down',
  rollLeft: 'Roll left',
  rollRight: 'Roll right',
  wider: 'Wider',
  narrower: 'Narrower',
  taller: 'Taller',
  shorter: 'Shorter',
  sharper: 'Sharper',
  coarser: 'Coarser',
  moreOpaque: 'More opaque',
  lessOpaque: 'Less opaque',
  moreBackground: 'More backing',
  lessBackground: 'Less backing',
  moreCurve: 'More curve',
  lessCurve: 'Less curve',
  scrollUp: 'Scroll up',
  scrollDown: 'Scroll down',
  togglePanel: 'Turn the panel off',
  toggleScope: 'Move the rig or the panel',
  toggle: 'Show or hide the cockpit',
  place: 'Pin it where you are looking',
  toggleLock: 'World or head lock',
  reset: 'Reset everything',
};

/**
 * How the commands are shown. The ones worth binding to a stick come first: in flight, showing the
 * cockpit and scrolling it are the whole of what a hand on the throttle needs, and everything else
 * is tuning that is done once, sitting still, with a keyboard within reach.
 */
export const VR_COMMAND_GROUPS: readonly VrCommandGroup[] = [
  {
    title: 'In flight',
    help: 'Worth a stick button: summoning the cockpit and reading it without letting go.',
    commands: ['toggle', 'place', 'scrollUp', 'scrollDown', 'toggleLock', 'togglePanel'],
  },
  {
    title: 'Placing it',
    help: 'Moves and turns the whole rig, or one panel once you have switched scope.',
    commands: [
      'left',
      'right',
      'up',
      'down',
      'nearer',
      'further',
      'yawLeft',
      'yawRight',
      'pitchUp',
      'pitchDown',
      'rollLeft',
      'rollRight',
      'toggleScope',
    ],
  },
  {
    title: 'Shape and look',
    help: 'Always the panel you are looking at.',
    commands: [
      'wider',
      'narrower',
      'taller',
      'shorter',
      'sharper',
      'coarser',
      'moreOpaque',
      'lessOpaque',
      'moreBackground',
      'lessBackground',
      'moreCurve',
      'lessCurve',
      'reset',
    ],
  },
];

function plain(name: string): string {
  return name.toLowerCase().replaceAll(/[^a-z\d]/g, '');
}
