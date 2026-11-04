import { describe, expect, it } from 'vitest';
import { findParent, orderedChildren, shiftChildOrder } from '@core/solver/order';
import type { NodeSettings, SvgDocNode } from '@core/model/types';

function shape(id: string): SvgDocNode {
  return {
    id,
    tag: 'path',
    kind: 'shape',
    name: id,
    fill: '#000000',
    fillRule: 'nonzero',
    hidden: false,
    depth: 1,
    children: [],
    subpaths: [],
    warnings: [],
  };
}

function group(id: string, children: SvgDocNode[]): SvgDocNode {
  return {
    id,
    tag: 'g',
    kind: 'group',
    name: id,
    fill: '#000000',
    fillRule: 'nonzero',
    hidden: false,
    depth: 0,
    children,
    subpaths: [],
    warnings: [],
  };
}

describe('orderedChildren', () => {
  it('falls back to document order without an override', () => {
    const root = group('root', [shape('a'), shape('b')]);
    expect(orderedChildren(root, {}).map((n) => n.id)).toEqual(['a', 'b']);
  });

  it('applies a manual order and keeps unknown/missing children', () => {
    const root = group('root', [shape('a'), shape('b'), shape('c')]);
    const settings: Record<string, NodeSettings> = {
      root: { childOrder: ['c', 'ghost', 'a'] },
    };
    expect(orderedChildren(root, settings).map((n) => n.id)).toEqual(['c', 'a', 'b']);
  });
});

describe('shiftChildOrder', () => {
  it('moves a node up and down in paint order', () => {
    const root = group('root', [shape('a'), shape('b'), shape('c')]);
    expect(shiftChildOrder(root, 'b', 1, {})).toEqual(['a', 'c', 'b']);
    expect(shiftChildOrder(root, 'b', -1, {})).toEqual(['b', 'a', 'c']);
  });

  it('respects the existing manual order', () => {
    const root = group('root', [shape('a'), shape('b'), shape('c')]);
    const settings: Record<string, NodeSettings> = { root: { childOrder: ['c', 'a', 'b'] } };
    // 'c' < 'a' < 'b' → moving 'b' down swaps it with 'a'.
    expect(shiftChildOrder(root, 'b', -1, settings)).toEqual(['c', 'b', 'a']);
  });

  it('returns null at the edges', () => {
    const root = group('root', [shape('a'), shape('b')]);
    expect(shiftChildOrder(root, 'a', -1, {})).toBeNull();
    expect(shiftChildOrder(root, 'b', 1, {})).toBeNull();
  });

  it('finds the parent of a nested node', () => {
    const inner = group('inner', [shape('x')]);
    const root = group('root', [inner]);
    expect(findParent(root, 'x')?.id).toBe('inner');
    expect(findParent(root, 'root')).toBeNull();
  });
});
