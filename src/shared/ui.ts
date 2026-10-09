/** The parts of the window the main process (and so the assistant) can drive. */

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

export type TabId = (typeof TAB_IDS)[number];

/** Something the assistant asked the window to do. */
export type UiCommand = { type: 'open-tab'; tab: TabId } | { type: 'acknowledge' };
