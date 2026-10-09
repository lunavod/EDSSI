import { describe, expect, it, vi } from 'vitest';

import { fetchPage, htmlToMarkdown, isPublicAddress } from './fetch';

const PUBLIC = async () => ['93.184.215.14'];
const LOOPBACK = async () => ['127.0.0.1'];

function respond(body: string, init: ResponseInit & { type?: string } = {}): Response {
  const headers = new Headers(init.headers);
  if (!headers.has('content-type')) headers.set('content-type', init.type ?? 'text/html');
  return new Response(body, { ...init, headers });
}

describe('fetchPage', () => {
  it('reads a page as markdown, with its title and absolute links', async () => {
    const fetch = vi.fn(async () =>
      respond(
        '<html><head><title>Guardian sites</title><script>evil()</script></head>' +
          '<body><nav>Home | Forum</nav><main><h1>Sites</h1><p>See <a href="/gs/1">the first</a>.</p></main></body></html>',
      ),
    );
    const page = await fetchPage('https://example.org/guides', {
      fetch,
      lookup: PUBLIC,
      links: true,
    });

    expect(page.title).toBe('Guardian sites');
    expect(page.text).toContain('# Sites');
    expect(page.text).toContain('[the first](https://example.org/gs/1)');
    expect(page.text).not.toContain('evil');
    expect(page.text).not.toContain('Forum');
  });

  it('assumes https when no scheme is given', async () => {
    const fetch = vi.fn(async () => respond('hi', { type: 'text/plain' }));
    const page = await fetchPage('inara.cz', { fetch, lookup: PUBLIC });
    expect(page).toEqual({ url: 'https://inara.cz/', text: 'hi' });
  });

  it('follows redirects, checking every hop', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(respond('', { status: 302, headers: { location: '/moved' } }))
      .mockResolvedValueOnce(respond('{"a":1}', { type: 'application/json' }));
    const page = await fetchPage('https://example.org/', { fetch, lookup: PUBLIC });
    expect(page.url).toBe('https://example.org/moved');
    expect(JSON.parse(page.text)).toEqual({ a: 1 });
  });

  it('refuses a redirect into the local network', async () => {
    const fetch = vi.fn(async () =>
      respond('', { status: 301, headers: { location: 'http://192.168.1.1/admin' } }),
    );
    await expect(fetchPage('https://example.org/', { fetch, lookup: PUBLIC })).rejects.toThrow(
      /local network/,
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('refuses names that resolve to this machine, and other schemes', async () => {
    const fetch = vi.fn();
    await expect(fetchPage('https://sneaky.example/', { fetch, lookup: LOOPBACK })).rejects.toThrow(
      /local network/,
    );
    await expect(fetchPage('http://localhost:3000/', { fetch, lookup: PUBLIC })).rejects.toThrow(
      /local network/,
    );
    await expect(fetchPage('file:///C:/secrets.txt', { fetch, lookup: PUBLIC })).rejects.toThrow(
      /http and https/,
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it('says when a site turns the request away', async () => {
    const fetch = vi.fn(async () => respond('Just a moment...', { status: 403 }));
    await expect(fetchPage('https://example.org/', { fetch, lookup: PUBLIC })).rejects.toThrow(
      /refused.*403/,
    );
  });

  it("won't read what isn't a page", async () => {
    const fetch = vi.fn(async () => respond('%PDF', { type: 'application/pdf' }));
    await expect(fetchPage('https://example.org/a.pdf', { fetch, lookup: PUBLIC })).rejects.toThrow(
      /application\/pdf/,
    );
  });
});

describe('htmlToMarkdown', () => {
  it('keeps the page furniture out when there is no main element', () => {
    const { text } = htmlToMarkdown(
      '<body><header>Logo</header><div><p>Hello</p><a href="javascript:void(0)">x</a></div><footer>(c)</footer></body>',
      'https://example.org/',
      true,
    );
    expect(text).toContain('Hello');
    expect(text).not.toContain('Logo');
    expect(text).not.toContain('javascript');
  });

  it('keeps only the text of links unless asked for them, and drops images', () => {
    const html =
      '<main><p>Buy at <a href="/s/1" title="Station">Jameson</a>.<img src="a.png"></p></main>';
    expect(htmlToMarkdown(html, 'https://example.org/', false).text).toBe('Buy at Jameson.');
    expect(htmlToMarkdown(html, 'https://example.org/', true).text).toBe(
      'Buy at [Jameson](https://example.org/s/1).',
    );
  });
});

describe('isPublicAddress', () => {
  it.each([
    ['8.8.8.8', true],
    ['2606:4700::1111', true],
    ['10.1.2.3', false],
    ['172.20.0.1', false],
    ['169.254.169.254', false],
    ['100.64.1.1', false],
    ['::1', false],
    ['fe80::1', false],
    ['fd12::1', false],
    ['::ffff:192.168.0.1', false],
    ['not an address', false],
  ])('%s → %s', (address, expected) => {
    expect(isPublicAddress(address)).toBe(expected);
  });
});
