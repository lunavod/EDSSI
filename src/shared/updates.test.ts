import { describe, expect, it } from 'vitest';

import { boldRuns, compareVersions, notesSince, parseReleaseNotes } from './updates';

describe('compareVersions', () => {
  it('orders by major, minor and patch', () => {
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0);
    expect(compareVersions('1.10.0', '1.9.9')).toBe(1);
    expect(compareVersions('0.1.0', '1.0.0')).toBe(-1);
    expect(compareVersions('v2.0.0', '2.0.0')).toBe(0);
  });

  it('puts a pre-release before its release', () => {
    expect(compareVersions('1.2.0-dev.1', '1.2.0')).toBe(-1);
    expect(compareVersions('1.2.0', '1.2.0-dev.1')).toBe(1);
    expect(compareVersions('1.2.0-dev.2', '1.2.0-dev.10')).toBe(-1);
    expect(compareVersions('1.2.0-dev.1', '1.1.9')).toBe(1);
  });
});

const CHANGELOG = `# What's New

## 0.3.0

- **Updates.** EDSSI keeps itself up to date.
- **A wrapped bullet** that goes on
  over a second line.

## 0.2.0

- Fixed a thing.

## 0.1.0

- First release.
`;

describe('parseReleaseNotes', () => {
  it('cuts the file into versions, joining wrapped bullets', () => {
    expect(parseReleaseNotes(CHANGELOG)).toEqual([
      {
        version: '0.3.0',
        items: [
          '**Updates.** EDSSI keeps itself up to date.',
          '**A wrapped bullet** that goes on over a second line.',
        ],
      },
      { version: '0.2.0', items: ['Fixed a thing.'] },
      { version: '0.1.0', items: ['First release.'] },
    ]);
  });

  it('reads CRLF files and a file with no versions', () => {
    expect(parseReleaseNotes('## 1.0.0\r\n- One\r\n')).toEqual([
      { version: '1.0.0', items: ['One'] },
    ]);
    expect(parseReleaseNotes("# What's New\n")).toEqual([]);
  });
});

describe('notesSince', () => {
  const notes = parseReleaseNotes(CHANGELOG);

  it('shows every version after the last one seen, up to the one running', () => {
    expect(notesSince(notes, '0.1.0', '0.3.0').map((note) => note.version)).toEqual([
      '0.3.0',
      '0.2.0',
    ]);
    expect(notesSince(notes, '0.2.0', '0.2.0')).toEqual([]);
  });

  it('shows nothing on a first install', () => {
    expect(notesSince(notes, undefined, '0.3.0')).toEqual([]);
  });
});

describe('boldRuns', () => {
  it('splits out the bold', () => {
    expect(boldRuns('**New.** Plain **and** more')).toEqual([
      { text: 'New.', bold: true },
      { text: ' Plain ', bold: false },
      { text: 'and', bold: true },
      { text: ' more', bold: false },
    ]);
    expect(boldRuns('plain')).toEqual([{ text: 'plain', bold: false }]);
  });
});
