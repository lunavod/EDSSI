# Extensions

An extension is a feature built into EDSSI from outside this repository. Each is a folder in
`extensions/`, which git ignores, so a build without one has none of it: no pages, no settings, no
code. A build picks up whatever is there when it is made.

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
