import { type CSSProperties, useCallback, useLayoutEffect, useMemo, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { EdssiProvider, memoryStorage } from '../renderer/src/api/EdssiProvider';
import { App } from '../renderer/src/App';
import type { TabId } from '../shared/ui';
import { MockEdssi } from './mock-edssi';
import type { MockScenario } from './scenario';

// The app's stylesheets as text, for each instance's shadow root (scoped to its root in mock
// builds: scripts/mock/vite-plugins.ts).
import appStyles from '../renderer/src/styles.css?inline';
import mockStyles from './mock.css?inline';

export interface MockAppProps {
  /** What this EDSSI shows. Another scenario is another EDSSI, started afresh. */
  scenario: MockScenario;
  /** The module it opens on. Default: Mission. */
  tab?: TabId;
  className?: string;
  style?: CSSProperties;
}

/**
 * One EDSSI window, drawn by the app's own components against `scenario`. It fills its container
 * (the app is laid out for a 1446 px wide window) and shares nothing with the page or any other
 * EDSSI on it.
 *
 * It lives in a shadow root, with a React root of its own inside it: the page's stylesheets can't
 * reach in (a page's `h2 { margin: 72px 0 }` once did), the app's can't reach out, and React's
 * events are listened for inside the shadow tree, where their targets aren't retargeted to the host.
 * Everything it draws — popups, dialogs, its HUD colour — stays inside.
 */
export function MockApp({ scenario, tab, className, style }: MockAppProps) {
  const host = useRef<HTMLDivElement>(null);
  const root = useRef<Root>(undefined);

  useLayoutEffect(() => {
    const element = host.current;
    if (!element) return undefined;
    const shadow = element.shadowRoot ?? element.attachShadow({ mode: 'open' });
    const sheet = document.createElement('style');
    sheet.textContent = `${appStyles}\n${mockStyles}`;
    const container = document.createElement('div');
    container.className = 'edssi-shell';
    shadow.replaceChildren(sheet, container);
    const created = createRoot(container);
    root.current = created;
    return () => {
      root.current = undefined;
      // Not while this root is still committing.
      setTimeout(() => created.unmount());
    };
  }, []);

  useLayoutEffect(() => {
    root.current?.render(<MockRoot key={tab} scenario={scenario} tab={tab} />);
  }, [scenario, tab]);

  return (
    <div ref={host} className={className} style={{ width: '100%', height: '100%', ...style }} />
  );
}

/** Gives each scenario its own instance; a new one remounts everything under it. */
let instances = 0;

function MockRoot({ scenario, tab }: { scenario: MockScenario; tab: TabId | undefined }) {
  const root = useRef<HTMLDivElement>(null);
  const { api, storage, key } = useMemo(
    () => ({ api: new MockEdssi(scenario), storage: memoryStorage(), key: ++instances }),
    [scenario],
  );
  // Read when used, by which time the root is mounted; the document's is only a fallback.
  const themeRoot = useCallback(() => root.current ?? document.documentElement, []);
  return (
    // `edssi-theme` carries the design tokens and the HUD colour; the frame keeps `fixed` inside.
    <div ref={root} className="edssi-theme edssi-mock" data-fixed-frame>
      <EdssiProvider
        key={key}
        api={api}
        themeRoot={themeRoot}
        modalDialogs={false}
        localDevices={false}
        storage={storage}
      >
        <App initialTab={tab} />
      </EdssiProvider>
    </div>
  );
}
