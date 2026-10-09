/**
 * The bridge to `native/hid-usages`: what a stick's controls actually are, as Windows parsed them.
 *
 * Optional at runtime. The addon has to be compiled, and a machine without a compiler — or a build
 * that predates it — should still run everything else, so a failure to load is reported once and
 * the caller falls back to reading raw bytes.
 *
 * Nothing here opens a device for reading. `joystick.ts` keeps doing the I/O with `node-hid`; this
 * only says what the bytes mean.
 */

import { createRequire } from 'node:module';
import { join } from 'node:path';

import { BUTTON_USAGE_PAGE, type ControlBinding, USAGE_NAMES } from '../../shared/input';

/** One value control — an axis, a slider, or a hat — with the range the device declares. */
export interface ValueCap {
  usagePage: number;
  usage: number;
  logicalMin: number;
  logicalMax: number;
  bitSize: number;
  /** A hat says "centred" with a value outside its range rather than with a number. */
  hasNull: boolean;
}

export interface DescribedDevice {
  /** Opaque; handed back to `decode`. */
  device: unknown;
  reportLength: number;
  values: ValueCap[];
  buttons: { usagePage: number; usageMin: number; usageMax: number }[];
}

interface Addon {
  open(path: string): DescribedDevice;
  decode(
    device: unknown,
    report: Buffer,
  ): {
    values: { usagePage: number; usage: number; value: number }[];
    buttons: { usagePage: number; usage: number }[];
  };
}

let addon: Addon | undefined;
let attempted = false;
let problem: string | undefined;

/**
 * Native code can't be bundled, so the addon is found at runtime rather than imported: a path the
 * bundler can see would be pulled into `out/main` and break the build. The same reason
 * `electron.vite.config.ts` externalizes node-hid and uiohook-napi.
 */
function load(): Addon | undefined {
  if (attempted) return addon;
  attempted = true;

  const here = createRequire(import.meta.url);
  const candidates = [
    // Built from source: out/main/ in a build, src/main/input/ under the dev server.
    join(import.meta.dirname, '../../native/hid-usages'),
    join(import.meta.dirname, '../../../native/hid-usages'),
    // Packaged, where it would ride along as an extraResource.
    join(process.resourcesPath ?? '', 'hid-usages'),
  ];

  for (const candidate of candidates) {
    try {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- it has no types of its own.
      addon = here(candidate) as Addon;
      return addon;
    } catch (error) {
      problem = error instanceof Error ? error.message : String(error);
    }
  }

  console.error(`[input] hid-usages could not be loaded, falling back to raw bytes: ${problem}`);
  return addon;
}

/** Why named controls aren't available, if they aren't. */
export function usagesProblem(): string | undefined {
  load();
  return problem;
}

export function describeDevice(path: string): DescribedDevice | undefined {
  const api = load();
  if (api === undefined) return undefined;
  try {
    return api.open(path);
  } catch (error) {
    console.error(`[input] could not describe a device: ${String(error)}`);
    return undefined;
  }
}

/** What one device is reporting right now, ready for `held` and `axisValue` to be asked of it. */
export interface ControlState {
  /** Value controls by usage: the axes, the sliders and the hat. */
  values: Map<number, number>;
  /** Buttons that are down, keyed `${usagePage}:${usage}`. */
  down: Set<string>;
}

export function decodeReport(
  described: DescribedDevice,
  report: Buffer,
  into: ControlState,
): boolean {
  const api = load();
  if (api === undefined) return false;
  try {
    const decoded = api.decode(described.device, report);
    // A decode that produced nothing at all is a report this state knows nothing about — a kind
    // HidP refused, or one that arrived malformed. Taking it for "every control is at rest" is
    // what made a held button look briefly let go, and so one press look like two; leaving the
    // last thing this report id actually said is both truer and quieter.
    if (decoded.values.length === 0 && decoded.buttons.length === 0) return true;

    into.values.clear();
    for (const value of decoded.values) into.values.set(value.usage, value.value);
    into.down.clear();
    for (const button of decoded.buttons) into.down.add(`${button.usagePage}:${button.usage}`);
    return true;
  } catch {
    return false;
  }
}

/**
 * How far past centre an axis has to be pushed to count as held. Generous: this is a control being
 * used as a button, not an aiming axis, and a ministick's centre wanders.
 */
export const AXIS_THRESHOLD = 0.45;

/** Where an axis sits, from −1 to 1, with the middle of its declared range as zero. */
export function axisValue(cap: ValueCap, raw: number): number {
  const span = cap.logicalMax - cap.logicalMin;
  if (span <= 0) return 0;
  return ((raw - cap.logicalMin) / span) * 2 - 1;
}

/** Whether one named control is held, given what its device last reported. */
export function controlHeld(
  binding: ControlBinding,
  state: ControlState,
  caps: readonly ValueCap[],
): boolean {
  if (binding.mode === 'button') {
    return state.down.has(`${binding.usagePage}:${binding.usage}`);
  }

  const raw = state.values.get(binding.usage);
  if (raw === undefined) return false;
  if (binding.mode === 'hat') return raw === binding.value;

  const cap = caps.find((candidate) => candidate.usage === binding.usage);
  if (cap === undefined) return false;
  const value = axisValue(cap, raw);
  return binding.direction === 'low' ? value <= -AXIS_THRESHOLD : value >= AXIS_THRESHOLD;
}

/** A readable name for a control EDSSI has found, for the settings screen. */
export function capName(cap: ValueCap): string {
  if (cap.usagePage === BUTTON_USAGE_PAGE) return `button ${cap.usage}`;
  return USAGE_NAMES[cap.usage] ?? `usage 0x${cap.usage.toString(16)}`;
}

/**
 * How far an axis has to be pushed to be taken as a binding. Higher than `AXIS_THRESHOLD`, which
 * is how far it has to stay to count as held: binding a control is a deliberate shove, and being
 * generous there would bind whichever axis the commander's hand was resting against.
 */
export const CAPTURE_AXIS_THRESHOLD = 0.7;

/**
 * Whether a value control is a hat rather than an axis. A hat says "centred" with a value outside
 * the range it declares — which is what `hasNull` means — and the Generic Desktop tables give it a
 * usage of its own, so either is proof enough.
 */
export function isHat(cap: ValueCap): boolean {
  return cap.hasNull || cap.usage === 0x39;
}

/** Whether a hat is being pushed, as opposed to sitting in the middle. */
export function hatPushed(cap: ValueCap, raw: number | undefined): boolean {
  return raw !== undefined && raw >= cap.logicalMin && raw <= cap.logicalMax;
}

/** One control found held during a capture, before the device it belongs to has been named. */
export interface ControlPress {
  usagePage: number;
  usage: number;
  mode: 'button' | 'hat' | 'axis';
  value?: number;
  direction?: 'low' | 'high';
}

/**
 * Every control that is held now and wasn't when the capture started.
 *
 * This is the whole of capture-by-moving, and it is this short because Windows has already parsed
 * the report descriptor: there is no telling a button from an axis by how its bits behave, because
 * the device has said which is which. What is left is only "what changed since the commander was
 * asked" — which is why the baseline matters. A stick whose throttle is already forward, or whose
 * trigger is already down, must not bind that the moment the screen starts listening.
 *
 * Buttons come first, then hats, then axes: that is the order of how likely each is to be what was
 * meant, and a shove of a ministick moves two axes at once.
 */
export function pressedControls(
  caps: readonly ValueCap[],
  state: ControlState,
  baseline: ControlState,
): ControlPress[] {
  const found: ControlPress[] = [];

  for (const key of state.down) {
    if (baseline.down.has(key)) continue;
    const [page, usage] = key.split(':').map(Number);
    if (page === undefined || usage === undefined) continue;
    found.push({ usagePage: page, usage, mode: 'button' });
  }

  const hats: ControlPress[] = [];
  const axes: ControlPress[] = [];
  for (const cap of caps) {
    const raw = state.values.get(cap.usage);
    const was = baseline.values.get(cap.usage);
    if (raw === undefined) continue;

    if (isHat(cap)) {
      // A hat that was already being held when the capture began is left alone until it centres.
      if (!hatPushed(cap, raw) || (hatPushed(cap, was) && was === raw)) continue;
      hats.push({ usagePage: cap.usagePage, usage: cap.usage, mode: 'hat', value: raw });
      continue;
    }

    const now = axisValue(cap, raw);
    const before = was === undefined ? 0 : axisValue(cap, was);
    if (Math.abs(now) < CAPTURE_AXIS_THRESHOLD) continue;
    if (Math.abs(before) >= CAPTURE_AXIS_THRESHOLD) continue;
    axes.push({
      usagePage: cap.usagePage,
      usage: cap.usage,
      mode: 'axis',
      direction: now < 0 ? 'low' : 'high',
    });
  }

  return [...found, ...hats, ...axes];
}

/**
 * How hard a control is being held, from 0 to 1. A button is all or nothing; an axis is how far
 * past its threshold it has been pushed, which is what makes scrolling on a ministick go faster
 * the further it is pushed rather than at one speed whatever the commander does.
 */
export function controlStrength(
  binding: ControlBinding,
  state: ControlState,
  caps: readonly ValueCap[],
): number {
  if (binding.mode !== 'axis') return controlHeld(binding, state, caps) ? 1 : 0;
  const cap = caps.find((candidate) => candidate.usage === binding.usage);
  const raw = state.values.get(binding.usage);
  if (cap === undefined || raw === undefined) return 0;
  const value = axisValue(cap, raw);
  const pushed = binding.direction === 'low' ? -value : value;
  if (pushed < AXIS_THRESHOLD) return 0;
  return Math.min(1, pushed);
}
