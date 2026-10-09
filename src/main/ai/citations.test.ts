import type OpenAI from 'openai';
import { describe, expect, it } from 'vitest';

import { annotatedSources, CitationFilter, cleanUrl, stripCitations } from './citations';

const WIKI =
  'https://elite-dangerous.fandom.com/wiki/Exobiology_Sample_Values_and_Details?utm_source=openai';
const CLEAN_WIKI = 'https://elite-dangerous.fandom.com/wiki/Exobiology_Sample_Values_and_Details';

/** Feeds the text through the filter one character at a time, as a stream might. */
function streamed(text: string): string {
  const filter = new CitationFilter();
  let out = '';
  for (const char of text) out += filter.push(char);
  return out + filter.end();
}

describe('CitationFilter', () => {
  const answer = `Informem pays 42.1 million with first footfall. ([elite-dangerous.fandom.com](${WIKI}))`;

  it('takes a citation out of the text, streamed or whole', () => {
    expect(streamed(answer)).toBe('Informem pays 42.1 million with first footfall.');
    expect(stripCitations(answer).text).toBe('Informem pays 42.1 million with first footfall.');
  });

  it('keeps the link as a source, without its tracking', () => {
    expect(stripCitations(answer).sources).toEqual([
      { title: 'elite-dangerous.fandom.com', url: CLEAN_WIKI, site: 'elite-dangerous.fandom.com' },
    ]);
  });

  it('closes up the space a citation leaves in the middle of a sentence', () => {
    const text = `Nebulus is richest ([a.com](https://a.com/x), [b.org](https://b.org/y)), then Informem.`;
    const result = stripCitations(text);
    expect(result.text).toBe('Nebulus is richest, then Informem.');
    expect(result.sources.map((source) => source.site)).toEqual(['a.com', 'b.org']);
    expect(streamed(text)).toBe(result.text);
  });

  it('takes a bare link, and one whose address has brackets of its own', () => {
    expect(stripCitations('See [wiki](https://w.org/Sol_(system)) now.').text).toBe('See now.');
  });

  it('leaves ordinary brackets alone', () => {
    const text = 'Stratum (the flat one) pays [roughly] 19 million (with bonus).';
    expect(streamed(text)).toBe(text);
    expect(stripCitations('Jump [to](Sol) first.').text).toBe('Jump [to](Sol) first.');
  });

  it('holds back a possible citation until it is clear, then lets text through', () => {
    const filter = new CitationFilter();
    expect(filter.push('Worth it (')).toBe('Worth it');
    expect(filter.push('probably')).toBe(' (probably');
    expect(filter.push(').')).toBe(').');
  });

  it('lets an unfinished citation through when the stream ends', () => {
    const filter = new CitationFilter();
    expect(filter.push('Done ([site](https://a.c')).toBe('Done');
    expect(filter.end()).toBe(' ([site](https://a.c');
  });
});

describe('annotatedSources', () => {
  it('reads url citations, merged by address, preferring the page title', () => {
    const output = [
      {
        type: 'message',
        content: [
          {
            type: 'output_text',
            text: '',
            annotations: [
              { type: 'url_citation', title: 'Exobiology values', url: WIKI },
              { type: 'url_citation', title: '', url: CLEAN_WIKI },
            ],
          },
        ],
      },
    ] as unknown as OpenAI.Responses.ResponseOutputItem[];
    expect(annotatedSources(output)).toEqual([
      { title: 'Exobiology values', url: CLEAN_WIKI, site: 'elite-dangerous.fandom.com' },
    ]);
  });
});

describe('cleanUrl', () => {
  it('keeps other parameters and refuses what is not the web', () => {
    expect(cleanUrl('https://a.com/?q=1&utm_medium=x')).toBe('https://a.com/?q=1');
    expect(cleanUrl('javascript:alert(1)')).toBeUndefined();
  });
});
