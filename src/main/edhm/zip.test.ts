import { describe, expect, it } from 'vitest';

import { readZip } from './zip';
import { makeZip } from './zip-fixture';

describe('readZip', () => {
  it('reads every entry back', () => {
    const zip = makeZip({ 'ShaderFixes/': '', 'ShaderFixes/a-ps.txt': 'dcl t2\r\n'.repeat(50) });
    const entries = readZip(zip);

    expect(entries.map((entry) => entry.name)).toEqual(['ShaderFixes/', 'ShaderFixes/a-ps.txt']);
    expect(entries[1]?.data.toString()).toBe('dcl t2\r\n'.repeat(50));
  });

  it('refuses what isn’t a zip', () => {
    expect(() => readZip(Buffer.from('<html>Not Found</html>'))).toThrow('Not a zip file');
  });
});
