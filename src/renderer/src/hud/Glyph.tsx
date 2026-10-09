import type { ReactNode } from 'react';

/**
 * The HUD's line icons, drawn inline in the current text colour on a 24-unit grid. The game's own
 * pictograms (orrery, planet, marker…) are masked SVG files instead; see Icon.
 */
const GLYPHS = {
  minimize: <path d="M5 12h14" />,
  maximize: <rect x="5" y="5" width="14" height="14" />,
  restore: <path d="M5 9h10v10H5zM9 9V5h10v10h-4" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  back: <path d="M15 5l-7 7 7 7" />,
  forward: <path d="M9 5l7 7-7 7" />,
  chevronDown: <path d="M5 9l7 7 7-7" />,
  reload: (
    <>
      <path d="M19 12a7 7 0 1 1-2.1-5" />
      <path d="M19 4v5h-5" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18" />
    </>
  ),
  warning: (
    <>
      <path d="M12 3 2 20h20z" />
      <path d="M12 10v4M12 16.5v1" />
    </>
  ),
  fuel: (
    <>
      <path d="M5 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16M3 21h14M15 9h2a2 2 0 0 1 2 2v6a1.5 1.5 0 0 0 3 0V8l-3-3" />
      <path d="M8 7h4" />
    </>
  ),
  cargo: <path strokeLinejoin="round" d="M3 7l9-4 9 4v10l-9 4-9-4zM3 7l9 4 9-4M12 11v10" />,
  station: (
    <>
      <path d="M12 2.5 21.5 12 12 21.5 2.5 12z" />
      <path d="M9 11h6v2H9z" fill="currentColor" stroke="none" />
    </>
  ),
  check: <path d="M4 12.5l5 5L20 6.5" />,
  pin: <path d="M9 3h6l-1 6 4 4H6l4-4zM12 13v8" />,
  plus: <path d="M12 5v14M5 12h14" />,
  file: <path d="M6 3h8l4 4v14H6zM14 3v4h4" />,
  image: (
    <>
      <rect x="3" y="5" width="18" height="14" />
      <path d="M3 16l5-5 4 4 3-3 6 6" />
    </>
  ),
  route: (
    <>
      <circle cx="5" cy="18" r="2" />
      <circle cx="19" cy="6" r="2" />
      <path d="M7 18h7a3 3 0 0 0 0-6h-4a3 3 0 0 1 0-6h7" />
    </>
  ),
  target: (
    <>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="3" />
      <path d="M12 1v4M12 19v4M1 12h4M19 12h4" />
    </>
  ),
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="M15.5 15.5 21 21" />
    </>
  ),
  tool: (
    <>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1" />
    </>
  ),
  mic: (
    <>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
    </>
  ),
  send: <path d="M4 12h14M13 6l6 6-6 6" />,
  star: (
    <path
      d="M12 3.5l2.6 5.6 6.1.6-4.6 4.1 1.3 6L12 16.7l-5.4 3.1 1.3-6-4.6-4.1 6.1-.6z"
      strokeLinejoin="miter"
      strokeWidth={1.6}
    />
  ),
  starFilled: (
    <path
      d="M12 2.5l2.9 6.3 6.9.7-5.2 4.6 1.5 6.8L12 17.4l-6.1 3.5 1.5-6.8L2.2 9.5l6.9-.7z"
      fill="currentColor"
      stroke="none"
    />
  ),
  upload: <path d="M12 16V4M6 10l6-6 6 6M4 20h16" />,
  map: (
    <>
      <path d="M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3z" />
      <path d="M9 3v15M15 6v15" />
    </>
  ),
  swap: <path d="M7 4v14M4 15l3 3 3-3M17 20V6M14 9l3-3 3 3" />,
  play: <path d="M7 4l13 8-13 8z" fill="currentColor" stroke="none" />,
  stop: <rect x="6" y="6" width="12" height="12" fill="currentColor" stroke="none" />,
  joystick: (
    <>
      <path d="M12 3v9" />
      <circle cx="12" cy="3.5" r="1.8" />
      <path d="M6 16h12l1.5 5h-15z" />
      <path d="M9 12h6v4H9z" />
    </>
  ),
  scoop: (
    <>
      <path d="M4 14a8 8 0 0 0 16 0z" />
      <path d="M12 3v7M9 7l3 3 3-3" />
    </>
  ),
  // Solid, with a hole for the axle, so it reads as a block of colour like a tab.
  gear: (
    <path
      fill="currentColor"
      fillRule="evenodd"
      stroke="none"
      d="M19.3 13.0 21.8 14.2 20.5 17.3 17.9 16.5 16.5 17.9 17.3 20.5 14.2 21.8 13.0 19.3 11.0 19.3 9.8 21.8 6.7 20.5 7.5 17.9 6.1 16.5 3.5 17.3 2.2 14.2 4.7 13.0 4.7 11.0 2.2 9.8 3.5 6.7 6.1 7.5 7.5 6.1 6.7 3.5 9.8 2.2 11.0 4.7 13.0 4.7 14.2 2.2 17.3 3.5 16.5 6.1 17.9 7.5 20.5 6.7 21.8 9.8 19.3 11.0z M15 12a3 3 0 1 0-6 0 3 3 0 1 0 6 0z"
    />
  ),
  trash: <path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13" />,
} satisfies Record<string, ReactNode>;

export type GlyphName = keyof typeof GLYPHS;

/** One line icon; sized by its box (`.ic-w`, or a button's own padding). */
export function Glyph({ name, className }: { name: GlyphName; className?: string }) {
  return (
    <svg
      className={className ? `glyph ${className}` : 'glyph'}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      {GLYPHS[name]}
    </svg>
  );
}
