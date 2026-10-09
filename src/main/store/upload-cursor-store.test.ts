import { describe, expect, it } from 'vitest';

import { openDatabase } from './database';
import { UploadCursorStore } from './upload-cursor-store';

describe('UploadCursorStore', () => {
  it('keeps one cursor per service, replacing it as uploads move on', () => {
    const db = openDatabase(':memory:');
    const store = new UploadCursorStore(db);
    expect(store.get('edsm')).toBeUndefined();

    store.set('edsm', { timestamp: '2026-09-12T16:00:00Z', index: 0 });
    store.set('edsm', { timestamp: '2026-09-12T16:05:00Z', index: 3 });
    store.set('inara', { timestamp: '2026-09-12T16:01:00Z', index: 1 });

    expect(store.get('edsm')).toEqual({ timestamp: '2026-09-12T16:05:00Z', index: 3 });
    expect(store.get('inara')).toEqual({ timestamp: '2026-09-12T16:01:00Z', index: 1 });
    db.close();
  });
});
