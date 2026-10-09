/**
 * A line of help with the web addresses in it made into links ("From platform.openai.com/api-keys"
 * opens that page). They open in the commander's own browser, as every https link from the window
 * does (the main window's open handler).
 */

/** A bare address: a host with a dot and a known ending, and an optional path. */
const ADDRESS = /\b(?:[a-z0-9-]+\.)+(?:ai|com|net|org|io|cz|gg)\b(?:\/[\w\-./~%?=&#]*)?/giu;

export interface HelpPart {
  text: string;
  /** Set on a part that is an address: where it goes. */
  href?: string;
}

/** The text cut into plain runs and addresses; a full stop ending a sentence stays outside. */
export function helpParts(text: string): HelpPart[] {
  const parts: HelpPart[] = [];
  let at = 0;
  for (const match of text.matchAll(ADDRESS)) {
    const address = match[0].replace(/[.,;:]+$/u, '');
    if (match.index > at) parts.push({ text: text.slice(at, match.index) });
    parts.push({ text: address, href: `https://${address}` });
    at = match.index + address.length;
  }
  if (at < text.length) parts.push({ text: text.slice(at) });
  return parts;
}

export function HelpText({ text }: { text: string }) {
  return (
    <>
      {helpParts(text).map((part, index) =>
        part.href ? (
          // oxlint-disable-next-line react/no-array-index-key -- the parts never move
          <a key={index} className="link" href={part.href} target="_blank" rel="noreferrer">
            {part.text}
          </a>
        ) : (
          // oxlint-disable-next-line react/no-array-index-key -- the parts never move
          <span key={index}>{part.text}</span>
        ),
      )}
    </>
  );
}
