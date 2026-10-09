import { describe, expect, it } from 'vitest';

import { hudColorFromTheme } from './theme';

/** An ARGB integer the way EDHM-UI writes it: signed, alpha in the top byte. */
const argb = (hex: string) => Number.parseInt(`ff${hex.slice(1)}`, 16) | 0;

const color = (title: string, hex: string) => ({
  Title: title,
  ValueType: 'Color',
  Value: argb(hex),
});
const mode = (title: string, value: number) => ({
  Title: title,
  ValueType: 'Preset',
  Type: 'AdvancedMode',
  Value: value,
});

describe('hudColorFromTheme', () => {
  it('takes the colour most elements use, with the theme’s name', () => {
    const theme = {
      credits: { theme: 'RAPTOR', author: 'Misfit' },
      ui_groups: [
        {
          Name: 'Panel_UP',
          Elements: [
            mode('Chat Panel Lines Mode', 100),
            color('Chat Panel Lines Color', '#83ffe3'),
            color('Info Panel Lines Color', '#83ffe3'),
          ],
        },
        { Name: 'Reticle', Elements: [color('Destination Target Circle', '#c0ffc0')] },
        { Name: 'Settings', Elements: [color('Ship Name Color', '#83ffe3')] },
      ],
    };
    expect(hudColorFromTheme(theme)).toEqual({ color: '#83ffe3', theme: 'RAPTOR' });
  });

  it('skips colours the game isn’t drawing, and greys', () => {
    const theme = {
      ui_groups: [
        {
          Elements: [
            mode('Chat Panel Lines Mode', 200),
            color('Chat Panel Lines Color', '#ff00ff'),
            mode('Info Panel Lines Mode', 199),
            color('Info Panel Lines Color', '#ff00ff'),
            color('Orbit Lines Color', '#bfbfbf'),
            color('Galnet Background Color', '#bfbfbf'),
            color('Space Dust Color', '#ffffff'),
            color('Shadow Color', '#101820'),
            color('Radar Color', '#ff8080'),
          ],
        },
      ],
    };
    expect(hudColorFromTheme(theme)).toEqual({ color: '#ff8080', theme: undefined });
  });

  it('breaks a tie in favour of the element listed first', () => {
    const theme = {
      ui_groups: [{ Elements: [color('A Color', '#3060ff'), color('B Color', '#ff8000')] }],
    };
    expect(hudColorFromTheme(theme)?.color).toBe('#3060ff');
  });

  it('has nothing to say about a theme without custom colours, or a broken file', () => {
    expect(hudColorFromTheme({ ui_groups: [{ Elements: [color('Dust', '#808080')] }] })).toBe(
      undefined,
    );
    expect(hudColorFromTheme(null)).toBeUndefined();
    expect(hudColorFromTheme({ ui_groups: 'nope' })).toBeUndefined();
    expect(
      hudColorFromTheme({ ui_groups: [{ Elements: [null, { Value: 'x' }] }] }),
    ).toBeUndefined();
  });
});
