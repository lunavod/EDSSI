import { useState } from 'react';

import type { CsvRouteState } from '../../../shared/csv-route';
import { activeRoute, nextJump, type PlottedRoute, positionOf } from '../../../shared/nav-routes';
import { useEdssi } from '../api/context';
import { RENDERER_EXTENSIONS, type RoutePages, type RoutePagesContext } from '../extensions';
import { CsvRouteActions, CsvRouteView } from './CsvRouteView';
import { Glyph } from './Glyph';
import { Icon } from './Icon';
import { ICONS } from './icons';
import { RouteMap } from './RouteMap';
import { RouteView } from './RouteView';
import { Tabs } from './Tabs';

/**
 * Every extension's pages, as one hook. The extensions are fixed before this module loads, so the
 * hooks inside are always called in the same order.
 */
const useExtensionPages = RENDERER_EXTENSIONS.reduce<(context: RoutePagesContext) => RoutePages[]>(
  (before, extension) => {
    const pages = extension.useRoutePages;
    return pages ? (context) => [...before(context), pages(context)] : before;
  },
  () => [],
);

/**
 * The Route module: the route plotted in the game, one loaded from a CSV file, the pages
 * extensions add, and a map of the CSV route in 3D.
 */
export function RouteTab({
  routes,
  csvRoute,
  systemAddress,
  system,
  fuel,
}: {
  routes: readonly PlottedRoute[];
  csvRoute: CsvRouteState | undefined;
  systemAddress: number | bigint | undefined;
  system: string | undefined;
  /** In the main tank now, t. */
  fuel: number | undefined;
}) {
  const edssi = useEdssi();
  const [tab, setTab] = useState('plotted');
  const extended = useExtensionPages({ csvRoute, here: system, fuel, active: tab, show: setTab });
  const extraPages = extended.flatMap((pages) => pages.pages);
  const [csvProblem, setCsvProblem] = useState<string>();
  const plotted = activeRoute(routes);
  const jumps = plotted?.systems ? plotted.systems.length - 1 : undefined;
  const position = plotted && positionOf(plotted, systemAddress);
  const next = nextJump(plotted, systemAddress);
  const csv = csvRoute?.route;
  return (
    <>
      <Tabs
        tabs={[
          {
            id: 'plotted',
            label: 'Plotted',
            badge:
              jumps === undefined
                ? undefined
                : position === undefined || position === 0
                  ? `${jumps} ${jumps === 1 ? 'jump' : 'jumps'}`
                  : `${position} / ${jumps}`,
          },
          {
            id: 'csv',
            label: 'CSV route',
            badge: csv ? `${csvRoute?.position ?? 0} / ${csv.systems.length - 1}` : undefined,
          },
          ...extraPages.map(({ id, label, badge }) => ({ id, label, badge })),
          { id: 'map', label: 'Map' },
        ]}
        active={tab}
        onSelect={setTab}
        sub
        ariaLabel="Route"
        actions={
          tab === 'plotted' ? (
            <>
              {next && (
                <button
                  type="button"
                  className="btn ghost sm"
                  title={`Copy ${next.system.StarSystem}, to paste into the galaxy map`}
                  onClick={() => void edssi.clipboard.writeText(next.system.StarSystem)}
                >
                  <span className="ic-w">
                    <Icon src={ICONS.copy} />
                  </span>
                  Copy next
                </button>
              )}
              <button type="button" className="btn ghost sm" onClick={() => setTab('map')}>
                <span className="ic-w">
                  <Glyph name="map" />
                </span>
                Map
              </button>
            </>
          ) : tab === 'csv' ? (
            <CsvRouteActions route={csv} onProblem={setCsvProblem} />
          ) : undefined
        }
      />
      {/* All stay mounted, so the CSV route keeps its scroll and other pages their forms. */}
      <div className="route-page" hidden={tab !== 'plotted'}>
        <RouteView routes={routes} systemAddress={systemAddress} />
      </div>
      <div className="route-page" hidden={tab !== 'csv'}>
        <CsvRouteView state={csvRoute} problem={csvProblem} onProblem={setCsvProblem} />
      </div>
      {extraPages.map((page) => (
        <div key={page.id} className="route-page" hidden={tab !== page.id}>
          {page.content}
        </div>
      ))}
      <div className="route-page" hidden={tab !== 'map'}>
        <RouteMap
          csvRoute={csvRoute}
          compare={extended.find((pages) => pages.mapRoute)?.mapRoute}
          shown={tab === 'map'}
        />
      </div>
    </>
  );
}
