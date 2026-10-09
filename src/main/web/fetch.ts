/**
 * Reads a web page for the assistant: fetched in the main process, with no browser, and turned
 * into markdown the model can read.
 *
 * The address comes from the model, and the model reads whatever pages say, so it is only ever an
 * ordinary public web address: no files, and nothing on this machine or the local network, checked
 * again at every redirect. (A name that resolves differently between the check and the request
 * could still slip through; nothing EDSSI sends carries credentials, so that is accepted.)
 */

import { lookup as dnsLookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';

import { NodeHtmlMarkdown } from 'node-html-markdown';
import { type HTMLElement, parse } from 'node-html-parser';

/** More than any article; a page past this is cut rather than read into memory whole. */
const MAX_BYTES = 3_000_000;
const MAX_REDIRECTS = 5;
/** Under the tool registry's own limit, so a slow site fails with a reason rather than a timeout. */
const TIMEOUT_MS = 15_000;

/**
 * Says what it is. Claiming to be Chrome gets it turned away by more sites, not fewer (Inara, EDSM
 * and Fandom all refuse that and serve this), since the connection plainly isn't a browser's.
 */
const USER_AGENT = 'EDSSI (Elite Dangerous companion app)';

/** Parts of a page that are never the content. */
const NOISE = 'script, style, noscript, template, svg, canvas, iframe, object, embed, link, meta';
/** Page furniture, dropped when the page marks out its main content some other way. */
const FURNITURE =
  'nav, header, footer, aside, [role=navigation], [role=banner], [role=contentinfo]';

export interface FetchedPage {
  /** Where the page ended up, after redirects. */
  url: string;
  title?: string;
  /** Markdown for HTML; the body itself for text and JSON. */
  text: string;
}

export interface FetchOptions {
  signal?: AbortSignal;
  /** For tests. */
  fetch?: typeof fetch;
  /** Every address a host name resolves to. For tests. */
  lookup?: (host: string) => Promise<string[]>;
  userAgent?: string;
  /** Keep links' addresses. Off, a link is only its text, which is often a third of the page. */
  links?: boolean;
}

/** A failure worth telling the model about in words. */
export class PageError extends Error {}

export async function fetchPage(address: string, options: FetchOptions = {}): Promise<FetchedPage> {
  const doFetch = options.fetch ?? fetch;
  const lookup = options.lookup ?? resolveAll;
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;

  let url = parseAddress(address);
  let response: Response | undefined;
  for (let hop = 0; ; hop++) {
    await checkHost(url, lookup);
    try {
      response = await doFetch(url, {
        redirect: 'manual',
        signal,
        headers: {
          'user-agent': options.userAgent ?? USER_AGENT,
          accept: 'text/html,application/xhtml+xml,text/plain,application/json;q=0.9,*/*;q=0.5',
          'accept-language': 'en;q=0.9',
        },
      });
    } catch (error) {
      if (options.signal?.aborted) throw error;
      if (timeout.aborted) throw new PageError('The site took too long to answer.');
      throw new PageError(`The site could not be reached: ${message(error)}`);
    }

    const location = response.headers.get('location');
    if (response.status < 300 || response.status >= 400 || !location) break;
    if (hop >= MAX_REDIRECTS) throw new PageError('The page redirects too many times.');
    await response.body?.cancel();
    url = parseAddress(new URL(location, url).href);
  }

  if (!response.ok) {
    await response.body?.cancel();
    throw new PageError(refusal(response.status));
  }

  const contentType = response.headers.get('content-type') ?? '';
  const kind = kindOf(contentType);
  if (!kind) {
    await response.body?.cancel();
    throw new PageError(
      `That address is not a page that can be read (${contentType || 'unknown'}).`,
    );
  }

  const body = decode(await readCapped(response), contentType);
  const finalUrl = url.href;
  if (kind === 'text') return { url: finalUrl, text: body.trim() };
  if (kind === 'json') return { url: finalUrl, text: prettyJson(body) };
  return { url: finalUrl, ...htmlToMarkdown(body, finalUrl, options.links ?? false) };
}

/**
 * Checks an address the model gave before anything loads it: a public http or https one, or a
 * `PageError` saying why not. The browser uses it too.
 */
export async function publicUrl(
  address: string,
  lookup: (host: string) => Promise<string[]> = resolveAll,
): Promise<URL> {
  const url = parseAddress(address);
  await checkHost(url, lookup);
  return url;
}

/**
 * Whether a host is plainly this machine or the local network, without looking the name up: for
 * checks that can't wait on DNS, like every request a page makes.
 */
export function isLocalHost(hostname: string): boolean {
  const host = hostname.replace(/^\[(.*)\]$/u, '$1');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true;
  return isIP(host) !== 0 && !isPublicAddress(host);
}

/**
 * The page's title and its main content as markdown. Links are made absolute, or reduced to their
 * text; images are dropped.
 */
export function htmlToMarkdown(
  html: string,
  baseUrl: string,
  links: boolean,
): { title?: string; text: string } {
  const root = parse(html, { comment: false });
  const title = root.querySelector('title')?.text.trim() || undefined;

  for (const element of root.querySelectorAll(NOISE)) element.remove();
  for (const element of root.querySelectorAll('[hidden], [aria-hidden=true]')) element.remove();

  const main =
    root.querySelector('main, [role=main], article') ?? root.querySelector('body') ?? root;
  if (main.tagName !== 'MAIN' && main.tagName !== 'ARTICLE') {
    for (const element of main.querySelectorAll(FURNITURE)) element.remove();
  }
  for (const element of main.querySelectorAll('img, picture, video, audio')) element.remove();
  for (const element of main.querySelectorAll('[title]')) element.removeAttribute('title');
  if (links) absolutise(main, baseUrl);
  else for (const element of main.querySelectorAll('a')) element.replaceWith(element.innerHTML);

  const text = NodeHtmlMarkdown.translate(main.innerHTML, { maxConsecutiveNewlines: 2 })
    .replaceAll(/[ \t]+\n/gu, '\n')
    .trim();
  return { title, text };
}

function absolutise(root: HTMLElement, baseUrl: string): void {
  for (const element of root.querySelectorAll('a[href]')) {
    try {
      const resolved = new URL(element.getAttribute('href')!, baseUrl);
      // A script link is no use to the model; its text still is.
      if (resolved.protocol === 'javascript:') element.replaceWith(element.innerHTML);
      else element.setAttribute('href', resolved.href);
    } catch {
      element.replaceWith(element.innerHTML);
    }
  }
}

function parseAddress(address: string): URL {
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z\d+.-]*:/iu.test(address) ? address : `https://${address}`);
  } catch {
    throw new PageError(`"${address}" is not a web address.`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new PageError('Only http and https addresses can be read.');
  }
  if (url.username || url.password) throw new PageError('Addresses with credentials are refused.');
  url.hash = '';
  return url;
}

async function checkHost(url: URL, lookup: (host: string) => Promise<string[]>): Promise<void> {
  const host = url.hostname.replace(/^\[(.*)\]$/u, '$1');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) {
    throw new PageError('Addresses on this machine or the local network are refused.');
  }
  let addresses: string[];
  if (isIP(host)) {
    addresses = [host];
  } else {
    try {
      addresses = await lookup(host);
    } catch {
      throw new PageError(`There is no site at ${host}.`);
    }
  }
  if (addresses.length === 0 || addresses.some((address) => !isPublicAddress(address))) {
    throw new PageError('Addresses on this machine or the local network are refused.');
  }
}

const PRIVATE = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 3],
] as const) {
  PRIVATE.addSubnet(network, prefix, 'ipv4');
}
for (const [network, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const) {
  PRIVATE.addSubnet(network, prefix, 'ipv6');
}

/** False for loopback, private, link-local, carrier-grade NAT, multicast and reserved addresses. */
export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !PRIVATE.check(address, 'ipv4');
  if (family !== 6) return false;
  // An IPv4 address written as IPv6 (::ffff:10.0.0.1) is judged as the IPv4 one.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/iu.exec(address);
  if (mapped) return isPublicAddress(mapped[1]!);
  return !PRIVATE.check(address, 'ipv6');
}

async function resolveAll(host: string): Promise<string[]> {
  const results = await dnsLookup(host, { all: true, verbatim: true });
  return results.map((result) => result.address);
}

function kindOf(contentType: string): 'html' | 'text' | 'json' | undefined {
  const type = contentType.split(';')[0]!.trim().toLowerCase();
  // A server that doesn't say is most likely serving a page.
  if (type === '' || type === 'text/html' || type === 'application/xhtml+xml') return 'html';
  if (type === 'application/json' || type.endsWith('+json')) return 'json';
  if (type.startsWith('text/')) return 'text';
  return undefined;
}

async function readCapped(response: Response): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.byteLength;
    if (size >= MAX_BYTES) {
      await reader.cancel();
      break;
    }
  }
  const bytes = new Uint8Array(Math.min(size, MAX_BYTES));
  let offset = 0;
  for (const chunk of chunks) {
    const part = chunk.subarray(0, bytes.byteLength - offset);
    bytes.set(part, offset);
    offset += part.byteLength;
  }
  return bytes;
}

function decode(bytes: Uint8Array, contentType: string): string {
  const charset = /charset=["']?([\w-]+)/iu.exec(contentType)?.[1];
  try {
    return new TextDecoder(charset ?? 'utf-8').decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

function prettyJson(body: string): string {
  try {
    return JSON.stringify(JSON.parse(body), null, 1);
  } catch {
    return body.trim();
  }
}

function refusal(status: number): string {
  if (status === 401 || status === 403 || status === 429 || status === 503) {
    return `The site refused to serve the page (HTTP ${status}); it may block automated reading or want a sign-in.`;
  }
  if (status === 404 || status === 410) return `There is no page at that address (HTTP ${status}).`;
  return `The site answered with an error (HTTP ${status}).`;
}

function message(error: unknown): string {
  const cause = error instanceof Error && error.cause instanceof Error ? error.cause : error;
  return cause instanceof Error ? cause.message : String(cause);
}
