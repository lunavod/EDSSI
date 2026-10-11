import { useEffect, useState } from 'react';

import { useEdssi } from '../api/context';
import { Glyph } from './Glyph';

/** The frameless window's minimize, maximize/restore and close buttons. */
export function WindowControls() {
  const edssi = useEdssi();
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    const stop = edssi.window.onMaximizedChange(setMaximized);
    void edssi.window.isMaximized().then(setMaximized);
    return stop;
  }, [edssi]);

  return (
    <div className="winctl">
      <button
        type="button"
        className="winbtn"
        aria-label="Minimize"
        onClick={() => void edssi.window.minimize()}
      >
        <Glyph name="minimize" />
      </button>
      <button
        type="button"
        className="winbtn"
        aria-label={maximized ? 'Restore' : 'Maximize'}
        onClick={() => void edssi.window.toggleMaximize()}
      >
        <Glyph name={maximized ? 'restore' : 'maximize'} />
      </button>
      <button
        type="button"
        className="winbtn close"
        aria-label="Close"
        onClick={() => void edssi.window.close()}
      >
        <Glyph name="close" />
      </button>
    </div>
  );
}
