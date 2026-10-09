import { describe, expect, it } from 'vitest';

import { helpParts } from './HelpText';

describe('helpParts', () => {
  it('makes the addresses in a help line into links, leaving the full stop outside', () => {
    expect(helpParts('From platform.openai.com/api-keys.')).toEqual([
      { text: 'From ' },
      { text: 'platform.openai.com/api-keys', href: 'https://platform.openai.com/api-keys' },
      { text: '.' },
    ]);
    expect(helpParts('From platform.inworld.ai → Settings → API Keys.')[1]).toEqual({
      text: 'platform.inworld.ai',
      href: 'https://platform.inworld.ai',
    });
    expect(helpParts('On edsm.net: your account settings.')[1]?.href).toBe('https://edsm.net');
  });

  it('leaves text with no address, and file names, as they are', () => {
    expect(helpParts('1 is the voice’s own pace.')).toEqual([
      { text: '1 is the voice’s own pace.' },
    ]);
    expect(helpParts('The keys are in vr-overlay.json.')).toEqual([
      { text: 'The keys are in vr-overlay.json.' },
    ]);
  });
});
