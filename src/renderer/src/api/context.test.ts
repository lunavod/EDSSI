import { describe, expect, it, vi } from 'vitest';

describe('EdssiContext', () => {
  it('is the same context in every copy of the module, as an installed extension carries one', async () => {
    const first = await import('./context');
    vi.resetModules();
    const second = await import('./context');
    expect(second).not.toBe(first);
    expect(second.EdssiContext).toBe(first.EdssiContext);
  });
});
