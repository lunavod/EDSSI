/**
 * What the commander pasted as a ship build, as JSON: an export as it is (SLEF, a `Loadout`,
 * Coriolis' detailed build), or an EDSY or Coriolis import link carrying a gzipped `Loadout` the
 * way EDMC (and EDSSI's Ships tab) makes them.
 */
import { gunzipSync } from 'node:zlib';

/** Said instead of trying: links whose build is in the site's own code, not a `Loadout`. */
const OWN_CODE =
  "That link holds the site's own build code, which EDSSI can't read. Use its Export " +
  'button instead and copy the SLEF text.';

export function buildJson(pasted: string): unknown {
  const text = pasted.trim();
  if (text === '') throw new Error('Paste a build first.');
  if (/^https?:\/\//i.test(text)) return linkJson(text);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("That isn't a build export: paste EDSY's or Coriolis' SLEF text, or a link.");
  }
}

function linkJson(link: string): unknown {
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    throw new Error("That link couldn't be read.");
  }
  // EDSY: `#/I=<data>` imports; `#/L=` is its own build code. Coriolis: `/import?data=`; `/outfit/`
  // is its own.
  const data =
    /[#&/]I=([^&]+)/.exec(url.hash)?.[1] ??
    (url.pathname.startsWith('/import') ? url.searchParams.get('data') : null);
  if (!data) throw new Error(OWN_CODE);
  try {
    const bytes = Buffer.from(decodeURIComponent(data), 'base64url');
    return JSON.parse(gunzipSync(bytes).toString('utf8'));
  } catch {
    throw new Error("The build in that link couldn't be read.");
  }
}
