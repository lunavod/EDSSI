import { describe, expect, it } from 'vitest';

import { transcriptionPrompt } from './speech';

describe('transcriptionPrompt', () => {
  it('says what the audio is, so a second of speech is not judged on its own', () => {
    const prompt = transcriptionPrompt([], { names: [] });
    expect(prompt).toContain('Elite Dangerous');
    // The failure that prompted this: "nine" came back as "okay".
    expect(prompt).toMatch(/number/i);
  });

  it('quotes what the ship just said, so a one-word answer has a question behind it', () => {
    const prompt = transcriptionPrompt([], {
      names: [],
      said: 'Twelve jumps to Colonia. How many do you want to do tonight?',
    });
    expect(prompt).toContain('How many do you want to do tonight?');
  });

  it('leaves the quote out when the ship has not said anything', () => {
    expect(transcriptionPrompt([], { names: [] })).not.toContain('just said');
  });

  it('keeps the end of a long answer, which is where the question is', () => {
    const said = `${'a rambling preamble. '.repeat(40)}So, how many jumps?`;
    const prompt = transcriptionPrompt([], { names: [], said });
    expect(prompt).toContain('So, how many jumps?');
    expect(prompt.length).toBeLessThan(said.length);
  });

  it('flattens a multi-line answer, so the prompt stays one line per point', () => {
    const prompt = transcriptionPrompt([], { names: [], said: 'Line one.\n\n  Line two.' });
    expect(prompt).toContain('Line one. Line two.');
  });

  it('lists names for the models that take them in the prompt rather than as keywords', () => {
    const prompt = transcriptionPrompt(['Deciat', 'Shinrarta Dezhra'], { names: [] });
    expect(prompt).toContain('Deciat, Shinrarta Dezhra');
  });

  it('says nothing about names when there are none to give', () => {
    expect(transcriptionPrompt([], { names: [] })).not.toContain('may come up');
  });
});
