/** The parts of the window the main process (and so the assistant) can drive. */

/** EDSSI's own tabs. */
export const TAB_IDS = [
  'mission',
  'ships',
  'materials',
  'commodities',
  'journal',
  'route',
  'comms',
  'browser',
  'settings',
] as const;

/** A tab an extension adds (`RendererExtension.tabs`): `ext:<extension>/<tab>`. */
export type ExtensionTabId = `ext:${string}`;

export type TabId = (typeof TAB_IDS)[number] | ExtensionTabId;

/** The id of an extension's tab, as the tab bar and `showTab` know it. */
export function extensionTabId(extension: string, tab: string): ExtensionTabId {
  return `ext:${extension}/${tab}`;
}

export function isTabId(value: unknown): value is TabId {
  return (
    typeof value === 'string' &&
    ((TAB_IDS as readonly string[]).includes(value) || /^ext:[^/]+\/.+/.test(value))
  );
}

/** Something the assistant asked the window to do. */
export type UiCommand = { type: 'open-tab'; tab: TabId } | { type: 'acknowledge' };
