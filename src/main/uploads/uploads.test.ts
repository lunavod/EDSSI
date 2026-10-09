import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { JournalEvent } from '../../shared/journal';
import { DEFAULT_SETTINGS } from '../../shared/settings';
import { UPLOAD_TARGETS, type UploadTarget } from '../../shared/uploads';
import type { JournalPosition, SendResult } from './batcher';
import type { EddnEntry } from './eddn';
import type { EdsmEntry } from './edsm-journal';
import type { InaraEntry } from './inara-api';
import { type UploadSettings, Uploads } from './uploads';

// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test lines are partial on purpose
const line = (fields: Record<string, unknown>) => fields as unknown as JournalEvent;

const at = (minute: number) => `2026-09-12T16:${String(minute).padStart(2, '0')}:00Z`;

const session = [
  line({ timestamp: at(0), event: 'Fileheader', part: 1, gameversion: '4.4.1.1', build: 'r1 ' }),
  line({ timestamp: at(1), event: 'LoadGame', Commander: 'Jameson', FID: 'F1', Credits: 1000 }),
  line({
    timestamp: at(1),
    event: 'Location',
    StarSystem: 'Sol',
    SystemAddress: 10477373803,
    StarPos: [0, 0, 0],
    Docked: false,
  }),
  line({
    timestamp: at(5),
    event: 'FSDJump',
    StarSystem: 'Alpha Centauri',
    SystemAddress: 1458376315610,
    StarPos: [3, 0, 3],
    JumpDist: 4.38,
  }),
];

const withKeys = (edsm = {}, inara = {}, eddn = { upload: false }): UploadSettings => ({
  edsm: { ...DEFAULT_SETTINGS.edsm, api_key: 'edsm-key', ...edsm },
  inara: { ...DEFAULT_SETTINGS.inara, api_key: 'inara-key', ...inara },
  eddn: { ...DEFAULT_SETTINGS.eddn, ...eddn },
});

function setup(cursor?: JournalPosition) {
  const cursors = new Map<UploadTarget, JournalPosition>();
  if (cursor) {
    for (const target of UPLOAD_TARGETS) cursors.set(target, cursor);
  }
  const edsm = vi.fn(
    async (batch: readonly EdsmEntry[], _credentials: object): Promise<SendResult> => ({
      kind: 'sent',
      accepted: batch.length,
    }),
  );
  const inara = vi.fn(async (batch: readonly InaraEntry[], _key: string): Promise<SendResult> => ({
    kind: 'sent',
    accepted: batch.length,
  }));
  const eddn = vi.fn(async (batch: readonly EddnEntry[]): Promise<SendResult> => ({
    kind: 'sent',
    accepted: batch.length,
  }));
  const uploads = new Uploads({
    cursors: { get: (target) => cursors.get(target), set: (t, p) => void cursors.set(t, p) },
    edsm: { send: edsm },
    inara: { send: inara },
    eddn: { send: eddn },
    readCompanion: () => undefined,
    onChange: () => {},
  });
  return { uploads, cursors, edsm, inara, eddn };
}

const edsmEvents = (send: ReturnType<typeof setup>['edsm']) =>
  send.mock.calls.flatMap(([batch]) => batch.map((entry) => entry.message['event']));
const inaraEvents = (send: ReturnType<typeof setup>['inara']) =>
  send.mock.calls.flatMap(([batch]) => batch.map((entry) => entry.event.eventName));

describe('Uploads', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(at(3));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts from now the first time, not from a session that's already been played", async () => {
    const { uploads, cursors, edsm, inara } = setup();
    uploads.configure(withKeys(), []);
    for (const event of session) uploads.apply(event);
    await vi.advanceTimersByTimeAsync(0);

    expect(edsmEvents(edsm)).toEqual(['FSDJump']);
    expect(inaraEvents(inara)).toEqual(['addCommanderTravelFSDJump']);
    expect(edsm.mock.calls[0]![0][0]).toMatchObject({ commander: 'Jameson', gameBuild: 'r1' });
    expect(cursors.get('edsm')).toEqual({ timestamp: at(5), index: 0 });
  });

  it('carries on from the cursor, so nothing is sent twice or missed across a restart', async () => {
    const { uploads, edsm } = setup({ timestamp: at(1), index: 0 });
    uploads.configure(withKeys(), []);
    for (const event of session) uploads.apply(event);
    await vi.advanceTimersByTimeAsync(0);
    // The LoadGame at 16:01 was sent last time; the Location in the same second wasn't.
    expect(edsmEvents(edsm)).toEqual(['Location', 'FSDJump']);
  });

  it('replays the session into a service when its settings change', async () => {
    const { uploads, edsm, inara } = setup({ timestamp: at(0), index: 0 });
    uploads.configure(withKeys({ api_key: null }), []);
    for (const event of session) uploads.apply(event);
    await vi.advanceTimersByTimeAsync(0);
    expect(edsm).not.toHaveBeenCalled();
    expect(uploads.snapshot().targets[0]).toMatchObject({ target: 'edsm', state: 'off' });

    uploads.configure(withKeys(), session);
    await vi.advanceTimersByTimeAsync(0);
    expect(edsmEvents(edsm)).toEqual(['LoadGame', 'Location', 'FSDJump']);
    // Inara's settings didn't change, so it wasn't restarted and sent nothing twice.
    expect(inaraEvents(inara)).toEqual([
      'setCommanderCredits',
      'setCommanderTravelLocation',
      'addCommanderTravelFSDJump',
    ]);
  });

  it('sends to EDDN without a key', async () => {
    const { uploads, eddn } = setup({ timestamp: at(0), index: 0 });
    uploads.configure(withKeys({ upload: false }, { upload: false }, { upload: true }), []);
    for (const event of session) uploads.apply(event);
    await vi.advanceTimersByTimeAsync(0);
    const sent = eddn.mock.calls.flatMap(([batch]) => batch);
    expect(sent.map((entry) => [entry.schema, entry.message['event']])).toEqual([
      ['journal/1', 'Location'],
      ['journal/1', 'FSDJump'],
    ]);
    expect(sent[1]!.message).not.toHaveProperty('JumpDist');
    expect(sent[1]!.header).toEqual({
      uploaderID: 'Jameson',
      gameversion: '4.4.1.1',
      gamebuild: 'r1 ',
    });
    expect(uploads.snapshot().targets.find((t) => t.target === 'eddn')?.state).toBe('waiting');
  });

  it("pauses EDSM for a commander that isn't the one in the settings", async () => {
    const { uploads, edsm } = setup({ timestamp: at(0), index: 0 });
    uploads.configure(withKeys({ commander_name: 'Someone Else' }), []);
    for (const event of session) uploads.apply(event);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(edsm).not.toHaveBeenCalled();
    expect(uploads.snapshot().targets[0]).toMatchObject({
      state: 'paused',
      message: 'Playing as Jameson, not Someone Else.',
    });
  });

  it('sends nothing from a beta', async () => {
    const { uploads, edsm, inara } = setup({ timestamp: at(0), index: 0 });
    uploads.configure(withKeys(), []);
    const beta = line({ ...session[0], gameversion: '4.5.0.0 Beta' });
    for (const event of [beta, ...session.slice(1)]) uploads.apply(event);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(edsm).not.toHaveBeenCalled();
    expect(inara).not.toHaveBeenCalled();
    expect(uploads.snapshot().targets[1]).toMatchObject({ state: 'paused' });
  });
});
