import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Batcher, type BatcherOptions, type JournalPosition, type SendResult } from './batcher';

const at = (second: number, index = 0): JournalPosition => ({
  timestamp: `2026-09-12T16:00:${String(second).padStart(2, '0')}Z`,
  index,
});

function makeBatcher(
  send: (batch: readonly string[]) => Promise<SendResult>,
  overrides: Partial<BatcherOptions<string>> = {},
) {
  const confirmed: JournalPosition[] = [];
  const batcher = new Batcher<string>({
    target: 'edsm',
    send,
    minIntervalMs: 10_000,
    maxDelayMs: 60_000,
    maxBatch: 3,
    maxQueue: 10,
    onConfirmed: (position) => confirmed.push(position),
    onStatus: () => {},
    ...overrides,
  });
  return { batcher, confirmed };
}

describe('Batcher', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('waits for company, then sends what has gathered', async () => {
    const send = vi.fn(async (batch: readonly string[]) => ({
      kind: 'sent' as const,
      accepted: batch.length,
    }));
    const { batcher, confirmed } = makeBatcher(send);
    batcher.push('a', at(1));
    batcher.push('b', at(2));
    await vi.advanceTimersByTimeAsync(59_000);
    expect(send).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1_000);
    expect(send).toHaveBeenCalledWith(['a', 'b']);
    expect(confirmed).toEqual([at(2)]);
    expect(batcher.status).toMatchObject({ state: 'waiting', pending: 0, sent: 2 });
  });

  it('sends an urgent event at once, but never faster than allowed', async () => {
    const send = vi.fn(async () => ({ kind: 'sent' as const, accepted: 1 }));
    const { batcher } = makeBatcher(send);
    batcher.push('jump', at(1), true);
    await vi.advanceTimersByTimeAsync(0);
    expect(send).toHaveBeenCalledTimes(1);

    batcher.push('dock', at(2), true);
    await vi.advanceTimersByTimeAsync(9_000);
    expect(send).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('moves the cursor past events it looked at but skipped, once nothing waits', async () => {
    const send = vi.fn(async () => ({ kind: 'sent' as const, accepted: 1 }));
    const { batcher, confirmed } = makeBatcher(send);
    batcher.push('a', at(1), true);
    batcher.see(at(5));
    await vi.advanceTimersByTimeAsync(0);
    expect(confirmed).toEqual([at(5)]);
  });

  it('keeps a failed batch and tries it again later, backing off', async () => {
    const send = vi
      .fn<(batch: readonly string[]) => Promise<SendResult>>()
      .mockResolvedValueOnce({ kind: 'retry', message: 'offline' })
      .mockResolvedValueOnce({ kind: 'retry', message: 'offline' })
      .mockResolvedValue({ kind: 'sent', accepted: 1 });
    const { batcher, confirmed } = makeBatcher(send);
    batcher.push('a', at(1), true);
    await vi.advanceTimersByTimeAsync(0);
    expect(batcher.status).toMatchObject({ state: 'retrying', message: 'offline', pending: 1 });

    await vi.advanceTimersByTimeAsync(30_000);
    expect(send).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(59_000);
    expect(send).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(send).toHaveBeenCalledTimes(3);
    expect(send).toHaveBeenLastCalledWith(['a']);
    expect(confirmed).toEqual([at(1)]);
    expect(batcher.status.state).toBe('waiting');
  });

  it('stops for good when the service refuses the key', async () => {
    const send = vi.fn(async () => ({ kind: 'rejected' as const, message: 'bad key' }));
    const { batcher, confirmed } = makeBatcher(send);
    batcher.push('a', at(1), true);
    await vi.advanceTimersByTimeAsync(0);
    batcher.push('b', at(2), true);
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(send).toHaveBeenCalledTimes(1);
    expect(confirmed).toEqual([]);
    expect(batcher.status).toMatchObject({ state: 'rejected', message: 'bad key', pending: 2 });
  });

  it('sends in batches of at most maxBatch, taking only what the sender consumed', async () => {
    const send = vi
      .fn<(batch: readonly string[]) => Promise<SendResult>>()
      .mockResolvedValueOnce({ kind: 'sent', accepted: 1, consumed: 1 })
      .mockResolvedValue({ kind: 'sent', accepted: 3 });
    const { batcher, confirmed } = makeBatcher(send, { minIntervalMs: 0 });
    for (const [index, name] of ['a', 'b', 'c', 'd'].entries()) batcher.push(name, at(index));
    await vi.advanceTimersByTimeAsync(1);
    expect(send.mock.calls.map(([batch]) => batch)).toEqual([
      ['a', 'b', 'c'],
      ['b', 'c', 'd'],
    ]);
    expect(confirmed).toEqual([at(0), at(3)]);
  });

  it('sends nothing while paused, then carries on', async () => {
    const send = vi.fn(async () => ({ kind: 'sent' as const, accepted: 1 }));
    const { batcher } = makeBatcher(send);
    batcher.pause('another commander');
    batcher.push('a', at(1), true);
    await vi.advanceTimersByTimeAsync(0);
    expect(send).not.toHaveBeenCalled();
    batcher.resume();
    await vi.advanceTimersByTimeAsync(0);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('drops the oldest events beyond maxQueue', async () => {
    const send = vi.fn(async (batch: readonly string[]) => ({
      kind: 'sent' as const,
      accepted: batch.length,
    }));
    const { batcher } = makeBatcher(send, { maxQueue: 2, maxBatch: 10 });
    batcher.pause('offline');
    for (const [index, name] of ['a', 'b', 'c'].entries()) batcher.push(name, at(index));
    batcher.resume();
    batcher.flush();
    await vi.advanceTimersByTimeAsync(0);
    expect(send).toHaveBeenCalledWith(['b', 'c']);
  });
});
