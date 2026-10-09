import { describe, expect, it, vi } from 'vitest';

import type { JournalEvent } from '../../shared/journal';
import { DEFAULT_SETTINGS } from '../../shared/settings';
import { planBackfill, sendBackfill } from './backfill';
import type { SendResult } from './batcher';
import type { EdsmEntry } from './edsm-journal';
import { edsmEncoder, EDSM_TIMING } from './uploads';

// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test lines are partial on purpose
const line = (fields: Record<string, unknown>) => fields as unknown as JournalEvent;
const at = (minute: number) => `2026-09-12T16:${String(minute).padStart(2, '0')}:00Z`;

const jump = (minute: number, system: string) =>
  line({
    timestamp: at(minute),
    event: 'FSDJump',
    StarSystem: system,
    SystemAddress: minute,
    StarPos: [0, 0, minute],
  });

const session = [
  line({ timestamp: at(0), event: 'Fileheader', part: 1, gameversion: '4.4.1.1', build: 'r1 ' }),
  line({ timestamp: at(1), event: 'LoadGame', Commander: 'Jameson', FID: 'F1', Credits: 1 }),
  jump(2, 'Alpha'),
  line({ timestamp: at(3), event: 'Scan', BodyName: 'Alpha 1', StarSystem: 'Alpha' }),
  line({ timestamp: at(3), event: 'Scan', BodyName: 'Alpha 2', StarSystem: 'Alpha' }),
  jump(4, 'Beta'),
  jump(5, 'Gamma'),
];

const encoder = () => edsmEncoder({ ...DEFAULT_SETTINGS.edsm, api_key: 'key' });

describe('planBackfill', () => {
  it('sends what the live upload would have, up to its cursor', () => {
    const everything = planBackfill(session, encoder());
    // The Fileheader comes before the game says who is playing, so EDSM can't be sent it.
    expect(everything.items.map((item) => item.payload.message['event'])).toEqual([
      'LoadGame',
      'FSDJump',
      'Scan',
      'Scan',
      'FSDJump',
      'FSDJump',
    ]);
    // Two lines share a timestamp; the second is the one after the first.
    expect(everything.items[3]?.position).toEqual({ timestamp: at(3), index: 1 });

    const upToCursor = planBackfill(session, encoder(), { timestamp: at(3), index: 1 });
    expect(upToCursor.items.map((item) => item.payload.message['event'])).toEqual([
      'LoadGame',
      'FSDJump',
      'Scan',
    ]);
    expect(upToCursor.alreadySent).toBe(3);
  });

  it('holds back a beta', () => {
    const beta = [
      line({ timestamp: at(0), event: 'Fileheader', part: 1, gameversion: '4.5 Beta', build: 'b' }),
      jump(1, 'Alpha'),
    ];
    const plan = planBackfill(beta, encoder());
    expect(plan.items).toEqual([]);
    expect([...plan.held.values()]).toEqual([2]);
  });
});

describe('sendBackfill', () => {
  it('sends in batches, retries what may pass, and logs every request', async () => {
    const { items } = planBackfill(session, encoder());
    const answers: SendResult[] = [
      { kind: 'sent', accepted: 3, consumed: 4 },
      { kind: 'retry', message: 'offline' },
      { kind: 'sent', accepted: 1, refused: [{ event: 'FSDJump', message: 'nope' }] },
    ];
    const send = vi.fn(async (_batch: readonly EdsmEntry[]) => answers.shift()!);
    const log = vi.fn();
    const sleep = vi.fn(async () => {});

    const outcome = await sendBackfill({
      target: 'edsm',
      items,
      encoder: encoder(),
      timing: { ...EDSM_TIMING, maxBatch: 5 },
      send,
      log,
      sleep,
    });

    expect(send.mock.calls.map(([batch]) => batch.length)).toEqual([5, 2, 2]);
    expect(outcome).toEqual({ accepted: 4, answered: 6, requests: 3 });
    expect(log.mock.calls.map(([entry]) => [entry.outcome, entry.events, entry.systems])).toEqual([
      ['sent', 4, ['Alpha']],
      ['retry', 2, ['Beta', 'Gamma']],
      ['sent', 2, ['Beta', 'Gamma']],
    ]);
    expect(log.mock.calls[0]?.[0]).toMatchObject({
      source: 'backfill',
      eventCounts: { LoadGame: 1, FSDJump: 1, Scan: 2 },
    });
  });

  it('stops when the key is refused', async () => {
    const { items } = planBackfill(session, encoder());
    const outcome = await sendBackfill({
      target: 'edsm',
      items,
      encoder: encoder(),
      timing: EDSM_TIMING,
      send: async () => ({ kind: 'rejected', message: 'EDSM: bad key (203)' }),
      log: () => {},
      sleep: async () => {},
    });
    expect(outcome).toEqual({
      accepted: 0,
      answered: 0,
      requests: 1,
      stopped: 'EDSM: bad key (203)',
    });
  });
});
