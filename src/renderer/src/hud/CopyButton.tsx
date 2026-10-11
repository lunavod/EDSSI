import { useEffect, useRef, useState } from 'react';

import { useEdssi } from '../api/context';
import { useInVr } from '../vr/in-vr';
import { Icon } from './Icon';
import { ICONS } from './icons';

/** How long the tick stays up after a copy. */
const COPIED_MS = 1200;

/**
 * Copies one thing — a system name, usually — to the clipboard, so it can be pasted into the
 * galaxy map's search. It goes through the main process: the window is sandboxed and served from a
 * file, so `navigator.clipboard` isn't there.
 *
 * Not drawn on a VR panel: there is no pointer to press it with, and the assistant's `copy_text`
 * is how a name gets onto the clipboard from inside a headset.
 */
export function CopyButton({
  text,
  label = text,
  large = false,
}: {
  text: string;
  label?: string;
  /** Beside a title rather than a line of text. */
  large?: boolean;
}) {
  const edssi = useEdssi();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  if (useInVr()) return null;
  return (
    <button
      type="button"
      className={large ? 'copy' : 'copy sm'}
      title={`Copy ${label}`}
      aria-label={`Copy ${label}`}
      data-copied={copied || undefined}
      onClick={(event) => {
        // Rows that are themselves clickable (an expandable journal entry) shouldn't also fire.
        event.stopPropagation();
        void edssi.clipboard.writeText(text);
        setCopied(true);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), COPIED_MS);
      }}
    >
      <Icon src={copied ? ICONS.tick : ICONS.copy} />
    </button>
  );
}
