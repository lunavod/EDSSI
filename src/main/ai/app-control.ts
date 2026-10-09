/** The parts of the app the assistant may drive. Keep it small: every entry is a tool. */

import type { TabId } from '../../shared/ui';
import type { ViewOptions, ViewOptionsPatch } from '../../shared/view-options';

export interface AppControl {
  /** Brings a module up in every window. */
  openTab(tab: TabId): void;
  /** Brings EDSSI's window in front of the game. */
  surface(): void;
  /** Plays the acknowledgement chirp, in place of saying "Done." */
  acknowledge(): void;
  /** Puts text on the system clipboard, replacing whatever was there. */
  copy(text: string): void;
  /** How the views are sorted and what they show, in every window. */
  viewOptions(): ViewOptions;
  /** Changes some of them in every window; resolves to them all. */
  setViewOptions(patch: ViewOptionsPatch): ViewOptions;
}
