import { describe, expect, it, vi } from 'vitest';

import type { BrowserState } from '../../../shared/browser';
import type { PromptAnswer, PromptRequest } from '../../../shared/prompts';
import { PageError } from '../../web/fetch';
import type { BrowserControl, PageElement } from '../browser-control';
import type { GameData } from '../game-data';
import type { ToolContext } from '../tools/define';
import { ToolRegistry } from '../tools/registry';
import { browserToolset } from './browser';

const PAGE: BrowserState = {
  url: 'https://spansh.co.uk/plotter',
  title: 'Neutron plotter',
  loading: false,
  canGoBack: true,
  canGoForward: false,
};

function element(overrides: Partial<PageElement> = {}): PageElement {
  return {
    tag: 'button',
    type: 'button',
    label: 'Calculate',
    autocomplete: '',
    name: '',
    editable: false,
    inForm: false,
    harmlessForm: false,
    submits: false,
    href: '',
    ...overrides,
  };
}

function fakeBrowser(overrides: Partial<BrowserControl> = {}) {
  return {
    state: () => PAGE,
    open: vi.fn(async () => PAGE),
    back: vi.fn(async () => PAGE),
    outline: vi.fn(async () => 'heading 1 "Neutron plotter"\nbutton "Calculate" [ref=12]'),
    screenshot: vi.fn(async () => 'data:image/jpeg;base64,AAAA'),
    inspect: vi.fn(async () => element()),
    focused: vi.fn(async () => undefined),
    click: vi.fn(async () => PAGE),
    type: vi.fn(async () => PAGE),
    press: vi.fn(async () => PAGE),
    scroll: vi.fn(async () => PAGE),
    evaluate: vi.fn(async () => 42),
    ...overrides,
  } satisfies BrowserControl;
}

function context(
  browser?: BrowserControl,
  askCommander?: (prompt: PromptRequest, signal: AbortSignal) => Promise<PromptAnswer>,
): ToolContext {
  return {
    game: {} as GameData,
    app: {
      openTab: vi.fn(),
      surface: vi.fn(),
      acknowledge: vi.fn(),
      copy: vi.fn(),
      viewOptions: vi.fn(),
      setViewOptions: vi.fn(),
    },
    browser,
    askCommander,
    signal: new AbortController().signal,
  };
}

const registry = new ToolRegistry([browserToolset]);

describe('browser tools', () => {
  it('opens a page, and shows it when asked', async () => {
    const openTab = vi.fn();
    const ctx = {
      ...context(fakeBrowser()),
      app: {
        openTab,
        surface: vi.fn(),
        acknowledge: vi.fn(),
        copy: vi.fn(),
        viewOptions: vi.fn(),
        setViewOptions: vi.fn(),
      },
    };
    const run = await registry.run(
      'browser_open',
      '{"url":"https://spansh.co.uk/plotter","show":true}',
      ctx,
    );
    expect(run.output).toBe('On "Neutron plotter" at https://spansh.co.uk/plotter.');
    expect(openTab).toHaveBeenCalledWith('browser');
  });

  it("passes on why an address was refused, as the model's to read", async () => {
    const browser = fakeBrowser({
      open: vi.fn(async () => {
        throw new PageError('Addresses on this machine or the local network are refused.');
      }),
    });
    const run = await registry.run(
      'browser_open',
      '{"url":"http://192.168.1.1"}',
      context(browser),
    );
    expect(run).toEqual({
      output: 'Addresses on this machine or the local network are refused.',
      failed: false,
    });
  });

  it('reads the page as an outline', async () => {
    const run = await registry.run('browser_read', '{}', context(fakeBrowser()));
    expect(JSON.parse(run.output)).toMatchObject({
      url: 'https://spansh.co.uk/plotter',
      text: expect.stringContaining('button "Calculate" [ref=12]'),
    });
  });

  it('hands a screenshot over as an image', async () => {
    const run = await registry.run('browser_screenshot', '{}', context(fakeBrowser()));
    expect(run.images).toEqual(['data:image/jpeg;base64,AAAA']);
    expect(run.output).toContain('Neutron plotter');
  });

  it('says so when there is no browser', async () => {
    const run = await registry.run('browser_read', '{}', context());
    expect(run.output).toBe('The browser is not available.');
  });

  it('clicks an ordinary button without asking', async () => {
    const browser = fakeBrowser();
    const ask = vi.fn();
    const run = await registry.run('browser_click', '{"ref":12}', context(browser, ask));
    expect(browser.click).toHaveBeenCalledWith(12, expect.anything());
    expect(ask).not.toHaveBeenCalled();
    expect(run.output).toContain('Neutron plotter');
  });

  it('asks before a button that buys, and stops at a no', async () => {
    const browser = fakeBrowser({ inspect: vi.fn(async () => element({ label: 'Buy now' })) });
    const ask = vi.fn(async () => 'deny' as const);
    const run = await registry.run('browser_click', '{"ref":7}', context(browser, ask));
    expect(ask).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'confirm', action: 'Click "Buy now"' }),
      expect.anything(),
    );
    expect(browser.click).not.toHaveBeenCalled();
    expect(run.output).toContain('said no');
  });

  it('goes ahead on a yes', async () => {
    const browser = fakeBrowser({ inspect: vi.fn(async () => element({ label: 'Post reply' })) });
    await registry.run(
      'browser_click',
      '{"ref":7}',
      context(browser, async () => 'allow'),
    );
    expect(browser.click).toHaveBeenCalled();
  });

  it("won't do anything that needs a yes when nobody can give one", async () => {
    const browser = fakeBrowser({ inspect: vi.fn(async () => element({ label: 'Delete' })) });
    const run = await registry.run('browser_click', '{"ref":7}', context(browser));
    expect(browser.click).not.toHaveBeenCalled();
    expect(run.output).toContain('nobody can');
  });

  it('never types into a password field', async () => {
    const browser = fakeBrowser({
      inspect: vi.fn(async () => element({ tag: 'input', type: 'password', editable: true })),
    });
    const run = await registry.run(
      'browser_type',
      '{"ref":3,"text":"hunter2"}',
      context(browser, async () => 'allow'),
    );
    expect(browser.type).not.toHaveBeenCalled();
    expect(run.output).toContain('request_commander_help');
  });

  it('searches without asking, but asks before submitting a form', async () => {
    const search = element({
      tag: 'input',
      type: 'search',
      editable: true,
      inForm: true,
      harmlessForm: true,
    });
    const browser = fakeBrowser({ inspect: vi.fn(async () => search) });
    const ask = vi.fn(async () => 'deny' as const);
    await registry.run(
      'browser_type',
      '{"ref":3,"text":"Colonia","submit":true}',
      context(browser, ask),
    );
    expect(ask).not.toHaveBeenCalled();
    expect(browser.press).toHaveBeenCalledWith('Enter', expect.anything());

    const message = element({
      tag: 'input',
      type: 'text',
      label: 'Subject',
      editable: true,
      inForm: true,
    });
    const other = fakeBrowser({ inspect: vi.fn(async () => message) });
    const run = await registry.run(
      'browser_type',
      '{"ref":3,"text":"o7","submit":true}',
      context(other, ask),
    );
    expect(other.type).toHaveBeenCalled();
    expect(other.press).not.toHaveBeenCalled();
    expect(run.output).toContain('not submitted');
  });

  it('asks before pressing Enter in a form', async () => {
    const field = element({ tag: 'input', type: 'email', editable: true, inForm: true });
    const browser = fakeBrowser({ focused: vi.fn(async () => field) });
    const ask = vi.fn(async () => 'allow' as const);
    await registry.run('browser_press', '{"key":"Enter"}', context(browser, ask));
    expect(ask).toHaveBeenCalled();
    expect(browser.press).toHaveBeenCalledWith('Enter', expect.anything());
  });

  it('always asks before running a script, showing it', async () => {
    const browser = fakeBrowser();
    const ask = vi.fn(async () => 'allow' as const);
    const run = await registry.run(
      'browser_eval',
      '{"script":"document.title","purpose":"read the title."}',
      context(browser, ask),
    );
    expect(ask).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'Run a script on spansh.co.uk to read the title',
        detail: 'document.title',
      }),
      expect.anything(),
    );
    expect(JSON.parse(run.output)).toEqual({ value: 42 });
  });

  it('shows the browser and waits for the commander to help', async () => {
    const openTab = vi.fn();
    const ask = vi.fn(async () => 'done' as const);
    const run = await registry.run('request_commander_help', '{"reason":"solve the CAPTCHA"}', {
      ...context(fakeBrowser(), ask),
      app: {
        openTab,
        surface: vi.fn(),
        acknowledge: vi.fn(),
        copy: vi.fn(),
        viewOptions: vi.fn(),
        setViewOptions: vi.fn(),
      },
    });
    expect(openTab).toHaveBeenCalledWith('browser');
    expect(ask).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'help', reason: 'solve the CAPTCHA' }),
      expect.anything(),
    );
    expect(run.output).toContain('Read the page again');
  });

  it('puts the open page in front of every question', () => {
    expect(
      registry.brief({
        game: {} as GameData,
        app: {
          openTab: vi.fn(),
          surface: vi.fn(),
          acknowledge: vi.fn(),
          copy: vi.fn(),
          viewOptions: vi.fn(),
          setViewOptions: vi.fn(),
        },
        browser: fakeBrowser(),
      }),
    ).toBe('Browser: on "Neutron plotter" https://spansh.co.uk/plotter');
  });
});
