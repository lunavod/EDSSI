/** The browser the assistant drives, as the window shows it. */

export interface BrowserState {
  /** Undefined before the first page is opened. */
  url?: string;
  title?: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  /** Why the last page failed to load, if it did. */
  error?: string;
}

/** Where the page goes, in the window's CSS pixels; null while the Browser tab is hidden. */
export type BrowserBounds = { x: number; y: number; width: number; height: number } | null;

/**
 * What the commander typed into the address bar: an address, or words to search for. Unlike an
 * address from the model, a local one is let through here, to be refused by the browser itself.
 */
export function typedAddress(text: string): string {
  if (/^https?:\/\//iu.test(text)) return text;
  if (!/\s/u.test(text) && /^[\w-]+(\.[\w-]+)+(:\d+)?(\/.*)?$/u.test(text)) {
    return `https://${text}`;
  }
  return `https://duckduckgo.com/?q=${encodeURIComponent(text)}`;
}
