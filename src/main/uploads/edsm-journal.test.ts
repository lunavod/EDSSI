import { describe, expect, it, vi } from 'vitest';

import type { JournalEvent } from '../../shared/journal';
import { EdsmJournalApi, edsmEntry, type EdsmEntry } from './edsm-journal';
import { type GameState, initialGameState } from './game-state';

// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test lines are partial on purpose
const line = (fields: Record<string, unknown>) => fields as unknown as JournalEvent;

const state: GameState = {
  ...initialGameState(),
  commander: 'Jameson',
  gameVersion: '4.4.1.1',
  gameBuild: 'r332841/r0',
  systemName: 'Sol',
  systemAddress: 10477373803n,
  coordinates: [0, 0, 0],
  stationName: 'Galileo',
  marketId: 128016640,
  shipId: 7,
};

const software = { name: 'EDSSI', version: '0.1.0' };

function entry(event: string, fields: Record<string, unknown> = {}): EdsmEntry {
  return edsmEntry(line({ timestamp: '2026-09-12T16:00:00Z', event, ...fields }), state)!;
}

/** Answers the discard list and the journal endpoint, recording what was posted. */
function fakeEdsm(reply: unknown, discard: unknown = ['Music'], init: ResponseInit = {}) {
  const posts: URLSearchParams[] = [];
  const fetch = vi.fn(async (url: string | URL | Request, request?: RequestInit) => {
    const path = new URL(url instanceof Request ? url.url : url).pathname;
    if (path.endsWith('/discard')) return Response.json(discard);
    posts.push(new URLSearchParams(request?.body instanceof URLSearchParams ? request.body : ''));
    return Response.json(reply, init);
  });
  return { fetch, posts };
}

describe('edsmEntry', () => {
  it('adds where the commander was, keeping 64-bit addresses exact', () => {
    const result = entry('MissionAccepted', { MissionID: 1 });
    expect(result).toMatchObject({ commander: 'Jameson', gameVersion: '4.4.1.1' });
    expect(result.message).toMatchObject({
      event: 'MissionAccepted',
      _systemName: 'Sol',
      _systemAddress: 10477373803n,
      _systemCoordinates: [0, 0, 0],
      _stationName: 'Galileo',
      _marketId: 128016640,
      _shipId: 7,
    });
  });

  it('leaves out a Cargo line that only points at Cargo.json', () => {
    expect(edsmEntry(line({ event: 'Cargo', Vessel: 'Ship', Count: 16 }), state)).toBeUndefined();
  });

  it('waits until it knows the commander', () => {
    const anonymous = { ...state, commander: undefined };
    expect(edsmEntry(line({ event: 'Docked' }), anonymous)).toBeUndefined();
  });
});

describe('EdsmJournalApi', () => {
  it('posts the batch with the commander, key and build, minus discarded events', async () => {
    const { fetch, posts } = fakeEdsm({
      msgnum: 100,
      msg: 'OK',
      events: [{ msgnum: 100 }, { msgnum: 101 }],
    });
    const api = new EdsmJournalApi({ software, fetch });
    const result = await api.send([entry('FSDJump'), entry('Music'), entry('Docked')], {
      apiKey: 'key',
    });

    expect(result).toEqual({
      kind: 'sent',
      accepted: 2,
      consumed: 3,
      holdMs: undefined,
      skipped: 1,
      refused: [],
      message: 'OK (100)',
    });
    const body = posts[0]!;
    expect(body.get('commanderName')).toBe('Jameson');
    expect(body.get('apiKey')).toBe('key');
    expect(body.get('fromSoftware')).toBe('EDSSI');
    expect(body.get('fromGameVersion')).toBe('4.4.1.1');
    expect(body.get('fromGameBuild')).toBe('r332841/r0');
    const message = body.get('message')!;
    expect(message).toContain('"_systemAddress":10477373803');
    expect((JSON.parse(message) as { event: string }[]).map((e) => e.event)).toEqual([
      'FSDJump',
      'Docked',
    ]);
  });

  it('sends one build at a time', async () => {
    const { fetch, posts } = fakeEdsm({ msgnum: 100, msg: 'OK', events: [{ msgnum: 100 }] });
    const api = new EdsmJournalApi({ software, fetch });
    const newer = { ...entry('Docked'), gameBuild: 'r400000/r0' };
    const result = await api.send([entry('FSDJump'), newer], { apiKey: 'key' });
    expect(result).toMatchObject({ kind: 'sent', consumed: 1 });
    expect(posts).toHaveLength(1);
  });

  it('sends as the commander named in the settings', async () => {
    const { fetch, posts } = fakeEdsm({ msgnum: 100, msg: 'OK' });
    const api = new EdsmJournalApi({ software, fetch });
    await api.send([entry('FSDJump')], { apiKey: 'key', commanderName: 'jameson' });
    expect(posts[0]!.get('commanderName')).toBe('jameson');
  });

  it('stops on a refused key, and tries again after a server error', async () => {
    const refused = new EdsmJournalApi({
      software,
      fetch: fakeEdsm({ msgnum: 203, msg: 'Commander name/API Key not found' }).fetch,
    });
    expect(await refused.send([entry('FSDJump')], { apiKey: 'bad' })).toEqual({
      kind: 'rejected',
      message: 'EDSM: Commander name/API Key not found (203)',
    });

    const down = new EdsmJournalApi({
      software,
      fetch: fakeEdsm({}, ['Music'], { status: 503 }).fetch,
    });
    expect(await down.send([entry('FSDJump')], { apiKey: 'key' })).toMatchObject({
      kind: 'retry',
    });
  });

  it("doesn't send anything until it has the discard list", async () => {
    const { fetch, posts } = fakeEdsm({ msgnum: 100, msg: 'OK' }, []);
    const api = new EdsmJournalApi({ software, fetch });
    expect(await api.send([entry('FSDJump')], { apiKey: 'key' })).toMatchObject({
      kind: 'retry',
    });
    expect(posts).toHaveLength(0);
  });
});
