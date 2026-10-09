import type { CsvRouteState } from '../shared/csv-route';
import type { SystemSurvey } from '../shared/history';
import type { PlottedRoute } from '../shared/nav-routes';
import type { SettingsStore } from './config/store';
import type { EdsmClient } from './edsm';
import { FlightAlerts, readNearestStar, scoopableStarSearch } from './flight/alerts';
import type { JournalReader } from './journal';
import { SpanshClient } from './spansh/client';

export interface FlightAlertService {
  /** Call once `reader` has replayed the session, so only what happens from now on is warned about. */
  markLive(): void;
  stop(): void;
}

/**
 * Warns about low fuel, a next jump with no scoopable star and high-gravity bodies, each once,
 * through the assistant's `notify`. `reader` is the current session's reader; the route and the
 * system survey come from the services that follow every journal.
 */
export function startFlightAlertService(options: {
  reader: JournalReader;
  settings: SettingsStore;
  routes: () => readonly PlottedRoute[];
  csvRoute: () => CsvRouteState | undefined;
  survey: () => SystemSurvey | undefined;
  edsm: EdsmClient;
  notify: (text: string) => void;
  spansh?: SpanshClient;
}): FlightAlertService {
  const spansh = options.spansh ?? new SpanshClient();
  const alerts = new FlightAlerts({
    settings: () => options.settings.current().flight_alerts,
    routes: options.routes,
    csvRoute: options.csvRoute,
    survey: options.survey,
    primaryStar: async (system) => (await options.edsm.system(system)).primaryStar,
    nearestScoopable: async (coords, signal) =>
      readNearestStar(await spansh.search('bodies', scoopableStarSearch(coords), signal)),
    notify: options.notify,
  });

  const unsubscribe = [
    options.reader.onAny((event) => alerts.event(event)),
    options.reader.onCompanion('Status', (status) => alerts.status(status)),
  ];

  return {
    markLive() {
      alerts.markLive();
    },
    stop() {
      for (const off of unsubscribe) off();
      alerts.stop();
    },
  };
}
