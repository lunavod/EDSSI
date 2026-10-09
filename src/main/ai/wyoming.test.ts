import { createServer, type Server } from 'node:net';

import { afterEach, describe, expect, it } from 'vitest';

import {
  encodeEvent,
  EventReader,
  parseWyomingUri,
  toMono16,
  type WyomingEvent,
  wyomingSpeak,
  wyomingTranscribe,
} from './wyoming';

const never = new AbortController().signal;

describe('parseWyomingUri', () => {
  it('reads tcp://host:port, with or without the scheme', () => {
    expect(parseWyomingUri('tcp://127.0.0.1:10200')).toEqual({ host: '127.0.0.1', port: 10200 });
    expect(parseWyomingUri('homeassistant.local:10300')).toEqual({
      host: 'homeassistant.local',
      port: 10300,
    });
    expect(parseWyomingUri('tcp://[::1]:10200')).toEqual({ host: '::1', port: 10200 });
  });

  it('refuses what isn’t one', () => {
    expect(() => parseWyomingUri('http://host:80')).toThrow(/tcp/);
    expect(() => parseWyomingUri('tcp://host')).toThrow(/port/);
  });
});

describe('events', () => {
  it('round-trips through the framing, data and payload apart from the header', () => {
    const event: WyomingEvent = {
      type: 'audio-chunk',
      data: { rate: 22050, width: 2, channels: 1 },
      payload: new Uint8Array([1, 2, 3, 4]),
    };
    const bytes = encodeEvent(event);
    const header: unknown = JSON.parse(Buffer.from(bytes).toString('utf8').split('\n')[0]!);
    expect(header).toMatchObject({
      type: 'audio-chunk',
      data_length: JSON.stringify(event.data).length,
      payload_length: 4,
    });
    expect(new EventReader().push(bytes)).toEqual([event]);
  });

  it('holds back an event until all of it has arrived', () => {
    const bytes = Buffer.concat([
      encodeEvent({ type: 'audio-start', data: { rate: 16000, width: 2, channels: 1 } }),
      encodeEvent({ type: 'audio-chunk', data: {}, payload: new Uint8Array(10) }),
    ]);
    const reader = new EventReader();
    const seen = [];
    for (let at = 0; at < bytes.length; at += 7)
      seen.push(...reader.push(bytes.subarray(at, at + 7)));
    expect(seen.map((event) => event.type)).toEqual(['audio-start', 'audio-chunk']);
    expect(seen[1]!.payload).toHaveLength(10);
  });

  it('merges data written in the header, as older servers do, with data after it', () => {
    const header = JSON.stringify({
      type: 'transcript',
      data: { language: 'en' },
      data_length: 13,
    });
    const [event] = new EventReader().push(Buffer.from(`${header}\n{"text":"hi"}`));
    expect(event).toEqual({ type: 'transcript', data: { language: 'en', text: 'hi' } });
  });
});

describe('toMono16', () => {
  it('averages stereo down to one channel and passes mono through', () => {
    const stereo = new Uint8Array(new Int16Array([100, 300, -50, -150]).buffer);
    expect(
      Array.from(new Int16Array(toMono16(stereo, { rate: 1, width: 2, channels: 2 }).buffer)),
    ).toEqual([200, -100]);
    const mono = new Uint8Array([1, 2]);
    expect(toMono16(mono, { rate: 1, width: 2, channels: 1 })).toBe(mono);
    expect(() => toMono16(mono, { rate: 1, width: 1, channels: 1 })).toThrow(/16-bit/);
  });
});

/** A server that answers each connection with `answer(events it was sent)`. */
let server: Server | undefined;
function fakeServer(
  answer: (received: WyomingEvent[]) => WyomingEvent[] | undefined,
): Promise<number> {
  return new Promise((resolve) => {
    server = createServer((socket) => {
      const reader = new EventReader();
      const received: WyomingEvent[] = [];
      socket.on('data', (bytes) => {
        received.push(...reader.push(bytes));
        const reply = answer(received);
        if (reply) for (const event of reply) socket.write(encodeEvent(event));
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const address = server!.address();
      resolve(typeof address === 'object' && address ? address.port : 0);
    });
  });
}

afterEach(() => {
  server?.close();
  server = undefined;
});

describe('wyomingSpeak', () => {
  it('asks for the voice by name and hands on each chunk with its rate', async () => {
    const format = { rate: 22050, width: 2, channels: 1 };
    let asked: WyomingEvent | undefined;
    const port = await fakeServer((received) => {
      asked = received[0];
      return [
        { type: 'audio-start', data: format },
        { type: 'audio-chunk', data: format, payload: new Uint8Array([1, 0, 2, 0]) },
        { type: 'audio-chunk', data: format, payload: new Uint8Array([3, 0]) },
        { type: 'audio-stop', data: {} },
      ];
    });
    const heard: [number, number][] = [];
    await wyomingSpeak(
      { host: '127.0.0.1', port },
      'Jump complete.',
      'en_GB-alan-medium',
      (pcm, rate) => heard.push([pcm.length, rate]),
      never,
    );
    expect(asked).toEqual({
      type: 'synthesize',
      data: { text: 'Jump complete.', voice: { name: 'en_GB-alan-medium' } },
    });
    expect(heard).toEqual([
      [4, 22050],
      [2, 22050],
    ]);
  });

  it('says plainly when the server has no such voice', async () => {
    const port = await fakeServer(() => [{ type: 'error', data: { text: 'nobody' } }]);
    await expect(
      wyomingSpeak({ host: '127.0.0.1', port }, 'Hi.', 'nobody', () => {}, never),
    ).rejects.toThrow('The Wyoming server has no voice called nobody.');
  });
});

describe('wyomingTranscribe', () => {
  it('sends transcribe, then the audio in pieces, and returns the transcript', async () => {
    let types: string[] = [];
    let bytes = 0;
    const port = await fakeServer((received) => {
      if (received.at(-1)?.type !== 'audio-stop') return undefined;
      types = [...new Set(received.map((event) => event.type))];
      bytes = received.reduce((sum, event) => sum + (event.payload?.length ?? 0), 0);
      return [{ type: 'transcript', data: { text: ' Request docking. ' } }];
    });
    const text = await wyomingTranscribe(
      { host: '127.0.0.1', port },
      new Uint8Array(5000),
      'en',
      never,
    );
    expect(text).toBe('Request docking.');
    expect(types).toEqual(['transcribe', 'audio-start', 'audio-chunk', 'audio-stop']);
    expect(bytes).toBe(5000);
  });
});
