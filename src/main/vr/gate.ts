/**
 * When the VR cockpit runs: while `vr.enabled` is on in the settings file, and only while both
 * SteamVR and the game are running. Nothing of the cockpit — its windows, its host, the retries
 * after it, the layout file's polling, its keys — exists outside that, so a commander playing on a
 * monitor pays nothing for it, and SteamVR started for some other game never has EDSSI's panels
 * pushed into it.
 *
 * The programs are looked for every `intervalMs`, and only while the setting is on.
 */

import { ELITE_PROCESS, STEAMVR_PROCESS } from './processes';

/** How often to look for SteamVR and the game while the cockpit is switched on. */
export const GATE_INTERVAL_MS = 5000;

export interface VrGateOptions<T extends { stop(): void }> {
  /** Whether the setting is on now, and word of it changing. */
  enabled(): boolean;
  onEnabledChange(listener: (enabled: boolean) => void): () => void;
  /** The running processes' image names, lower-cased; undefined when they couldn't be listed. */
  running(): Promise<ReadonlySet<string> | undefined>;
  /** Starts the cockpit; called only when it isn't running. */
  start(): T;
  /** Told whenever the cockpit starts or stops, with what is running (undefined once stopped). */
  onChange?(service: T | undefined): void;
  intervalMs?: number;
}

export interface VrGate<T> {
  current(): T | undefined;
  stop(): void;
}

export function startVrGate<T extends { stop(): void }>(options: VrGateOptions<T>): VrGate<T> {
  const intervalMs = options.intervalMs ?? GATE_INTERVAL_MS;
  let service: T | undefined;
  let timer: NodeJS.Timeout | undefined;
  let stopped = false;
  /** What the setting was last seen to say. */
  let on = false;
  /** Bumped whenever a pending look is no longer wanted, so its answer is thrown away. */
  let generation = 0;

  function up(): void {
    if (service !== undefined) return;
    console.log('[vr] SteamVR and the game are running; starting the cockpit');
    try {
      service = options.start();
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
    was.stop();
    options.onChange?.(undefined);
  }

  async function look(): Promise<void> {
    const asked = generation;
    const names = await options.running();
    if (stopped || asked !== generation) return;
    // A listing that failed says nothing either way: leave the cockpit as it is.
    if (names !== undefined) {
      if (names.has(STEAMVR_PROCESS) && names.has(ELITE_PROCESS)) up();
      else down('SteamVR or the game has closed');
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
      was?.stop();
    },
  };
}
