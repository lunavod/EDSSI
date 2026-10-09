import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { startVrGate } from './gate';
import { ELITE_PROCESS, parseTasklist, STEAMVR_PROCESS } from './processes';

describe('parseTasklist', () => {
  it('reads the image names, lower-cased', () => {
    const output =
      '"System Idle Process","0","Services","0","8 K"\r\n' +
      '"EliteDangerous64.exe","1234","Console","1","2,345,678 K"\r\n' +
      '"vrserver.exe","42","Console","1","90,000 K"\r\n';
    expect(parseTasklist(output)).toEqual(
      new Set(['system idle process', ELITE_PROCESS, STEAMVR_PROCESS]),
    );
  });

  it('ignores lines that are not rows', () => {
    expect(
      parseTasklist('INFO: No tasks are running which match the specified criteria.\r\n'),
    ).toEqual(new Set());
  });
});

describe('startVrGate', () => {
  let running: Set<string> | undefined;
  let enabled: boolean;
  let listener: ((enabled: boolean) => void) | undefined;
  let started: { stop: ReturnType<typeof vi.fn> }[];

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    running = new Set();
    enabled = true;
    listener = undefined;
    started = [];
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function gate() {
    return startVrGate({
      enabled: () => enabled,
      onEnabledChange: (next) => {
        listener = next;
        return () => (listener = undefined);
      },
      running: () => Promise.resolve(running),
      start: () => {
        const service = { stop: vi.fn() };
        started.push(service);
        return service;
      },
      intervalMs: 1000,
    });
  }

  it('starts only once SteamVR and the game are both running', async () => {
    const g = gate();
    running = new Set([STEAMVR_PROCESS]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(started).toHaveLength(0);

    running = new Set([STEAMVR_PROCESS, ELITE_PROCESS]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(started).toHaveLength(1);
    expect(g.current()).toBe(started[0]);

    await vi.advanceTimersByTimeAsync(3000);
    expect(started).toHaveLength(1);
    g.stop();
  });

  it('stops when either closes, and starts again when both are back', async () => {
    running = new Set([STEAMVR_PROCESS, ELITE_PROCESS]);
    const g = gate();
    await vi.advanceTimersByTimeAsync(0);
    expect(started).toHaveLength(1);

    running = new Set([STEAMVR_PROCESS]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(started[0]?.stop).toHaveBeenCalledOnce();
    expect(g.current()).toBeUndefined();

    running = new Set([STEAMVR_PROCESS, ELITE_PROCESS]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(started).toHaveLength(2);
    g.stop();
    expect(started[1]?.stop).toHaveBeenCalledOnce();
  });

  it('leaves the cockpit alone when the processes could not be listed', async () => {
    running = new Set([STEAMVR_PROCESS, ELITE_PROCESS]);
    const g = gate();
    await vi.advanceTimersByTimeAsync(0);
    running = undefined;
    await vi.advanceTimersByTimeAsync(1000);
    expect(started[0]?.stop).not.toHaveBeenCalled();
    g.stop();
  });

  it('never looks while switched off, and follows the setting', async () => {
    enabled = false;
    running = new Set([STEAMVR_PROCESS, ELITE_PROCESS]);
    const look = vi.fn(() => Promise.resolve(running));
    const g = startVrGate({
      enabled: () => enabled,
      onEnabledChange: (next) => {
        listener = next;
        return () => (listener = undefined);
      },
      running: look,
      start: () => {
        const service = { stop: vi.fn() };
        started.push(service);
        return service;
      },
      intervalMs: 1000,
    });
    await vi.advanceTimersByTimeAsync(5000);
    expect(look).not.toHaveBeenCalled();

    listener?.(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(started).toHaveLength(1);

    listener?.(false);
    expect(started[0]?.stop).toHaveBeenCalledOnce();
    const looks = look.mock.calls.length;
    await vi.advanceTimersByTimeAsync(5000);
    expect(look.mock.calls.length).toBe(looks);
    g.stop();
    expect(listener).toBeUndefined();
  });
});
