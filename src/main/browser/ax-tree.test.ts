import { describe, expect, it } from 'vitest';

import { type AxNode, formatAxTree } from './ax-tree';

/** Builds a tree from a nested description, numbering nodes as it goes. */
type Spec = [role: string, name?: string, children?: Spec[], extra?: Partial<AxNode>];

function tree(spec: Spec): AxNode[] {
  const nodes: AxNode[] = [];
  let next = 1;
  const add = ([role, name, children = [], extra = {}]: Spec, parentId?: string): string => {
    const nodeId = String(next++);
    const node: AxNode = {
      nodeId,
      parentId,
      role: { value: role },
      ...(name === undefined ? {} : { name: { value: name } }),
      backendDOMNodeId: Number(nodeId) + 100,
      ...extra,
    };
    nodes.push(node);
    node.childIds = children.map((child) => add(child, nodeId));
    return nodeId;
  };
  add(spec);
  return nodes;
}

describe('formatAxTree', () => {
  it('prints what a person would notice, with refs on what can be used', () => {
    const nodes = tree([
      'RootWebArea',
      'Inara',
      [
        [
          'generic',
          '',
          [
            [
              'heading',
              'Community goals',
              [['StaticText', 'Community goals']],
              {
                properties: [{ name: 'level', value: { value: 1 } }],
              },
            ],
            [
              'paragraph',
              '',
              [
                ['StaticText', 'Deliver'],
                ['StaticText', 'tritium.'],
              ],
            ],
            ['link', 'Details', [['StaticText', 'Details']]],
            ['textbox', 'Search', [], { value: { value: 'Colonia' } }],
            ['image', ''],
          ],
        ],
      ],
    ]);

    expect(formatAxTree(nodes)).toBe(
      [
        'heading 1 "Community goals"',
        'Deliver tritium.',
        'link "Details" [ref=108]',
        'textbox "Search" value="Colonia" [ref=110]',
      ].join('\n'),
    );
  });

  it('nests children of named containers and keeps states', () => {
    const nodes = tree([
      'RootWebArea',
      '',
      [
        [
          'navigation',
          'Main',
          [
            [
              'checkbox',
              'Odyssey only',
              [],
              { properties: [{ name: 'checked', value: { value: 'true' } }] },
            ],
          ],
        ],
      ],
    ]);
    expect(formatAxTree(nodes)).toBe(
      ['navigation "Main"', '  checkbox "Odyssey only" checked [ref=103]'].join('\n'),
    );
  });

  it('skips ignored nodes but not what is inside them', () => {
    const nodes = tree(['RootWebArea', '', [['div', '', [['button', 'Buy']], { ignored: true }]]]);
    expect(formatAxTree(nodes)).toBe('button "Buy" [ref=103]');
  });

  it('folds lists away, drops empty wrappers and puts a table row on one line', () => {
    const nodes = tree([
      'RootWebArea',
      '',
      [
        ['list', '', [['listitem', '', [['link', 'Forums', [['StaticText', 'Forums']]]]]]],
        ['list', '', []],
        [
          'table',
          '',
          [
            [
              'row',
              '',
              [
                ['columnheader', '', [['StaticText', 'Tier']]],
                ['columnheader', '', [['StaticText', 'Reward']]],
              ],
            ],
            [
              'row',
              '',
              [
                ['cell', '', [['StaticText', 'Top 10']]],
                ['cell', '', [['StaticText', '200,000,000 Cr']]],
              ],
            ],
          ],
        ],
      ],
    ]);
    expect(formatAxTree(nodes)).toBe(
      ['link "Forums" [ref=104]', 'table', '  Tier | Reward', '  Top 10 | 200,000,000 Cr'].join(
        '\n',
      ),
    );
  });

  it('copes with an empty tree', () => {
    expect(formatAxTree([])).toBe('');
  });
});
