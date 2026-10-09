import { useEffect, useState } from 'react';

import type { AssistantSnapshot } from '../../../shared/assistant';

/** The conversation and the assistant's state, kept up to date from the main process. */
export function useAssistant(): AssistantSnapshot | undefined {
  const [snapshot, setSnapshot] = useState<AssistantSnapshot>();

  useEffect(() => {
    let active = true;
    const offer = (next: AssistantSnapshot) =>
      setSnapshot((current) => (current && current.version > next.version ? current : next));
    // Subscribe first so nothing falls between the two; versions sort out the overlap.
    const unsubscribe = window.edssi.assistant.onChange(offer);
    window.edssi.assistant.getSnapshot().then(
      (next) => {
        if (active) offer(next);
      },
      (error: unknown) => console.error('[assistant] failed to load', error),
    );
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  return snapshot;
}
