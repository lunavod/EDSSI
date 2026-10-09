import { describe, expect, it, vi } from 'vitest';

import type { BoundAction, InputBinding } from '../../shared/input';
import { parseSettings, type Settings } from '../../shared/settings';
import { startPasteBinding } from './paste';
import type { InputAction } from './service';

const BUTTON: InputBinding = {
  kind: 'button',
  vendorId: 0x231d,
  productId: 0x0200,
  product: 'VKBsim Gladiator EVO R',
  reportId: 1,
  byte: 4,
  bit: 3,
};

function withPaste(paste: BoundAction[]): Settings {
  const { settings } = parseSettings({});
  return { ...settings, input: { ...settings.input, paste } };
}

function setup(paste: BoundAction[]) {
  let current = withPaste(paste);
  let listener: ((settings: Settings) => void) | undefined;
  const bound: Record<string, InputAction>[] = [];
  const unbind = vi.fn();
  const input = {
    actions: vi.fn((actions: Readonly<Record<string, InputAction>>) => {
      bound.push({ ...actions });
      return unbind;
    }),
    tap: vi.fn(async () => {}),
  };
  const service = startPasteBinding({
    input,
    settings: {
      current: () => current,
      onChange(given) {
        listener = given;
        return () => (listener = undefined);
      },
    },
  });
  return {
    input,
    bound,
    unbind,
    service,
    save: (next: BoundAction[]) => {
      current = withPaste(next);
      listener?.(current);
    },
  };
}

describe('startPasteBinding', () => {
  it('presses Ctrl+V when a bound control runs', () => {
    const { input, bound } = setup([{ binding: BUTTON }]);
    const paste = bound[0]!['paste']!;
    expect(paste.bindings).toEqual([{ binding: BUTTON, repeat: false }]);
    paste.run(1);
    expect(input.tap).toHaveBeenCalledWith('Control+V');
  });

  it('leaves out Ctrl+V itself, which would paste for ever', () => {
    const { bound } = setup([
      { binding: { kind: 'key', accelerator: 'Ctrl+V' } },
      { binding: BUTTON },
    ]);
    expect(bound[0]!['paste']!.bindings).toEqual([{ binding: BUTTON, repeat: false }]);
  });

  it('keeps how many presses a binding asks for, and never repeats', () => {
    const { bound } = setup([{ binding: BUTTON, clicks: 2, repeat: true }]);
    expect(bound[0]!['paste']!.bindings).toEqual([{ binding: BUTTON, clicks: 2, repeat: false }]);
  });

  it('binds afresh when the bindings are saved, and only then', () => {
    const { bound, unbind, save } = setup([]);
    save([]);
    expect(bound).toHaveLength(1);
    save([{ binding: BUTTON, clicks: 3 }]);
    expect(unbind).toHaveBeenCalledOnce();
    expect(bound).toHaveLength(2);
    expect(bound[1]!['paste']!.bindings).toEqual([{ binding: BUTTON, clicks: 3, repeat: false }]);
  });

  it('unbinds on stop', () => {
    const { unbind, service } = setup([{ binding: BUTTON }]);
    service.stop();
    expect(unbind).toHaveBeenCalledOnce();
  });
});
