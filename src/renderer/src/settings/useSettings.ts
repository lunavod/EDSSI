import { useEffect, useState } from 'react';

import type { SettingsView } from '../../../shared/api';
import type { InputSnapshot } from '../../../shared/input';
import type { UploadsSnapshot } from '../../../shared/uploads';

/** The settings file as EDSSI is running it, kept up to date however it changes. */
export function useSettings(): SettingsView | undefined {
  const [view, setView] = useState<SettingsView>();

  useEffect(() => {
    let active = true;
    // Subscribe first, so a save between the two isn't missed.
    const unsubscribe = window.edssi.settings.onChange(setView);
    window.edssi.settings.get().then(
      (next) => {
        if (active) setView((current) => current ?? next);
      },
      (error: unknown) => console.error('[settings] failed to load', error),
    );
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  return view;
}

/** The sticks EDSSI can see and which bindings are held, for the push-to-talk panel. */
export function useInput(): InputSnapshot | undefined {
  const [snapshot, setSnapshot] = useState<InputSnapshot>();

  useEffect(() => {
    let active = true;
    const offer = (next: InputSnapshot) =>
      setSnapshot((current) => (current && current.version > next.version ? current : next));
    const unsubscribe = window.edssi.input.onChange(offer);
    window.edssi.input.getSnapshot().then(
      (next) => {
        if (active) offer(next);
      },
      (error: unknown) => console.error('[input] failed to load', error),
    );
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  return snapshot;
}

/** Whether the journal is reaching EDSM, Inara and EDDN, for the settings sections that set them up. */
export function useUploads(): UploadsSnapshot | undefined {
  const [snapshot, setSnapshot] = useState<UploadsSnapshot>();

  useEffect(() => {
    let active = true;
    const offer = (next: UploadsSnapshot) =>
      setSnapshot((current) => (current && current.version > next.version ? current : next));
    const unsubscribe = window.edssi.uploads.onChange(offer);
    window.edssi.uploads.getSnapshot().then(
      (next) => {
        if (active) offer(next);
      },
      (error: unknown) => console.error('[uploads] failed to load', error),
    );
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  return snapshot;
}
