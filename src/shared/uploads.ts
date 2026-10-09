/** Where the journal is being sent, and how that is going, for the Settings tab. */

export const UPLOAD_TARGETS = ['edsm', 'inara', 'eddn'] as const;

export type UploadTarget = (typeof UPLOAD_TARGETS)[number];

/**
 * - `off`: no key (for a service that needs one), or uploads turned off.
 * - `waiting`: nothing to send, or waiting to send what there is.
 * - `paused`: nothing is sent for now, and `message` says why (another commander, a beta).
 * - `retrying`: the last attempt failed in a way that may pass; it will be tried again.
 * - `rejected`: the service refused the key or the commander. Nothing more is sent until the
 *   settings change.
 */
export type UploadState = 'off' | 'waiting' | 'paused' | 'retrying' | 'rejected';

export interface UploadStatus {
  target: UploadTarget;
  state: UploadState;
  message?: string;
  /** Events waiting to be sent. */
  pending: number;
  /** When a batch was last accepted, as an ISO timestamp. */
  lastSentAt?: string;
  /** Events accepted since EDSSI started. */
  sent: number;
}

export interface UploadsSnapshot {
  /** Goes up with every change, so a window can drop an older snapshot that arrives late. */
  version: number;
  targets: UploadStatus[];
  /** Goes up whenever a request is added to the upload log, so a window knows to fetch it again. */
  logVersion: number;
}

/** Where a batch came from: the live upload, or the send-session script filling in the past. */
export type UploadSource = 'live' | 'backfill';

/** One event the service didn't take, and what it said. */
export interface RefusedEvent {
  event: string;
  code?: number;
  message: string;
}

/** One request to EDSM, Inara or EDDN: what went, and what the service made of it. */
export interface UploadLogEntry {
  id: number;
  target: UploadTarget;
  source: UploadSource;
  /** When the answer came back, as an ISO timestamp. */
  at: string;
  /** The journal time of the first and last event in the request. */
  firstEvent: string;
  lastEvent: string;
  /** Events in the request, before the service dropped any. */
  events: number;
  /** How many of each event, e.g. `{ Scan: 12, FSDJump: 1 }`. */
  eventCounts: Record<string, number>;
  /** Systems the events happened in, in order, each once. */
  systems: string[];
  /**
   * `sent`: the service answered (it may still have refused some events, or all of them).
   * `retry`: it failed in a way that is tried again. `rejected`: the key or commander was refused.
   */
  outcome: 'sent' | 'retry' | 'rejected';
  /** Events the service kept. */
  accepted?: number;
  /** Events EDSSI left out because the service asked not to get them. */
  skipped?: number;
  message?: string;
  refused: RefusedEvent[];
}
