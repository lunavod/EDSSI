import { VrCommoditiesView } from '../commodities/VrCommoditiesView';
import { CommsView } from '../comms/CommsView';
import { useAssistant } from '../comms/useAssistant';
import { useListening } from '../comms/useVoice';
import { nearBody } from '../hud/near-body';
import { SidePanel } from '../hud/SidePanel';
import { Tabs } from '../hud/Tabs';
import { useCsvRoute } from '../hud/useCsvRoute';
import { useHistory } from '../hud/useHistory';
import { useHudColor } from '../hud/useHudColor';
import { useJournal } from '../journal/useJournal';
import { useNavRoutes } from '../journal/useNavRoutes';
import { MissionView, RouteSection } from '../mission/MissionView';
import { SessionStrip } from '../mission/SessionStrip';
import { useActivity } from '../mission/useActivity';
import { useSettings } from '../settings/useSettings';
import { InVr } from './in-vr';
import { useWindowTab } from './useWindowTab';

/** The panels the cockpit is made of; mirrors `VR_PANEL_IDS` in the main process. */
export const VR_PANELS = ['main', 'sidebar', 'comms', 'route', 'stats'] as const;
export type VrPanelId = (typeof VR_PANELS)[number];

export function isVrPanel(value: string): value is VrPanelId {
  return (VR_PANELS as readonly string[]).includes(value);
}

/**
 * The tabs the main panel has a VR version of. It shows whichever the window on the desk is on,
 * and Mission for any tab that has none yet; the panels around it stay as they are.
 */
const VR_TABS = [
  { id: 'mission', label: 'Mission' },
  { id: 'commodities', label: 'Commodities' },
] as const;
type VrTabId = (typeof VR_TABS)[number]['id'];

function vrTab(tab: string): VrTabId {
  return VR_TABS.find((candidate) => candidate.id === tab)?.id ?? 'mission';
}

/** Nothing in a headset can press a tab; the window's choice is what moves it. */
function ignoreSelect() {}

/**
 * One panel of the VR cockpit, chosen by the `#vr/<id>` the main process loads.
 *
 * Each panel is its own offscreen window, so each one subscribes for itself — they are live
 * whether or not the HUD window is even open. The modules are the same components the window uses;
 * nothing here is a VR-only copy that could drift from what the desk shows.
 */
export function VrPanel({ panel }: { panel: VrPanelId }) {
  const { overview, companions } = useJournal();
  const routes = useNavRoutes();
  const csvRoute = useCsvRoute();
  const history = useHistory();
  const activity = useActivity();
  const settings = useSettings();
  const assistant = useAssistant();
  // Reported, not owned: the microphone and the answer belong to the window on the desk, and a
  // second of each in here asked every question twice and answered it over itself.
  const voice = useListening();
  const tab = vrTab(useWindowTab());
  // Draws the panel in the EDHM theme's colour, the same as the window.
  useHudColor();

  return (
    <InVr value>
      <div className={`vr-panel vr-panel-${panel}`}>
        {/* Outside the scrolling box, so the tabs stay put while a long page scrolls. */}
        {panel === 'main' && (
          <Tabs tabs={VR_TABS} active={tab} onSelect={ignoreSelect} ariaLabel="Module" />
        )}
        {/*
        The panel scrolls, its backing does not. Keeping them in separate boxes is what lets the
        backing be an ordinary absolutely-placed layer instead of a fixed one — see `.vr-panel`.
      */}
        <div className="vr-panel-scroll">
          {panel === 'main' && tab === 'commodities' && (
            <VrCommoditiesView where={{ system: overview.system, station: overview.station }} />
          )}
          {panel === 'main' && tab === 'mission' && (
            <MissionView
              overview={overview}
              settings={settings?.settings}
              routes={routes}
              csvRoute={csvRoute}
              history={history}
              activity={activity}
              bodyName={nearBody(companions.Status)}
              hideRoute
              hideSession
            />
          )}
          {panel === 'sidebar' && (
            <SidePanel
              overview={overview}
              status={companions.Status}
              routes={routes}
              csvRoute={csvRoute}
              history={history}
              lowFuelFraction={settings?.settings.flight_alerts.low_fuel_fraction}
            />
          )}
          {panel === 'comms' && <CommsView snapshot={assistant} voice={voice} vr />}
          {panel === 'route' && (
            <RouteSection overview={overview} routes={routes} csvRoute={csvRoute} />
          )}
          {panel === 'stats' && <SessionStrip tallies={activity} periods={false} />}
        </div>
      </div>
    </InVr>
  );
}
