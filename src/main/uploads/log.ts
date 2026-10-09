import type { UploadLogEntry, UploadSource, UploadTarget } from '../../shared/uploads';
import type { BatchItem, SendResult } from './batcher';
import type { EdsmEntry } from './edsm-journal';
import type { InaraEntry } from './inara-api';

/** An upload log entry before the database has numbered it. */
export type NewUploadLogEntry = Omit<UploadLogEntry, 'id'>;

/** What the log keeps about one queued event. */
export interface LoggedEvent {
  event: string;
  system?: string;
}

export function describeEdsmEntry(entry: EdsmEntry): LoggedEvent {
  const system = entry.message['_systemName'];
  return {
    event: String(entry.message['event']),
    system: typeof system === 'string' ? system : undefined,
  };
}

export function describeInaraEntry(entry: InaraEntry): LoggedEvent {
  const data = entry.event.eventData;
  const system =
    typeof data === 'object' && data !== null ? Reflect.get(data, 'starsystemName') : undefined;
  return { event: entry.event.eventName, system: typeof system === 'string' ? system : undefined };
}

/** One request and its answer, as the log keeps it. */
export function uploadLogEntry<T>(options: {
  target: UploadTarget;
  source: UploadSource;
  batch: readonly BatchItem<T>[];
  describe: (payload: T) => LoggedEvent;
  result: SendResult;
  at?: Date;
}): NewUploadLogEntry {
  const { batch, result } = options;
  const eventCounts: Record<string, number> = {};
  const systems: string[] = [];
  for (const item of batch) {
    const { event, system } = options.describe(item.payload);
    eventCounts[event] = (eventCounts[event] ?? 0) + 1;
    if (system !== undefined && systems.at(-1) !== system && !systems.includes(system)) {
      systems.push(system);
    }
  }
  return {
    target: options.target,
    source: options.source,
    at: (options.at ?? new Date()).toISOString(),
    firstEvent: batch[0]?.position.timestamp ?? '',
    lastEvent: batch.at(-1)?.position.timestamp ?? '',
    events: batch.length,
    eventCounts,
    systems,
    outcome: result.kind,
    accepted: result.kind === 'sent' ? result.accepted : undefined,
    skipped: result.kind === 'sent' && result.skipped ? result.skipped : undefined,
    message: result.message,
    refused: (result.kind === 'sent' && result.refused) || [],
  };
}
