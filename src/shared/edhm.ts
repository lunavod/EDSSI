/** The main colour of the EDHM theme the game is using. */
export interface HudColor {
  /** `#rrggbb`, as the theme has it; the window keeps it readable (see `hud-color.ts`). */
  color: string;
  /** The theme's name, when it has one. */
  theme: string | undefined;
}

/** Where EDHM, and the FSS Exobio Overlay EDSSI installs into it, stand. */
export type FssOverlayStatus =
  | {
      state: 'no-edhm';
      /** Why no game with EDHM could be found. */
      message: string;
    }
  | {
      state: 'ready';
      gameDir: string;
      /** The FSS Exobio Overlay is in `3rdPartyMods`, so the game loads it. */
      installed: boolean;
      /** The FSS-Overlay mod's shaders are in `ShaderFixes`; if not, installing downloads them. */
      shaders: boolean;
      /** Other mods in `3rdPartyMods` hooking the same shaders, which installing parks. */
      conflicts: string[];
    };

export interface FssOverlayInstallResult {
  status: FssOverlayStatus;
  /** Whether the FSS-Overlay mod had to be downloaded for its shaders. */
  downloaded: boolean;
  /** The mods moved to `3rdPartyMods-disabled`. */
  parked: string[];
}
