import { useEffect, useState } from 'react';

import { Glyph } from './Glyph';

/** The frameless window's minimize, maximize/restore and close buttons. */
export function WindowControls() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    const stop = window.edssi.window.onMaximizedChange(setMaximized);
    void window.edssi.window.isMaximized().then(setMaximized);
    return stop;
  }, []);

  return (
    <div className="winctl">
      <button
        type="button"
        className="winbtn"
        aria-label="Minimize"
        onClick={() => void window.edssi.window.minimize()}
      >
        <Glyph name="minimize" />
      </button>
      <button
        type="button"
        className="winbtn"
        aria-label={maximized ? 'Restore' : 'Maximize'}
        onClick={() => void window.edssi.window.toggleMaximize()}
      >
        <Glyph name={maximized ? 'restore' : 'maximize'} />
      </button>
      <button
        type="button"
        className="winbtn close"
        aria-label="Close"
        onClick={() => void window.edssi.window.close()}
      >
        <Glyph name="close" />
      </button>
    </div>
  );
}
