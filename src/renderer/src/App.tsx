import { useCallback, useEffect, useRef, useState } from 'react';

import type { TabId } from '../../shared/ui';
import { useEdssi } from './api/context';
import { commoditiesLeft, CommoditiesView } from './commodities/CommoditiesView';
import { useShoppingList } from './commodities/useCommodities';
import { type CommsPage, CommsTab } from './comms/CommsTab';
import { useAssistant } from './comms/useAssistant';
import { useVoice } from './comms/useVoice';
import { ExtensionBoundary } from './ExtensionBoundary';
import { extensionTabs } from './extensions';
import { Glyph } from './hud/Glyph';
import { Line } from './hud/Line';
import { nearBody } from './hud/near-body';
import { RouteTab } from './hud/RouteTab';
import { SidePanel } from './hud/SidePanel';
import { Tabs } from './hud/Tabs';
import { useCsvRoute } from './hud/useCsvRoute';
import { useHistory } from './hud/useHistory';
import { useHudColor } from './hud/useHudColor';
import { WindowControls } from './hud/WindowControls';
import { JournalView } from './journal/JournalView';
import { useJournal } from './journal/useJournal';
import { useNavRoutes } from './journal/useNavRoutes';
import { MaterialsView } from './materials/MaterialsView';
import { useMaterials } from './materials/useMaterials';
import { MissionView } from './mission/MissionView';
import { useActivity } from './mission/useActivity';
import { useSettingsRequests } from './settings/open';
import { SettingsView } from './settings/SettingsView';
import { useInput, useSettings, useUploads } from './settings/useSettings';
import { ShipsView } from './ships/ShipsView';
import { useCarriers } from './ships/useCarriers';
import { useShips } from './ships/useShips';
import { useUpdates } from './updates/useUpdates';
import { WhatsNewOnUpdate } from './updates/WhatsNew';

const TABS = [
  { id: 'mission', label: 'Mission' },
  { id: 'route', label: 'Route' },
  { id: 'comms', label: 'Comms' },
  { id: 'materials', label: 'Materials' },
  { id: 'commodities', label: 'Commodities' },
  { id: 'journal', label: 'Journal' },
  { id: 'ships', label: 'Ships' },
] as const;

/** The extensions' own modules, after EDSSI's. Fixed before this module loads (`main.tsx`). */
const EXTENSION_TABS = extensionTabs();

/**
 * Each extension tab's badge. The list never changes while the window is up, so the hooks are
 * always called in the same order.
 */
function useExtensionBadges(): (string | number | undefined)[] {
  // oxlint-disable-next-line react-hooks/rules-of-hooks -- a fixed list, called in a fixed order
  return EXTENSION_TABS.map(({ tab }) => tab.useBadge?.());
}

/** The window. `initialTab` is the module it opens on: Mission, unless an embedder says. */
export function App({ initialTab = 'mission' }: { initialTab?: TabId }) {
  const edssi = useEdssi();
  const [tab, setTab] = useState<TabId>(initialTab);
  // Unsaved settings hold the Settings tab until they are saved or discarded.
  const settingsDirty = useRef(false);
  const [leavingFor, setLeavingFor] = useState<TabId>();
  const tabRef = useRef(tab);
  useEffect(() => {
    tabRef.current = tab;
    // The VR cockpit shows its own version of this tab, where it has one.
    edssi.ui.setTab(tab);
  }, [edssi, tab]);
  // The browser is a page of Comms; the Comms tab brings back whichever page was open last.
  const commsPage = useRef<CommsPage>('comms');
  const selectTab = useCallback((requested: TabId) => {
    const next = requested === 'comms' ? commsPage.current : requested;
    if (next === 'comms' || next === 'browser') commsPage.current = next;
    if (tabRef.current === 'settings' && next !== 'settings' && settingsDirty.current) {
      setLeavingFor(next);
      return;
    }
    setLeavingFor(undefined);
    setTab(next);
  }, []);
  // A page of Settings asked for from elsewhere in the window: the tab comes forward with it.
  const settingsRequests = useSettingsRequests();
  useEffect(() => settingsRequests.on(() => selectTab('settings')), [settingsRequests, selectTab]);
  const onSettingsDirty = useCallback((dirty: boolean) => {
    settingsDirty.current = dirty;
  }, []);
  const onLeaveSettings = useCallback(
    (go: boolean) => {
      if (go && leavingFor) {
        settingsDirty.current = false;
        setTab(leavingFor);
      }
      setLeavingFor(undefined);
    },
    [leavingFor],
  );
  const { overview, entries, companions } = useJournal();
  const routes = useNavRoutes();
  const csvRoute = useCsvRoute();
  const history = useHistory();
  const activity = useActivity();
  const materials = useMaterials();
  const ships = useShips();
  const carriers = useCarriers();
  const assistant = useAssistant();
  const settings = useSettings();
  const input = useInput();
  const uploads = useUploads();
  const updates = useUpdates();
  const hud = useHudColor();
  const shopping = useShoppingList();
  const voice = useVoice(assistant?.setup);
  const extensionBadges = useExtensionBadges();

  // The assistant can put a module up when it is asked to show something.
  useEffect(
    () =>
      edssi.ui.onCommand((command) => {
        if (command.type === 'open-tab') selectTab(command.tab);
      }),
    [edssi, selectTab],
  );

  // What the assistant is doing rides on the Comms tab.
  const listening = voice.listening
    ? 'Listening'
    : assistant?.phase !== undefined && assistant.phase !== 'idle'
      ? assistant.phase
      : undefined;
  const tabs = [
    ...TABS.map((candidate) =>
      candidate.id === 'commodities' && commoditiesLeft(shopping) > 0
        ? { ...candidate, badge: commoditiesLeft(shopping) }
        : candidate.id === 'comms' && listening
          ? { ...candidate, badge: listening }
          : candidate,
    ),
    ...EXTENSION_TABS.map(({ id, tab: added }, index) => ({
      id,
      label: added.label,
      badge: extensionBadges[index],
    })),
  ];

  return (
    <div className="hud">
      <header className="titlebar">
        <Tabs
          tabs={tabs}
          active={tab === 'browser' ? 'comms' : tab}
          onSelect={selectTab}
          ariaLabel="Modules"
        />
        {updates?.status === 'ready' && (
          <button
            type="button"
            className="updatebtn"
            title={`EDSSI ${updates.version} installs the next time EDSSI starts, or now from Settings, About`}
            onClick={() => settingsRequests.open('about')}
          >
            Update ready
          </button>
        )}
        <button
          type="button"
          className="gearbtn"
          aria-label="Settings"
          title="Settings"
          aria-pressed={tab === 'settings'}
          onClick={() => selectTab('settings')}
        >
          <Glyph name="gear" />
        </button>
        <WindowControls />
      </header>
      <Line />
      <div className="hud-body">
        <main className="hud-main">
          {/* All stay mounted so the journal keeps its filters while another module is shown. */}
          <div className="hud-module" hidden={tab !== 'mission'}>
            <MissionView
              overview={overview}
              settings={settings?.settings}
              routes={routes}
              csvRoute={csvRoute}
              history={history}
              activity={activity}
              bodyName={nearBody(companions.Status)}
            />
          </div>
          <div className="hud-module" hidden={tab !== 'ships'}>
            <ShipsView snapshot={ships} carriers={carriers} />
          </div>
          <div className="hud-module" hidden={tab !== 'materials'}>
            <MaterialsView snapshot={materials} here={overview.system} />
          </div>
          <div className="hud-module" hidden={tab !== 'commodities'}>
            <CommoditiesView
              list={shopping}
              where={{ system: overview.system, station: overview.station }}
              cargo={companions.Cargo}
              carriers={carriers}
            />
          </div>
          <div className="hud-module" hidden={tab !== 'journal'}>
            <JournalView entries={entries} routes={routes} losses={history?.losses ?? []} />
          </div>
          <div className="hud-module" hidden={tab !== 'route'}>
            <RouteTab
              routes={routes}
              csvRoute={csvRoute}
              systemAddress={overview.systemAddress}
              system={overview.system}
              fuel={companions.Status?.Fuel?.FuelMain}
            />
          </div>
          <div className="hud-module" hidden={tab !== 'comms' && tab !== 'browser'}>
            <CommsTab
              page={tab === 'browser' ? 'browser' : 'comms'}
              onPage={(page) => {
                commsPage.current = page;
                selectTab(page);
              }}
              snapshot={assistant}
              voice={voice}
              browserActive={tab === 'browser' && leavingFor === undefined}
            />
          </div>
          {EXTENSION_TABS.map(({ id, extension, tab: { View } }) => (
            <div key={id} className="hud-module" hidden={tab !== id}>
              <ExtensionBoundary name={extension}>
                <View active={tab === id} />
              </ExtensionBoundary>
            </div>
          ))}
          <div className="hud-module" hidden={tab !== 'settings'}>
            <SettingsView
              view={settings}
              input={input}
              uploads={uploads}
              updates={updates}
              assistant={assistant?.setup}
              hud={hud}
              active={tab === 'settings'}
              onDirtyChange={onSettingsDirty}
              leavingFor={
                leavingFor &&
                tabs.find(
                  (candidate) => candidate.id === (leavingFor === 'browser' ? 'comms' : leavingFor),
                )?.label
              }
              onLeave={onLeaveSettings}
            />
          </div>
        </main>
        <Line vertical />
        <SidePanel
          overview={overview}
          status={companions.Status}
          routes={routes}
          csvRoute={csvRoute}
          history={history}
          lowFuelFraction={settings?.settings.flight_alerts.low_fuel_fraction}
        />
      </div>
      <WhatsNewOnUpdate />
    </div>
  );
}
