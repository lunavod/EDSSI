import { useEffect, useState } from 'react';

import type { HudColor } from '../../../shared/edhm';
import { accentFor, goodFor, warningFor } from '../../../shared/hud-color';
import { useEdssiInstance } from '../api/context';

/**
 * Draws the window in the EDHM theme's colour, while there is one and matching is on. Only
 * `--accent`, `--warn` and `--good` are set: EDSSI's other colours are mixed from the accent in
 * `hud.css`, whose own defaults suit Elite's orange.
 */
export function useHudColor(): HudColor | null | undefined {
  const { api: edssi, themeRoot } = useEdssiInstance();
  const [hud, setHud] = useState<HudColor | null>();

  useEffect(() => {
    let active = true;
    // Subscribe first, so a change between the two isn't missed.
    const unsubscribe = edssi.edhm.onHudColorChange(setHud);
    edssi.edhm.getHudColor().then(
      (next) => {
        if (active) setHud((current) => (current === undefined ? next : current));
      },
      (error: unknown) => console.error('[edhm] failed to read the HUD colour', error),
    );
    return () => {
      active = false;
      unsubscribe();
    };
  }, [edssi]);

  useEffect(() => {
    const root = themeRoot().style;
    if (hud) {
      const accent = accentFor(hud.color);
      root.setProperty('--accent', accent);
      root.setProperty('--warn', warningFor(accent));
      root.setProperty('--good', goodFor(accent));
    } else {
      root.removeProperty('--accent');
      root.removeProperty('--warn');
      root.removeProperty('--good');
    }
  }, [hud, themeRoot]);

  return hud;
}
