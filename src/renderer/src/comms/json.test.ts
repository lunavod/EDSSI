import { describe, expect, it } from 'vitest';

import { formatJson, preview } from './json';

const render = (text: string) =>
  formatJson(text)
    ?.map((token) => token.text)
    .join('');

describe('formatJson', () => {
  it('indents objects and arrays two spaces a level', () => {
    expect(render('{"tab":"route","jumps":[1,2],"empty":{},"none":[]}')).toBe(
      '{\n  "tab": "route",\n  "jumps": [\n    1,\n    2\n  ],\n  "empty": {},\n  "none": []\n}',
    );
  });

  it('tells keys from string values, and colours numbers and literals', () => {
    const kinds = formatJson('{"name":"Sol","pop":1.5e10,"ok":true,"x":null}')!
      .filter((token) => token.kind !== 'space' && token.kind !== 'punct')
      .map((token) => `${token.kind}:${token.text}`);
    expect(kinds).toEqual([
      'key:"name"',
      'string:"Sol"',
      'key:"pop"',
      'number:1.5e10',
      'key:"ok"',
      'literal:true',
      'key:"x"',
      'literal:null',
    ]);
  });

  it('keeps numbers exactly as written, however large', () => {
    expect(render('{"id64":36028807496337770123}')).toContain('36028807496337770123');
  });

  it('copes with escaped quotes and colons inside strings', () => {
    expect(render('{"q":"say \\"hi\\": now"}')).toBe('{\n  "q": "say \\"hi\\": now"\n}');
  });

  it('leaves words, broken JSON and trailing text alone', () => {
    expect(formatJson('The route view is up.')).toBeUndefined();
    expect(formatJson('"just a string"')).toBeUndefined();
    expect(formatJson('{"a":1')).toBeUndefined();
    expect(formatJson('{"a":1]')).toBeUndefined();
    expect(formatJson('{"a":1}\n…cut short; ask for less at a time.')).toBeUndefined();
  });
});

describe('preview', () => {
  it('shortens arguments to one line and hides empty ones', () => {
    expect(preview('{}')).toBe('');
    expect(preview('{\n "tab": "route"\n}')).toBe('{ "tab": "route" }');
    expect(preview(`{"q":"${'x'.repeat(200)}"}`, 20)).toHaveLength(20);
  });
});
