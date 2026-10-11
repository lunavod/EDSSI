import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { EdssiProvider } from './api/EdssiProvider';
import { loadInstalledExtensions } from './extensions';

import '@fontsource/saira/400.css';
import '@fontsource/saira/500.css';
import '@fontsource/saira-condensed/400.css';
import '@fontsource/saira-condensed/500.css';
import '@fontsource/saira-condensed/600.css';
import '@fontsource/saira-semi-condensed/400.css';
import '@fontsource/saira-semi-condensed/500.css';
import '@fontsource/saira-semi-condensed/600.css';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('#root element missing');

/**
 * The same bundle serves the window and every panel of the VR cockpit; `#vr/<id>` asks for one
 * panel. The class is what `styles.css` hangs the see-through page and the larger type on — a
 * panel is read at arm's length through a lens, not on a monitor.
 */
const panel = window.location.hash.startsWith('#vr/') ? window.location.hash.slice(4) : undefined;
if (panel !== undefined) document.documentElement.classList.add('vr');

// The app is imported only once the installed extensions are in: its modules read the list of
// extensions as they load (the Settings tab's pages, the Route tab's).
// The only reader of `window.edssi`: everything below asks the provider (see `api/context.ts`).
const api = window.edssi;
void loadInstalledExtensions(api)
  .then(() => Promise.all([import('./App'), import('./vr/VrPanel')]))
  .then(([{ App }, { isVrPanel, VrPanel }]) => {
    createRoot(root).render(
      <StrictMode>
        <EdssiProvider api={api}>
          {panel !== undefined && isVrPanel(panel) ? <VrPanel panel={panel} /> : <App />}
        </EdssiProvider>
      </StrictMode>,
    );
  });
