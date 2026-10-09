/**
 * Writes settings back to `~/.edssi/config.yaml`.
 *
 * The file is meant to be edited by hand as well as from the settings screen, so it is changed
 * rather than rewritten: the document is parsed with its comments and layout intact, only the
 * fields that were given are set, and everything else — including the commander's own notes — is
 * left exactly where it was.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { isMap, parseDocument, type Document } from 'yaml';

import type { BoundAction, InputBinding } from '../../shared/input';
import { actionToConfig, bindingToConfig, type SettingsPatch } from '../../shared/settings';

/** Fields written as a list of bindings rather than a plain value. */
const BINDING_PATHS = new Set(['voice.push_to_talk']);

/**
 * Fields written as a list of bindings and how each is pressed: `input.paste`, and one per cockpit
 * command, where the path is `vr.bindings.<command>` and the command is whatever is being bound.
 */
function isActionPath(path: readonly string[]): boolean {
  if (path.join('.') === 'input.paste') return true;
  return path.length === 3 && path[0] === 'vr' && path[1] === 'bindings';
}

/**
 * Applies `patch` to the file at `path`. A field set to null is removed, so it goes back to its
 * default rather than being pinned to whatever null happens to mean.
 */
export function saveSettings(path: string, patch: SettingsPatch): void {
  const document = read(path);
  apply(document, patch, []);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, document.toString(), 'utf8');
}

function read(path: string): Document.Parsed {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    // No file yet, or one EDSSI can't read: start from an empty document rather than fail.
    text = '';
  }
  const document = parseDocument(text);
  // A file that isn't a mapping (empty, or broken) can't be patched in place; start again.
  return document.errors.length > 0 || !isMap(document.contents) ? parseDocument('{}\n') : document;
}

function apply(document: Document.Parsed, patch: object, path: string[]): void {
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    const here = [...path, key];

    if (value === null) {
      document.deleteIn(here);
      continue;
    }
    if (isActionPath(here)) {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- guarded by SettingsPatch
      const actions = value as BoundAction[];
      document.setIn(here, actions.map(actionToConfig));
      continue;
    }
    if (BINDING_PATHS.has(here.join('.'))) {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- guarded by SettingsPatch
      const bindings = value as InputBinding[];
      document.setIn(here, bindings.map(bindingToConfig));
      continue;
    }
    if (Array.isArray(value)) {
      document.setIn(here, value);
      continue;
    }
    if (typeof value === 'object') {
      apply(document, value, here);
      continue;
    }
    document.setIn(here, value);
  }
}
