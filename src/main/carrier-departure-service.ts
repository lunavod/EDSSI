import { CarrierDeparture } from './carriers/departure';
import type { SettingsStore } from './config/store';
import type { JournalReader } from './journal';

export interface CarrierDepartureService {
  stop(): void;
}

/**
 * Says a minute before the commander's carrier jumps, while they're docked on it
 * (`carriers/departure.ts`). `reader` is the current session's; a jump requested before EDSSI
 * started is still warned about, since its replay schedules against the clock.
 */
export function startCarrierDepartureService(options: {
  reader: JournalReader;
  settings: SettingsStore;
  notify: (text: string) => void;
}): CarrierDepartureService {
  const departure = new CarrierDeparture();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const unsubscribe = options.reader.onAny((event) => {
    departure.handle(event);
    schedule();
  });

  function schedule(): void {
    if (timer) clearTimeout(timer);
    timer = undefined;
    const at = departure.warnAt();
    if (at === undefined) return;
    timer = setTimeout(
      () => {
        timer = undefined;
        const line = departure.due(Date.now());
        if (line && options.settings.current().voice.speech.carrier_departure_callouts) {
          options.notify(line);
        }
        schedule();
      },
      Math.max(0, at - Date.now()),
    );
  }

  return {
    stop() {
      unsubscribe();
      if (timer) clearTimeout(timer);
    },
  };
}
