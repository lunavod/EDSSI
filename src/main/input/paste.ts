/**
 * `input.paste`: a stick button that presses Ctrl+V in the game.
 *
 * Following a route, EDSSI puts the next system on the clipboard after every jump, and the
 * galaxy map's search takes a paste — but the commander's hands are on the stick and throttle, and
 * Ctrl+V is a reach for the keyboard every jump. This puts it under a thumb.
 */

import type { BoundAction, InputBinding } from '../../shared/input';
import type { Settings } from '../../shared/settings';
import { parseAccelerator } from './keyboard';
import type { InputService } from './service';

const PASTE = 'Control+V';

interface PasteBindingOptions {
  input: Pick<InputService, 'actions' | 'tap'>;
  settings: {
    current(): Settings;
    onChange(listener: (settings: Settings) => void): () => void;
  };
}

export function startPasteBinding(options: PasteBindingOptions): { stop(): void } {
  const { input, settings } = options;
  let bound = settings.current().input.paste;

  function bind(list: readonly BoundAction[]): () => void {
    return input.actions({
      paste: {
        // Once per press, whatever the file says: a paste held down would fill the search box.
        bindings: list
          .filter((action) => !isPaste(action.binding))
          .map((action) => ({ ...action, repeat: false })),
        run() {
          input
            .tap(PASTE)
            .catch((error: unknown) => console.error('[input] could not paste', error));
        },
      },
    });
  }

  let unbind = bind(bound);
  const unwatch = settings.onChange((next) => {
    if (JSON.stringify(next.input.paste) === JSON.stringify(bound)) return;
    bound = next.input.paste;
    unbind();
    unbind = bind(bound);
  });

  return {
    stop() {
      unwatch();
      unbind();
    },
  };
}

/**
 * Ctrl+V bound to paste would see its own keystroke and paste again, for ever. It already pastes
 * without EDSSI's help, so it is simply left out.
 */
function isPaste(binding: InputBinding): boolean {
  if (binding.kind !== 'key') return false;
  const chord = parseAccelerator(binding.accelerator);
  const paste = parseAccelerator(PASTE);
  return (
    chord !== undefined &&
    paste !== undefined &&
    chord.keycode === paste.keycode &&
    chord.modifiers.join('+') === paste.modifiers.join('+')
  );
}
