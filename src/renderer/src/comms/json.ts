/**
 * JSON laid out and coloured for the transcript's tool calls. It works on the text's own tokens
 * rather than parsing it, so a 64-bit id or a long decimal is shown exactly as the model saw it.
 */

export type JsonTokenKind = 'key' | 'string' | 'number' | 'literal' | 'punct' | 'space';

export interface JsonToken {
  kind: JsonTokenKind;
  text: string;
}

const TOKEN =
  /\s+|"(?:[^"\\]|\\.)*"|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null|[{}[\],:]/y;

const INDENT = '  ';

/**
 * The text as tokens, indented two spaces a level, or undefined when it isn't a JSON object or
 * array (a tool that answered in words).
 */
export function formatJson(text: string): JsonToken[] | undefined {
  const raw = tokenize(text.trim());
  if (!raw || raw.length === 0 || (raw[0]!.text !== '{' && raw[0]!.text !== '[')) {
    return undefined;
  }

  const tokens: JsonToken[] = [];
  const closers: string[] = [];
  const newline = (depth: number) =>
    tokens.push({ kind: 'space', text: `\n${INDENT.repeat(depth)}` });

  for (const [index, token] of raw.entries()) {
    const next = raw[index + 1];
    switch (token.text) {
      case '{':
      case '[': {
        closers.push(token.text === '{' ? '}' : ']');
        tokens.push(token);
        if (next && next.text !== closers.at(-1)) newline(closers.length);
        break;
      }
      case '}':
      case ']': {
        if (closers.pop() !== token.text) return undefined;
        const previous = raw[index - 1];
        if (previous && previous.text !== '{' && previous.text !== '[') newline(closers.length);
        tokens.push(token);
        break;
      }
      case ',':
        tokens.push(token);
        newline(closers.length);
        break;
      case ':':
        tokens.push(token, { kind: 'space', text: ' ' });
        break;
      default:
        tokens.push(
          token.kind === 'string' && next?.text === ':' ? { kind: 'key', text: token.text } : token,
        );
    }
    // Anything after the outermost value closes means this wasn't one JSON document.
    if (closers.length === 0 && index < raw.length - 1) return undefined;
  }
  return closers.length === 0 ? tokens : undefined;
}

/** The significant tokens, or undefined at the first character JSON can't have. */
function tokenize(text: string): JsonToken[] | undefined {
  const tokens: JsonToken[] = [];
  TOKEN.lastIndex = 0;
  while (TOKEN.lastIndex < text.length) {
    const start = TOKEN.lastIndex;
    const match = TOKEN.exec(text);
    if (!match || match.index !== start) return undefined;
    const value = match[0];
    if (/^\s/.test(value)) continue;
    tokens.push({ kind: kindOf(value), text: value });
  }
  return tokens;
}

function kindOf(value: string): JsonTokenKind {
  if (value.startsWith('"')) return 'string';
  if (value === 'true' || value === 'false' || value === 'null') return 'literal';
  if (/^[{}[\],:]$/.test(value)) return 'punct';
  return 'number';
}

/** A short one-line look at the arguments, for the closed line. */
export function preview(text: string | undefined, max = 90): string {
  if (!text) return '';
  const compact = text.replace(/\s+/g, ' ').trim();
  if (compact === '{}') return '';
  return compact.length > max ? `${compact.slice(0, max - 1)}…` : compact;
}
