import { useEffect, useState } from 'react';

import { isNewerMaterialsSnapshot, type MaterialsSnapshot } from '../../../shared/materials';

/** Inventory, crafting history and favourite recipes from the main process, kept up to date. */
export function useMaterials(): MaterialsSnapshot | undefined {
  const [snapshot, setSnapshot] = useState<MaterialsSnapshot>();

  useEffect(() => {
    let active = true;
    const offer = (next: MaterialsSnapshot) =>
      setSnapshot((current) => (isNewerMaterialsSnapshot(current, next) ? next : current));
    // Subscribe first so nothing falls between the two; versions sort out the overlap.
    const unsubscribe = window.edssi.materials.onChange(offer);
    window.edssi.materials.getSnapshot().then(
      (next) => {
        if (active) offer(next);
      },
      (error: unknown) => console.error('[materials] failed to load', error),
    );
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  return snapshot;
}
