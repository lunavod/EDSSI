import { describe, expect, it } from 'vitest';

import { type Look, parseScreenshotAnswer, readScreenshots } from './screenshots';

const readsNothing: Look = async () => '{"commodities":[]}';

const KNOWN = ['Liquid Oxygen', 'Steel', 'H.E. Suits', 'Fruit and Vegetables'];

describe('parseScreenshotAnswer', () => {
  it('reads the rows, in the markets’ spelling where one is known', () => {
    const answer = JSON.stringify({
      commodities: [
        { name: 'Liquid oxygen', quantity: 1727 },
        { name: 'H.E. Suits', quantity: 25 },
        { name: 'Aluminium', quantity: 1357 },
      ],
    });
    expect(parseScreenshotAnswer(answer, KNOWN)).toEqual([
      { commodity: 'Liquid Oxygen', quantity: 1727 },
      { commodity: 'H.E. Suits', quantity: 25 },
      { commodity: 'Aluminium', quantity: 1357 },
    ]);
  });

  it('tolerates a code fence and numbers written as text', () => {
    const answer = '```json\n{"commodities":[{"name":"Steel","quantity":"3,084"}]}\n```';
    expect(parseScreenshotAnswer(answer, KNOWN)).toEqual([{ commodity: 'Steel', quantity: 3084 }]);
  });

  it('keeps one row seen in two overlapping screenshots once', () => {
    const answer = JSON.stringify({
      commodities: [
        { name: 'Steel', quantity: 3084 },
        { name: 'steel', quantity: 3084 },
      ],
    });
    expect(parseScreenshotAnswer(answer, KNOWN)).toEqual([{ commodity: 'Steel', quantity: 3084 }]);
  });

  it('drops rows with no name or nothing needed', () => {
    const answer = JSON.stringify({
      commodities: [
        { name: '', quantity: 5 },
        { name: 'Steel', quantity: 0 },
        { name: 'Water', quantity: 'lots' },
        'Titanium',
        { name: 'Water', quantity: 278 },
      ],
    });
    expect(parseScreenshotAnswer(answer, KNOWN)).toEqual([{ commodity: 'Water', quantity: 278 }]);
  });

  it('refuses an answer that is not the list', () => {
    expect(() => parseScreenshotAnswer('I cannot read that.', KNOWN)).toThrow(/wasn't a list/);
    expect(() => parseScreenshotAnswer('{"rows":[]}', KNOWN)).toThrow(/wasn't a list/);
  });
});

describe('readScreenshots', () => {
  const signal = new AbortController().signal;

  it('hands every image to the model in one question', async () => {
    const seen: string[][] = [];
    const look: Look = async ({ images }) => {
      seen.push(images);
      return '{"commodities":[{"name":"Steel","quantity":10}]}';
    };
    await expect(readScreenshots(look, ['data:a', 'data:b'], signal)).resolves.toEqual([
      { commodity: 'Steel', quantity: 10 },
    ]);
    expect(seen).toEqual([['data:a', 'data:b']]);
  });

  it('says so when nothing could be read', async () => {
    await expect(readScreenshots(readsNothing, ['data:a'], signal)).rejects.toThrow(
      /No commodities/,
    );
    await expect(readScreenshots(readsNothing, [], signal)).rejects.toThrow(/Add a screenshot/);
  });
});
