/**
 * The hosted web search writes its sources into the answer as markdown, `([site](https://…))`,
 * whatever the instructions say. Everything the model writes is spoken, so the links are taken out
 * of the text as it streams, and kept to be shown beside the answer instead.
 */

import type OpenAI from 'openai';

import type { AnswerSource } from '../../shared/assistant';

/** A citation longer than this is not a citation; the text is let through as it is. */
const MAX_CITATION = 600;

type Scan = number | 'partial' | 'no';

/**
 * Takes citations out of text that arrives a piece at a time. Text that could still turn out to be
 * one is held back until it is clear, along with the space before it, which goes with it.
 */
export class CitationFilter {
  #buffer = '';
  readonly #sources: AnswerSource[] = [];

  /** The links taken out so far. */
  get sources(): AnswerSource[] {
    return this.#sources;
  }

  /** Adds a piece of text and returns what is safe to pass on. */
  push(delta: string): string {
    this.#buffer += delta;
    return this.#drain(false);
  }

  /** The stream is over: returns whatever was still held back. */
  end(): string {
    return this.#drain(true);
  }

  #drain(final: boolean): string {
    let out = '';
    const text = this.#buffer;
    let index = 0;
    while (index < text.length) {
      const open = findOpening(text, index);
      if (open === -1) {
        const stop = final ? text.length : trailingSpace(text, index, text.length);
        out += text.slice(index, stop);
        index = stop;
        break;
      }
      // The space before a citation is dropped with it, so it waits too.
      const spaceStart = trailingSpace(text, index, open);
      out += text.slice(index, spaceStart);
      const scan = scanCitation(text, open);
      if (scan === 'partial' && !final && text.length - open <= MAX_CITATION) {
        index = spaceStart;
        break;
      }
      if (typeof scan === 'number') {
        this.#collect(text.slice(open, scan));
        index = scan;
      } else {
        out += text.slice(spaceStart, open + 1);
        index = open + 1;
      }
    }
    this.#buffer = text.slice(index);
    return out;
  }

  #collect(citation: string): void {
    let index = citation.indexOf('[');
    while (index !== -1) {
      const end = scanLink(citation, index);
      if (typeof end !== 'number') break;
      const link = citation.slice(index, end);
      const split = link.indexOf('](');
      addSource(this.#sources, link.slice(1, split), link.slice(split + 2, -1));
      index = citation.indexOf('[', end);
    }
  }
}

/** Takes every citation out of a finished piece of text. */
export function stripCitations(text: string): { text: string; sources: AnswerSource[] } {
  const filter = new CitationFilter();
  const cleaned = filter.push(text) + filter.end();
  return { text: cleaned, sources: filter.sources };
}

/** The pages the answer's annotations cite, which carry the page's own title. */
export function annotatedSources(
  output: readonly OpenAI.Responses.ResponseOutputItem[],
): AnswerSource[] {
  const sources: AnswerSource[] = [];
  for (const item of output) {
    if (item.type !== 'message') continue;
    for (const part of item.content) {
      if (part.type !== 'output_text') continue;
      for (const annotation of part.annotations ?? []) {
        if (annotation.type === 'url_citation') {
          addSource(sources, annotation.title, annotation.url);
        }
      }
    }
  }
  return sources;
}

/** Adds a source unless it is already there; a real title wins over a bare site name. */
export function addSource(sources: AnswerSource[], title: string, url: string): void {
  const clean = cleanUrl(url);
  if (!clean) return;
  const existing = sources.find((source) => source.url === clean);
  const host = new URL(clean).hostname.replace(/^www\./u, '');
  const name = title.trim() || host;
  if (!existing) {
    sources.push({ title: name, url: clean, site: host });
  } else if (existing.title === existing.site && name !== host) {
    existing.title = name;
  }
}

/** Drops the tracking parameters the search adds (`utm_source=openai`). Only http(s) is kept. */
export function cleanUrl(url: string): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return undefined;
  // Collected first: deleting while iterating the params skips the one after each deletion.
  const tracking = Array.from(parsed.searchParams.keys()).filter((key) => key.startsWith('utm_'));
  for (const key of tracking) parsed.searchParams.delete(key);
  return parsed.toString();
}

function findOpening(text: string, from: number): number {
  const paren = text.indexOf('(', from);
  const bracket = text.indexOf('[', from);
  if (paren === -1) return bracket;
  if (bracket === -1) return paren;
  return Math.min(paren, bracket);
}

/** Where the run of spaces that ends at `to` starts, no earlier than `from`. */
function trailingSpace(text: string, from: number, to: number): number {
  let start = to;
  while (start > from && (text[start - 1] === ' ' || text[start - 1] === ' ')) start--;
  return start;
}

/** `([a](url))`, `([a](url), [b](url))` or a bare `[a](url)` starting at `at`. */
function scanCitation(text: string, at: number): Scan {
  if (text[at] === '[') return scanLink(text, at);
  let index = at + 1;
  let first = true;
  for (;;) {
    // Between two links, a comma may come too.
    index = skip(text, index, first ? ' ' : ' ,');
    if (index >= text.length) return 'partial';
    if (text[index] === ')' && !first) return index + 1;
    if (text[index] !== '[') return 'no';
    const end = scanLink(text, index);
    if (typeof end !== 'number') return end;
    first = false;
    index = end;
  }
}

/** The index of the first character from `index` on that isn't one of `chars`. */
function skip(text: string, index: number, chars: string): number {
  let at = index;
  while (at < text.length && chars.includes(text[at]!)) at++;
  return at;
}

/** A markdown link to a web page, `[text](http…)`. */
function scanLink(text: string, at: number): Scan {
  let index = at + 1;
  while (index < text.length && text[index] !== ']') {
    if (text[index] === '\n' || text[index] === '[') return 'no';
    index++;
  }
  if (index >= text.length) return 'partial';
  index++;
  if (index >= text.length) return 'partial';
  if (text[index] !== '(') return 'no';
  const urlStart = ++index;
  // Wiki addresses carry their own brackets: `Sol_(system)`.
  let depth = 0;
  while (index < text.length && (text[index] !== ')' || depth > 0)) {
    if (/\s/u.test(text[index]!)) return 'no';
    if (text[index] === '(') depth++;
    if (text[index] === ')') depth--;
    index++;
  }
  const url = text.slice(urlStart, index);
  if (!couldBeWebUrl(url)) return 'no';
  if (index >= text.length) return 'partial';
  return url.startsWith('http://') || url.startsWith('https://') ? index + 1 : 'no';
}

/** Whether `url`, so far, is on its way to being an http(s) address. */
function couldBeWebUrl(url: string): boolean {
  const head = url.slice(0, 8);
  return 'https://'.startsWith(head) || 'http://'.startsWith(head) || /^https?:\/\//u.test(url);
}
