/**
 * Push-to-talk bindings, as both sides talk about them. A binding is either a key chord or one
 * button on one device; the commander may have several, and any of them holds the microphone open.
 */

/** A keyboard chord, written the way Electron accelerators are (`Control+Alt+Space`). */
export interface KeyBinding {
  kind: 'key';
  accelerator: string;
}

/**
 * One button on one HID device, identified by where its bit sits in the device's input report.
 * EDSSI learns that position by watching the report while the commander presses the button, so it
 * needs no knowledge of the device beyond what it sends.
 */
export interface ButtonBinding {
  kind: 'button';
  vendorId: number;
  productId: number;
  /** Tells two identical sticks apart. Empty on devices that don't report one (VKB's don't). */
  serial?: string;
  /** Shown to the commander; never used to match the device. */
  product?: string;
  /** 0 when the device sends unnumbered reports. */
  reportId: number;
  /** Byte of the input report holding the bit, counted as the device sends it. */
  byte: number;
  /** 0–7, least significant first. */
  bit: number;
}

/**
 * Generic Desktop usages, by the names the HID tables give them. `R` means "rotation about", so
 * `Rz` is a stick's twist; a ministick is usually `Rx`/`Ry`.
 */
export const USAGE_NAMES: Readonly<Record<number, string>> = {
  0x30: 'X',
  0x31: 'Y',
  0x32: 'Z',
  0x33: 'Rx',
  0x34: 'Ry',
  0x35: 'Rz',
  0x36: 'Slider',
  0x37: 'Dial',
  0x38: 'Wheel',
  0x39: 'Hat',
};

/** The usage page holding the buttons; Generic Desktop (1) holds the axes and the hat. */
export const BUTTON_USAGE_PAGE = 9;
export const GENERIC_DESKTOP_USAGE_PAGE = 1;

/**
 * One control on one device, named the way the device's own descriptor names it.
 *
 * This is what `ButtonBinding` should have been. Windows has already parsed the report descriptor,
 * so `native/hid-usages` can say "this is Rx, and it runs 0 to 1023" rather than EDSSI guessing
 * which byte moved. A binding written this way means the same thing on any stick, and an axis's
 * real range is known before it has ever been moved.
 */
export interface ControlBinding {
  kind: 'control';
  vendorId: number;
  productId: number;
  serial?: string;
  /** Shown to the commander; never used to match the device. */
  product?: string;
  usagePage: number;
  usage: number;
  /** How "held" is worked out, which differs by the kind of control. */
  mode: 'button' | 'hat' | 'axis';
  /** `hat` only: the value the control takes while this binding is held. */
  value?: number;
  /** `axis` only: which side of centre counts as held. */
  direction?: 'low' | 'high';
}

export type InputBinding = KeyBinding | ButtonBinding | ControlBinding;

/** Anything bound to a device rather than to the keyboard. */
export type DeviceBinding = ButtonBinding | ControlBinding;

export function isDeviceBinding(binding: InputBinding): binding is DeviceBinding {
  return binding.kind !== 'key';
}

/** A device EDSSI can bind buttons on, for the settings screen. */
export interface InputDevice {
  vendorId: number;
  productId: number;
  serial?: string;
  product: string;
  manufacturer?: string;
  /** It is open and sending reports. */
  connected: boolean;
}

/** What the settings screen shows while it waits for the commander to press something. */
export interface CaptureResult {
  binding: InputBinding;
  label: string;
}

/** Which bindings are held down right now, keyed by `bindingKey`, so the UI can light them up. */
export type BindingState = Record<string, boolean>;

/** Pushed to windows whenever a device, a binding or a capture changes. */
export interface InputSnapshot {
  version: number;
  devices: InputDevice[];
  state: BindingState;
  /** EDSSI is waiting for the commander to press something. */
  capturing: boolean;
  /** A binding is held: the microphone should be open. */
  talking: boolean;
  /** A part of the input layer that couldn't start, and what it costs. */
  problem?: string;
}

/**
 * A stable key for one binding, used to match a binding to its live state and to spot duplicates.
 * Two bindings with the same key are the same input.
 */
export function bindingKey(binding: InputBinding): string {
  if (binding.kind === 'key') return `key:${binding.accelerator.toLowerCase()}`;
  const device = `${hex(binding.vendorId)}:${hex(binding.productId)}:${binding.serial ?? ''}`;
  if (binding.kind === 'control') {
    const { usagePage, usage, mode, value, direction } = binding;
    return `control:${device}:${usagePage}:${usage}:${mode}:${value ?? ''}:${direction ?? ''}`;
  }

  return `button:${device}:${binding.reportId}:${binding.byte}:${binding.bit}`;
}

/** The eight directions a hat reports, clockwise from up, as the commander would name them. */
const HAT_DIRECTIONS = [
  'up',
  'up-right',
  'right',
  'down-right',
  'down',
  'down-left',
  'left',
  'up-left',
];

/** What one control is called: `Rx`, `Hat up`, `button 35`. */
export function controlName(binding: ControlBinding): string {
  if (binding.mode === 'button') return `button ${binding.usage}`;
  const name = USAGE_NAMES[binding.usage] ?? `usage 0x${binding.usage.toString(16)}`;
  if (binding.mode === 'hat') {
    return `${name} ${HAT_DIRECTIONS[binding.value ?? 0] ?? binding.value}`;
  }

  return `${name} ${binding.direction === 'low' ? '−' : '+'}`;
}

/**
 * EDSSI's own number for a button: where its bit sits in the report. It won't match the number
 * printed in the device's own software, so the settings screen lights the binding up when it is
 * held rather than asking the commander to trust the number.
 */
export function buttonNumber(binding: ButtonBinding): number {
  return binding.byte * 8 + binding.bit;
}

/** What the commander reads: `Control+Alt+Space`, or `Gladiator EVO R · button 35`. */
export function bindingLabel(binding: InputBinding): string {
  if (binding.kind === 'key') return binding.accelerator;
  const name = binding.product?.trim() || `${hex(binding.vendorId)}:${hex(binding.productId)}`;
  if (binding.kind === 'control') return `${name} · ${controlName(binding)}`;
  return `${name} · button ${buttonNumber(binding)}`;
}

/** Matches a binding to a device, whatever port it was plugged into this time. */
export function bindingMatchesDevice(binding: DeviceBinding, device: InputDevice): boolean {
  return (
    binding.vendorId === device.vendorId &&
    binding.productId === device.productId &&
    // Only tell apart by serial when both sides have one; VKB's sticks report none.
    (!binding.serial || !device.serial || binding.serial === device.serial)
  );
}

function hex(value: number): string {
  return value.toString(16).padStart(4, '0');
}

/**
 * How a binding has to be pressed before it counts, and what holding it does afterwards.
 *
 * A stick has fewer buttons than a cockpit has commands, so one button can carry more than one:
 * a press, a double click and a triple click are three different commands on the same button. The
 * cost is that a button with a double click bound has to wait `MULTI_CLICK_MS` to find out whether
 * a second press is coming — so only the buttons that actually need it are delayed, and every
 * other binding fires the moment it goes down.
 */
export interface PressOptions {
  /** How many presses in quick succession: 1 (the default), 2 or 3. */
  clicks?: number;
  /**
   * Keep firing while it is held, the way an arrow key repeats. Unset means whatever the command
   * asks for — scrolling repeats, showing and hiding the cockpit does not.
   */
  repeat?: boolean;
}

/** What one command is bound to: the input, and how it has to be pressed. */
export type BoundAction = PressOptions & { binding: InputBinding };

/** A stable key for a binding and the way it is pressed, so two rows can't mean the same press. */
export function actionKey(action: BoundAction): string {
  return `${bindingKey(action.binding)}#${action.clicks ?? 1}`;
}

/** `double click`, `triple click`, or nothing at all for an ordinary press. */
export function clicksLabel(clicks: number | undefined): string | undefined {
  if (clicks === undefined || clicks <= 1) return undefined;
  return clicks === 2 ? 'double click' : clicks === 3 ? 'triple click' : `${clicks} clicks`;
}

/** What the commander reads for a whole binding: `Gladiator EVO R · button 35 (double click)`. */
export function actionLabel(action: BoundAction): string {
  const clicks = clicksLabel(action.clicks);
  return `${bindingLabel(action.binding)}${clicks === undefined ? '' : ` (${clicks})`}`;
}
