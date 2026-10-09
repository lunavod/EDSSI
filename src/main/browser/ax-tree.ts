/**
 * Turns Chromium's accessibility tree (CDP `Accessibility.getFullAXTree`) into a short outline the
 * model can read: one line per thing a person would notice, indented by nesting, with a `ref` on
 * everything that can be clicked or typed into.
 *
 * The tree is much bigger than the page looks: layout wrappers, list items, ignored nodes, and one
 * text node per run of text. Wrappers with no name of their own are folded away, neighbouring
 * text is joined into one line, and a table row becomes one line with its cells split by `|`.
 */

/** The parts of a CDP `Accessibility.AXNode` this reads. */
export interface AxNode {
  nodeId: string;
  ignored?: boolean;
  role?: AxValue;
  name?: AxValue;
  value?: AxValue;
  properties?: { name: string; value: AxValue }[];
  childIds?: string[];
  parentId?: string;
  backendDOMNodeId?: number;
}

interface AxValue {
  value?: unknown;
}

/** What can be acted on, and so gets a ref. */
const INTERACTIVE = new Set([
  'button',
  'checkbox',
  'combobox',
  'link',
  'listbox',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'option',
  'radio',
  'searchbox',
  'slider',
  'spinbutton',
  'switch',
  'tab',
  'textbox',
  'treeitem',
]);

/** Worth a line even without a name: the page's landmarks, and what structures its text. */
const STRUCTURE = new Set([
  'alert',
  'alertdialog',
  'banner',
  'complementary',
  'contentinfo',
  'dialog',
  'heading',
  'main',
  'navigation',
  'row',
  'search',
  'table',
]);

const TEXT = new Set(['StaticText', 'text']);
const CELLS = new Set(['cell', 'gridcell', 'columnheader', 'rowheader']);
const SKIPPED = new Set(['InlineTextBox', 'LineBreak', 'ListMarker']);
/** Named after the page or frame, which the tools report anyway. */
const DOCUMENTS = new Set(['RootWebArea', 'WebArea', 'Iframe']);

/** States worth a word after a node's name. */
const FLAGS = ['checked', 'selected', 'expanded', 'pressed', 'disabled', 'required', 'focused'];

const MAX_NAME = 160;

/** The lines of one level of the outline, with text gathered up until something else comes. */
class Block {
  readonly lines: string[] = [];
  #text: string[] = [];

  constructor(readonly depth: number) {}

  text(fragment: string): void {
    this.#text.push(fragment);
  }

  /** Between table cells, so a row reads "Tier | Reward" rather than "Tier Reward". */
  separate(): void {
    if (this.#text.length > 0 && this.#text.at(-1) !== '|') this.#text.push('|');
  }

  line(text: string): void {
    this.flush();
    this.lines.push(`${'  '.repeat(this.depth)}${text}`);
  }

  append(lines: readonly string[]): void {
    this.flush();
    this.lines.push(...lines);
  }

  flush(): void {
    while (this.#text.at(-1) === '|') this.#text.pop();
    const joined = this.#text.join(' ').replaceAll(/\s+/gu, ' ').trim();
    this.#text = [];
    if (joined) this.lines.push(`${'  '.repeat(this.depth)}${joined}`);
  }
}

export function formatAxTree(nodes: readonly AxNode[]): string {
  const byId = new Map(nodes.map((node) => [node.nodeId, node]));
  const root = nodes.find((node) => !node.parentId || !byId.has(node.parentId));
  if (!root) return '';

  const seen = new Set<string>();
  const childrenOf = (node: AxNode): AxNode[] =>
    (node.childIds ?? [])
      .map((id) => byId.get(id))
      .filter((child): child is AxNode => child !== undefined);

  const visit = (node: AxNode, block: Block): void => {
    if (seen.has(node.nodeId)) return;
    seen.add(node.nodeId);
    const role = roleOf(node);
    const name = clean(node.name?.value);

    if (SKIPPED.has(role)) return;
    if (TEXT.has(role)) {
      if (name) block.text(name);
      return;
    }
    // An image with no description is decoration.
    if (isImage(role) && !name) return;

    const children = childrenOf(node);
    const interactive = INTERACTIVE.has(role);
    const cell = CELLS.has(role);
    const shown =
      !node.ignored &&
      !cell &&
      !DOCUMENTS.has(role) &&
      (interactive || Boolean(name) || STRUCTURE.has(role));
    if (!shown) {
      if (cell) block.separate();
      for (const child of children) visit(child, block);
      if (cell) block.separate();
      return;
    }

    // A link or heading whose only content is its own name has nothing more to say.
    if (children.every((child) => isOnlyText(child, byId, name))) {
      block.line(describe(node, role, name, interactive));
      return;
    }

    const inner = new Block(block.depth + 1);
    for (const child of children) visit(child, inner);
    inner.flush();

    if (role === 'row' && !name && inner.lines.length === 1) {
      // A row of plain cells is a line of its own.
      block.line(inner.lines[0]!.trim());
      return;
    }
    // A wrapper that turned out to hold nothing isn't worth a line.
    if (inner.lines.length === 0 && !name && !interactive) return;
    block.line(describe(node, role, name, interactive));
    block.append(inner.lines);
  };

  const top = new Block(0);
  visit(root, top);
  top.flush();
  return top.lines.join('\n');
}

function describe(node: AxNode, role: string, name: string, interactive: boolean): string {
  const parts = [role];
  if (name) parts.push(JSON.stringify(name));
  const properties = new Map(
    (node.properties ?? []).map((property) => [property.name, property.value.value]),
  );
  const level = properties.get('level');
  if (role === 'heading' && typeof level === 'number') parts[0] = `heading ${level}`;
  const value = clean(node.value?.value);
  if (value && value !== name) parts.push(`value=${JSON.stringify(value)}`);
  for (const flag of FLAGS) {
    const state = properties.get(flag);
    if (state === true || state === 'true' || state === 'mixed') parts.push(flag);
  }
  if (interactive && node.backendDOMNodeId !== undefined) {
    parts.push(`[ref=${node.backendDOMNodeId}]`);
  }
  return parts.join(' ');
}

/**
 * True when a subtree adds nothing to its parent's name: only text the name already holds, and
 * wrappers or images around it.
 */
function isOnlyText(node: AxNode, byId: Map<string, AxNode>, parentName: string): boolean {
  const role = roleOf(node);
  if (SKIPPED.has(role)) return true;
  const name = clean(node.name?.value);
  if (TEXT.has(role)) return parentName.toLowerCase().includes(name.toLowerCase());
  if (!node.ignored) {
    // A card's heading that repeats the link around it, say, is still nothing new.
    const repeats = name !== '' && parentName.toLowerCase().includes(name.toLowerCase());
    if (INTERACTIVE.has(role) || (STRUCTURE.has(role) && !repeats)) return false;
    if (name && !isImage(role) && !repeats) return false;
  }
  return (node.childIds ?? []).every((id) => {
    const child = byId.get(id);
    return !child || isOnlyText(child, byId, parentName);
  });
}

function isImage(role: string): boolean {
  return role === 'image' || role === 'img';
}

function roleOf(node: AxNode): string {
  const role = node.role?.value;
  return typeof role === 'string' ? role : '';
}

function clean(value: unknown): string {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  const text = String(value).replaceAll(/\s+/gu, ' ').trim();
  return text.length > MAX_NAME ? `${text.slice(0, MAX_NAME)}…` : text;
}
