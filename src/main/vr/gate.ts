/**
 * When the VR cockpit runs, and how: while `vr.enabled` is on in the settings file, and only while
 * the game is running in VR. Nothing of the cockpit — its windows, its host, the retries after it,
 * the layout file's polling, its keys — exists outside that, so a commander playing on a monitor
 * pays nothing for it, and a VR runtime started for some other game never has EDSSI's panels pushed
 * into it.
 *
 * Two ways to reach the headset (`VrBackend` in the settings): SteamVR overlays while SteamVR is
 * running (`openvr`), or EDSSI's OpenXR API layer inside the game (`openxr`) when the game is on
 * another OpenXR runtime — Virtual Desktop's, with EDVR — and has the OpenXR loader loaded. `auto`
 * prefers SteamVR. A change of which one applies restarts the cockpit on the other.
 *
 * The programs are looked for every `intervalMs`, and only while the setting is on.
 */

import type { VrBackend } from '../../shared/settings';
import { ELITE_PROCESS, STEAMVR_PROCESS } from './processes';

/** How often to look for SteamVR and the game while the cockpit is switched on. */
export const GATE_INTERVAL_MS = 5000;

/** The way the cockpit is actually reaching the headset; `auto` is never one. */
export type VrRoute = Exclude<VrBackend, 'auto'>;

export interface VrGateOptions<T extends { stop(): void }> {
  /** Whether the setting is on now, and word of it changing. */
  enabled(): boolean;
  onEnabledChange(listener: (enabled: boolean) => void): () => void;
  /** Which backend the settings ask for; `auto` when left out. Read at every look. */
  backend?(): VrBackend;
  /** The running processes' image names, lower-cased; undefined when they couldn't be listed. */
  running(): Promise<ReadonlySet<string> | undefined>;
  /**
   * Whether the game has OpenXR loaded; undefined when that couldn't be found out. Asked only when
   * the answer matters: the game is running and SteamVR is not taking the cockpit.
   */
  openxr?(): Promise<boolean | undefined>;
  /** Starts the cockpit on a route; called only when it isn't running. */
  start(route: VrRoute): T;
  /** Told whenever the cockpit starts or stops, with what is running (undefined once stopped). */
  onChange?(service: T | undefined): void;
  intervalMs?: number;
}

export interface VrGate<T> {
  current(): T | undefined;
  stop(): void;
}

/**
 * Which route the cockpit should take given what is running, or undefined for none. `openxr` is
 * whether the game has the OpenXR loader in it.
 */
export function chooseRoute(
  names: ReadonlySet<string>,
  openxr: boolean | undefined,
  backend: VrBackend,
): VrRoute | undefined {
  if (!names.has(ELITE_PROCESS)) return undefined;
  const steamvr = names.has(STEAMVR_PROCESS);
  if (backend === 'openvr') return steamvr ? 'openvr' : undefined;
  if (backend === 'openxr') return openxr === true ? 'openxr' : undefined;
  if (steamvr) return 'openvr';
  return openxr === true ? 'openxr' : undefined;
}

export function startVrGate<T extends { stop(): void }>(options: VrGateOptions<T>): VrGate<T> {
  const intervalMs = options.intervalMs ?? GATE_INTERVAL_MS;
  let service: T | undefined;
  let route: VrRoute | undefined;
  let timer: NodeJS.Timeout | undefined;
  let stopped = false;
  /** What the setting was last seen to say. */
  let on = false;
  /** Bumped whenever a pending look is no longer wanted, so its answer is thrown away. */
  let generation = 0;

  function up(wanted: VrRoute): void {
    if (service !== undefined && route === wanted) return;
    if (service !== undefined) down(`the game is now in VR through ${wanted}`);
    console.log(
      wanted === 'openvr'
        ? '[vr] SteamVR and the game are running; starting the cockpit'
        : '[vr] the game is in VR through OpenXR; starting the cockpit on the OpenXR layer',
    );
    try {
      service = options.start(wanted);
      route = wanted;
    } catch (error) {
      // Tried again at the next look rather than never.
      console.error('[vr] the cockpit could not be started', error);
      return;
    }
    options.onChange?.(service);
  }

  function down(why: string): void {
    if (service === undefined) return;
    console.log(`[vr] ${why}; stopping the cockpit`);
    const was = service;
    service = undefined;
    route = undefined;
    was.stop();
    options.onChange?.(undefined);
  }

  async function look(): Promise<void> {
    const asked = generation;
    const names = await options.running();
    if (stopped || asked !== generation) return;
    // A listing that failed says nothing either way: leave the cockpit as it is.
    if (names !== undefined) {
      const backend = options.backend?.() ?? 'auto';
      const steamvrTakes = names.has(STEAMVR_PROCESS) && backend !== 'openxr';
      const askOpenxr = names.has(ELITE_PROCESS) && !steamvrTakes && backend !== 'openvr';
      const openxr = askOpenxr && options.openxr ? await options.openxr() : false;
      if (stopped || asked !== generation) return;
      // An OpenXR question that went unanswered leaves an OpenXR cockpit as it is.
      if (openxr === undefined && route === 'openxr') {
        timer = setTimeout(() => void look(), intervalMs);
        return;
      }
      const wanted = chooseRoute(names, openxr, backend);
      if (wanted !== undefined) up(wanted);
      else down('the game is no longer in VR');
    }
    timer = setTimeout(() => void look(), intervalMs);
  }

  function apply(enabled: boolean): void {
    on = enabled;
    generation++;
    clearTimeout(timer);
    timer = undefined;
    if (enabled) void look();
    else down('the VR cockpit was switched off');
  }

  const unwatch = options.onEnabledChange((enabled) => {
    if (stopped) return;
    // A save of any other setting lands here too; only a change of this one matters.
    if (enabled === on) return;
    apply(enabled);
  });
  apply(options.enabled());

  return {
    current: () => service,
    stop() {
      stopped = true;
      generation++;
      unwatch();
      clearTimeout(timer);
      timer = undefined;
      const was = service;
      service = undefined;
      route = undefined;
      was?.stop();
    },
  };
}
