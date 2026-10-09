import { describe, expect, it } from 'vitest';

import {
  bindingKey,
  bindingLabel,
  bindingMatchesDevice,
  type ButtonBinding,
  buttonNumber,
  type InputDevice,
} from './input';

const button: ButtonBinding = {
  kind: 'button',
  vendorId: 0x231d,
  productId: 0x0200,
  product: 'VKBsim Gladiator EVO R',
  reportId: 1,
  byte: 4,
  bit: 3,
};

const device: InputDevice = {
  vendorId: 0x231d,
  productId: 0x0200,
  product: 'VKBsim Gladiator EVO R',
  connected: true,
};

describe('bindingKey', () => {
  it('is the same for the same input and different for a different one', () => {
    expect(bindingKey(button)).toBe(bindingKey({ ...button }));
    expect(bindingKey(button)).not.toBe(bindingKey({ ...button, bit: 4 }));
    // The right stick and the left one are different devices.
    expect(bindingKey(button)).not.toBe(bindingKey({ ...button, productId: 0x0201 }));
  });

  it('ignores how a key chord happens to be capitalised', () => {
    expect(bindingKey({ kind: 'key', accelerator: 'Control+Alt+Space' })).toBe(
      bindingKey({ kind: 'key', accelerator: 'control+alt+space' }),
    );
  });
});

describe('bindingLabel', () => {
  it('names the stick and the button', () => {
    expect(bindingLabel(button)).toBe('VKBsim Gladiator EVO R · button 35');
    expect(buttonNumber(button)).toBe(35);
  });

  it('falls back to the ids when the stick gave no name', () => {
    expect(bindingLabel({ ...button, product: undefined })).toBe('231d:0200 · button 35');
  });

  it('writes a key chord as it stands', () => {
    expect(bindingLabel({ kind: 'key', accelerator: 'Control+Alt+Space' })).toBe(
      'Control+Alt+Space',
    );
  });
});

describe('bindingMatchesDevice', () => {
  it('matches the same model whatever port it was plugged into', () => {
    expect(bindingMatchesDevice(button, device)).toBe(true);
  });

  it('does not match the other stick', () => {
    expect(bindingMatchesDevice(button, { ...device, productId: 0x0201 })).toBe(false);
  });

  it('tells two identical sticks apart only when both report a serial', () => {
    const bound = { ...button, serial: 'A' };
    expect(bindingMatchesDevice(bound, { ...device, serial: 'B' })).toBe(false);
    expect(bindingMatchesDevice(bound, { ...device, serial: 'A' })).toBe(true);
    // VKB's sticks report none, so a binding made on one still works after a replug.
    expect(bindingMatchesDevice(bound, device)).toBe(true);
  });
});
