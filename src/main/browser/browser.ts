/**
 * The browser the assistant drives, shown in EDSSI's own window.
 *
 * It is a `WebContentsView` laid over the Browser tab: the tab reports where its frame is, and the
 * view is moved there, or hidden while another tab is up. It is created with the first page, on a
 * session of its own (`persist:browser`), so a site the commander signs in to stays signed in
 * without that sign-in being anywhere near EDSSI's own pages.
 *
 * Pages are untrusted. The view has no preload, so nothing on a page can reach `window.edssi`;
 * it is sandboxed; every permission a page asks for is refused and every download cancelled; and
 * no request goes to this machine or a local-network address written as one.
 *
 * The assistant reads pages through the DevTools protocol (`webContents.debugger`), the same one
 * Chrome's own automation uses, rather than by injecting script into them.
 */

import { type BrowserWindow, ipcMain, type NativeImage, session, WebContentsView } from 'electron';

import { IpcChannel } from '../../shared/api';
import { type BrowserBounds, type BrowserState, typedAddress } from '../../shared/browser';
import type { BrowserControl, BrowserKey, PageElement } from '../ai/browser-control';
import { broadcast } from '../broadcast';
import { isLocalHost, PageError, publicUrl } from '../web/fetch';
import {
  clickElement,
  evaluateScript,
  focusedElement,
  inspectElement,
  pressKey,
  scrollPage,
  typeInto,
} from './actions';
import { type AxNode, formatAxTree } from './ax-tree';

const PARTITION = 'persist:browser';
/** Long enough for a heavy page to be usable; the tool registry gives up at 20 s. */
const LOAD_TIMEOUT_MS = 12_000;
/** Screenshots are scaled down to this width: plenty to read, and far fewer tokens. */
const SCREENSHOT_WIDTH = 1280;
/** How long after input before looking at the page again. */
const SETTLE_MS = 500;
const CAPTURE_ATTEMPTS = 12;
const CAPTURE_RETRY_MS = 250;
/** ERR_ABORTED: a load replaced by another, such as a redirect the page does itself. */
const ERR_ABORTED = -3;

export class Browser implements BrowserControl {
  #window: BrowserWindow | undefined;
  #view: WebContentsView | undefined;
  /** Where the tab wants the page, in the window's CSS pixels; null while it is hidden. */
  #bounds: BrowserBounds = null;
  #error: string | undefined;
  #sessionReady = false;

  constructor() {
    ipcMain.handle(IpcChannel.BrowserState, () => this.state() ?? emptyState());
    ipcMain.handle(IpcChannel.BrowserBounds, (_event, bounds: BrowserBounds) => {
      this.#bounds = bounds;
      this.#layout();
    });
    ipcMain.handle(IpcChannel.BrowserNavigate, async (_event, address: unknown) => {
      if (typeof address !== 'string' || !address.trim()) return;
      await this.#navigate(typedAddress(address.trim()));
    });
    ipcMain.handle(IpcChannel.BrowserBack, () =>
      this.#view?.webContents.navigationHistory.goBack(),
    );
    ipcMain.handle(IpcChannel.BrowserForward, () =>
      this.#view?.webContents.navigationHistory.goForward(),
    );
    ipcMain.handle(IpcChannel.BrowserReload, () => this.#view?.webContents.reload());
  }

  /** The window to show pages in. A new window (after the last was closed) takes over. */
  attach(window: BrowserWindow): void {
    this.#window = window;
    window.on('closed', () => {
      if (this.#window !== window) return;
      this.#window = undefined;
      this.#view = undefined;
    });
    // The page is laid out in CSS pixels, which the window's zoom stretches.
    window.webContents.on('zoom-changed', () => this.#layout());
  }

  state(): BrowserState | undefined {
    const contents = this.#contents();
    if (!contents) return undefined;
    return {
      url: contents.getURL() || undefined,
      title: contents.getTitle() || undefined,
      loading: contents.isLoading(),
      canGoBack: contents.navigationHistory.canGoBack(),
      canGoForward: contents.navigationHistory.canGoForward(),
      error: this.#error,
    };
  }

  async open(address: string, signal: AbortSignal): Promise<BrowserState> {
    const url = await publicUrl(address);
    await this.#navigate(url.href, signal);
    return this.state() ?? emptyState();
  }

  async back(signal: AbortSignal): Promise<BrowserState> {
    const contents = this.#contents();
    if (!contents?.navigationHistory.canGoBack())
      throw new PageError('There is no page to go back to.');
    const stopped = waitForStop(contents, signal);
    contents.navigationHistory.goBack();
    await stopped;
    return this.state() ?? emptyState();
  }

  async outline(signal: AbortSignal): Promise<string> {
    const contents = this.#contents();
    if (!contents) throw new PageError('The browser has no page open.');
    await waitForStop(contents, signal);
    const { nodes } = await this.#command<{ nodes: AxNode[] }>('Accessibility.getFullAXTree');
    return formatAxTree(nodes);
  }

  async screenshot(signal: AbortSignal): Promise<string> {
    const contents = this.#contents();
    if (!contents) throw new PageError('The browser has no page open.');
    await waitForStop(contents, signal);
    let image = await capture(contents, signal);
    if (image.getSize().width > SCREENSHOT_WIDTH) {
      image = image.resize({ width: SCREENSHOT_WIDTH, quality: 'good' });
    }
    return `data:image/jpeg;base64,${image.toJPEG(70).toString('base64')}`;
  }

  async inspect(ref: number, signal: AbortSignal): Promise<PageElement> {
    await this.#ready(signal);
    return inspectElement(this.#send, ref);
  }

  async focused(signal: AbortSignal): Promise<PageElement | undefined> {
    await this.#ready(signal);
    return focusedElement(this.#send);
  }

  async click(ref: number, signal: AbortSignal): Promise<BrowserState> {
    await this.#ready(signal);
    await clickElement(this.#send, ref);
    return this.#settle(signal);
  }

  async type(ref: number, text: string, signal: AbortSignal): Promise<BrowserState> {
    await this.#ready(signal);
    await typeInto(this.#send, ref, text);
    return this.#settle(signal);
  }

  async press(key: BrowserKey, signal: AbortSignal): Promise<BrowserState> {
    await this.#ready(signal);
    await pressKey(this.#send, key);
    return this.#settle(signal);
  }

  async scroll(direction: 'up' | 'down', signal: AbortSignal): Promise<BrowserState> {
    await this.#ready(signal);
    if (!(await scrollPage(this.#send, direction))) {
      throw new PageError(`The page is already at the ${direction === 'down' ? 'bottom' : 'top'}.`);
    }
    return this.#settle(signal);
  }

  async evaluate(script: string, signal: AbortSignal): Promise<unknown> {
    await this.#ready(signal);
    return evaluateScript(this.#send, script);
  }

  /** There is a page, and it has finished loading. */
  async #ready(signal: AbortSignal): Promise<void> {
    const contents = this.#contents();
    if (!contents) throw new PageError('The browser has no page open.');
    await waitForStop(contents, signal);
  }

  /** After input: long enough for a click to start a navigation, and for that to finish. */
  async #settle(signal: AbortSignal): Promise<BrowserState> {
    await delay(SETTLE_MS, signal);
    signal.throwIfAborted();
    const contents = this.#contents();
    if (contents) await waitForStop(contents, signal);
    return this.state() ?? emptyState();
  }

  readonly #send = <T>(method: string, params?: Record<string, unknown>): Promise<T> =>
    this.#command<T>(method, params);

  /** Loads a page, waiting until it has finished or long enough that it is usable anyway. */
  async #navigate(url: string, signal?: AbortSignal): Promise<void> {
    const fresh = !this.#contents();
    const contents = this.#ensureView().webContents;
    // A hidden view never gets a surface to capture for the first document it loads, only for
    // later ones, so it starts on a blank page (tried on Electron 44 with several sites).
    if (fresh) await contents.loadURL('about:blank').catch(() => undefined);
    this.#error = undefined;
    const load = contents.loadURL(url).catch((error: unknown) => {
      if (errorCode(error) === ERR_ABORTED) return;
      this.#error = error instanceof Error ? error.message : String(error);
      this.#publish();
    });
    await Promise.race([load, delay(LOAD_TIMEOUT_MS, signal)]);
    signal?.throwIfAborted();
    // Read through state(): set by the load's own handler, which the compiler can't see.
    const failure = this.state()?.error;
    if (failure) throw new PageError(`The page failed to load: ${failure}`);
  }

  #contents(): Electron.WebContents | undefined {
    const contents = this.#view?.webContents;
    return contents && !contents.isDestroyed() ? contents : undefined;
  }

  #ensureView(): WebContentsView {
    if (this.#view && !this.#view.webContents.isDestroyed()) return this.#view;
    const window = this.#window;
    if (!window || window.isDestroyed()) {
      throw new PageError('EDSSI has no window to show a browser in.');
    }
    this.#prepareSession();

    const view = new WebContentsView({
      webPreferences: {
        partition: PARTITION,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        safeDialogs: true,
        // It is often working while hidden behind another tab.
        backgroundThrottling: false,
      },
    });
    view.setBackgroundColor('#ffffff');
    window.contentView.addChildView(view);
    this.#view = view;

    const contents = view.webContents;
    const publish = (): void => this.#publish();
    contents.on('did-start-loading', publish);
    contents.on('did-stop-loading', publish);
    contents.on('did-navigate', publish);
    contents.on('did-navigate-in-page', publish);
    contents.on('page-title-updated', publish);
    // A link that opens a new window opens here instead; there is only the one page.
    contents.setWindowOpenHandler(({ url }) => {
      if (isWebUrl(url)) void contents.loadURL(url).catch(() => undefined);
      return { action: 'deny' };
    });
    contents.on('will-navigate', (event) => {
      if (!isWebUrl(event.url)) event.preventDefault();
    });
    contents.on('render-process-gone', () => {
      this.#error = 'the page crashed';
      this.#publish();
    });

    this.#layout();
    return view;
  }

  #prepareSession(): void {
    if (this.#sessionReady) return;
    this.#sessionReady = true;
    const browserSession = session.fromPartition(PARTITION);
    browserSession.setPermissionRequestHandler((_contents, _permission, callback) =>
      callback(false),
    );
    browserSession.setPermissionCheckHandler(() => false);
    browserSession.on('will-download', (event) => event.preventDefault());
    browserSession.webRequest.onBeforeRequest((details, callback) => {
      let cancel = false;
      try {
        const url = new URL(details.url);
        cancel =
          (url.protocol === 'http:' ||
            url.protocol === 'https:' ||
            url.protocol === 'ws:' ||
            url.protocol === 'wss:') &&
          isLocalHost(url.hostname);
      } catch {
        cancel = true;
      }
      callback({ cancel });
    });
  }

  /** Puts the view over the tab's frame, or hides it. */
  #layout(): void {
    const view = this.#view;
    const window = this.#window;
    if (!view || !window || window.isDestroyed()) return;
    const bounds = this.#bounds;
    if (!bounds || bounds.width <= 0 || bounds.height <= 0) {
      // Hidden, but kept at a real size so the page still lays out and can be captured. The size
      // has to be set before hiding: a view sized while hidden captures as an empty image.
      if (view.getBounds().width === 0) {
        const [width = 1280, height = 800] = window.getContentSize();
        view.setBounds({ x: 0, y: 0, width, height });
      }
      view.setVisible(false);
      return;
    }
    const zoom = window.webContents.getZoomFactor();
    view.setBounds({
      x: Math.round(bounds.x * zoom),
      y: Math.round(bounds.y * zoom),
      width: Math.round(bounds.width * zoom),
      height: Math.round(bounds.height * zoom),
    });
    view.setVisible(true);
  }

  async #command<T>(method: string, params?: Record<string, unknown>): Promise<T> {
    const contents = this.#contents();
    if (!contents) throw new PageError('The browser has no page open.');
    const protocol = contents.debugger;
    if (!protocol.isAttached()) {
      try {
        protocol.attach('1.3');
      } catch {
        throw new PageError('The page is being inspected elsewhere; close its developer tools.');
      }
      // Without it a hidden view (another tab showing) drops clicks and keys, or holds them back.
      await protocol.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true });
    }
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the protocol's own answer
    return (await protocol.sendCommand(method, params)) as T;
  }

  #publish(): void {
    broadcast(IpcChannel.BrowserChanged, this.state() ?? emptyState());
  }
}

function emptyState(): BrowserState {
  return { loading: false, canGoBack: false, canGoForward: false };
}

function isWebUrl(url: string): boolean {
  return url.startsWith('https:') || url.startsWith('http:') || url === 'about:blank';
}

/**
 * Captures the page, hidden or not. Right after a navigation the new document may not have drawn
 * yet, which `capturePage` reports as an error; a few tries a moment apart get past that.
 */
async function capture(contents: Electron.WebContents, signal: AbortSignal): Promise<NativeImage> {
  let last: unknown;
  for (let attempt = 0; attempt < CAPTURE_ATTEMPTS; attempt++) {
    signal.throwIfAborted();
    try {
      const image = await contents.capturePage(undefined, { stayHidden: true });
      if (!image.isEmpty()) return image;
    } catch (error) {
      last = error;
    }
    await delay(CAPTURE_RETRY_MS, signal);
  }
  const reason = last instanceof Error ? `: ${last.message}` : '';
  throw new PageError(`The page could not be captured${reason}.`);
}

/** Resolves once the page has stopped loading, or after the load timeout. */
function waitForStop(contents: Electron.WebContents, signal: AbortSignal): Promise<void> {
  if (!contents.isLoading()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const cleanUp = (): void => {
      clearTimeout(timer);
      contents.off('did-stop-loading', done);
      signal.removeEventListener('abort', aborted);
    };
    const done = (): void => {
      cleanUp();
      resolve();
    };
    const aborted = (): void => {
      cleanUp();
      reject(signal.reason);
    };
    const timer = setTimeout(done, LOAD_TIMEOUT_MS);
    contents.on('did-stop-loading', done);
    signal.addEventListener('abort', aborted, { once: true });
  });
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

function errorCode(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null || !('errno' in error)) return undefined;
  return typeof error.errno === 'number' ? error.errno : undefined;
}
