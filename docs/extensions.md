# Extensions

An extension is a feature built into EDSSI from outside this repository. Each is a folder in
`extensions/`, which git ignores, so a build without one has none of it: no pages, no settings, no
code. A build picks up whatever is there when it is made, and any build loads the extensions
installed beside its settings (see [Installed extensions](#installed-extensions)).

## Layout

```
extensions/<name>/
  main/index.ts        exports `extension: MainExtension`       (src/main/extensions.ts)
  renderer/index.tsx   exports `extension: RendererExtension`   (src/renderer/src/extensions.ts)
  shared/              whatever both sides share
  build.json           optional: { "mainEntries": { "<output name>": "<path in the folder>" } }
```

Either side may be left out. Both are found with `import.meta.glob`, so an extension is compiled into
EDSSI's own bundles; `build.json` adds main-process entries of its own (utility processes, worker
threads), built beside `index.js` under their output names.

An extension imports EDSSI's code by relative path (`../../../src/shared/csv-route`) and its
dependencies from EDSSI's `node_modules`. `npm run check` typechecks, lints, formats and tests it
with the rest, as long as the folder is a git repository of its own; otherwise EDSSI's `.gitignore`
hides it from oxlint and oxfmt.

## Installed extensions

The same folder can instead be built on its own and installed, so that any build of EDSSI, a
release included, has it without it ever being compiled in:

```
npm run build:extension -- <name or folder> [--out <folder>] [--install]
```

`scripts/build-extension.ts` writes `main.js` (with the `build.json` entries beside it),
`renderer.js`, `renderer.css` and an `extension.json` manifest into `out/extensions/<name>/`;
`--install` copies them to `<config dir>/extensions/<name>/` (`~/.edssi`, or `EDSSI_CONFIG_DIR`).
EDSSI loads every folder there at start, after the app is ready and before the settings file is
read (`loadInstalledExtensions` in `src/main/extensions.ts`), and the window loads their window
sides before the app's modules (`main.tsx`), over the `edssi-ext://<name>/` scheme. One compiled in
under the same name wins. Restart EDSSI to pick up a new build.

EDSSI's own code that an extension imports is bundled into it, a copy of it as it was when built.
What has to be EDSSI's copy is not bundled (`src/shared/extensions.ts`):

- **React and zod** (`SHARED_MAIN_MODULES`, `SHARED_RENDERER_MODULES`): each import is a stand-in
  for the running EDSSI's module, put on `globalThis.__edssiExtensionHost`. Hooks only work with
  the React that renders them, and settings schemas are merged into EDSSI's own.
- **Native modules** (`HOST_NATIVE_MODULES`): `require`d from EDSSI's folder, named by
  `EDSSI_APP_PATH`, which utility processes and worker threads inherit.
- **`electron` and `node:` builtins** stay plain imports.

So a module EDSSI keeps state in, a React context or a class checked with `instanceof` won't work
across the line; give the extension what it needs through its context instead.

`extension.json` carries `EXTENSION_API_VERSION`, and EDSSI leaves out an extension built for
another, saying so in the log. Bump it whenever the contexts, the extension types or the shared
modules change in a way an extension built before would trip over.

## What an extension can add

- **Settings.** `settings` on both sides: sections of `config.yaml` by key, each with a zod schema
  built from `settingTypes` in `src/shared/settings.ts`. The main side parses them with the rest of
  the file, so `extensionSettings(settings.current(), key, schema)` reads one; the window's side
  gives the Settings tab their defaults. `settingsSections` puts a section of fields at the end of
  one of the tab's pages. A section left in the file by a build without the extension is ignored.
- **Route tab pages.** `useRoutePages`, a hook called on every render of the tab: pages put before
  the Map page, and a route for the Map page to show beside the CSV route.
- **Assistant tools.** `context.addToolset` while starting.
- **Finding systems.** `context.addSystemLocator`: asked where a CSV route's systems are and what
  their stars are, before EDSM.
- **The commander.** `context.here()` is the current system, `context.ship()` the ship being
  flown: its last `Loadout` and the tonnes in its hold, from the session's journal, so it is there
  with the game closed too. `context.ships()` lists every ship the commander owns, with the Ships
  tab's names and each one's last `Loadout`.
- **Following a route.** `context.followRoute` makes a route the CSV route, as if loaded from a file.
- **Saving a route.** `context.saveRoute` puts a route among the CSV route page's saved routes
  under a name, without following it. It answers the route's `savedId`; followed with that on it,
  the route is taken up as the saved one. The window names it with `RouteNameForm`
  (`hud/SavedRoutes.tsx`).
- **Telling the commander.** `context.notify`: spoken, or written in Comms when speech is off.
- **IPC.** `context.handle` and `context.broadcast` in main, `window.edssi.extensions.invoke` and
  `.on` in a window. Channels are prefixed with `ext:`, so they can't collide with EDSSI's own.

A new kind of extension point goes in those two files, named for what it offers rather than for
the extension that wanted it.
