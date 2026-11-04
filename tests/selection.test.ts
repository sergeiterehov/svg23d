import { describe, expect, it } from 'vitest';
import type { ResolvedLeaf, SvgDocNode } from '@core/model/types';
import { partIdForSelection } from '@core/solver/selection';

function node(id: string, kind: 'group' | 'shape', children: SvgDocNode[] = []): SvgDocNode {
  return {
    id,
    tag: kind === 'group' ? 'g' : 'path',
    kind,
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

function leaf(id: string, partId: string): ResolvedLeaf {
  return {
    id,
    name: id,
    partId,
    partName: partId,
    order: 0,
    contours: [],
    fillRule: 'nonzero',
    color: '#000000',
    zFrom: 0,
    zTo: 1,
    clearance: 0,
    chamferTop: 0,
    chamferBottom: 0,
    hidden: false,
  };
}

const root = node('root', 'group', [
  node('group-a', 'group', [node('a1', 'shape'), node('a2', 'shape')]),
  node('b1', 'shape'),
]);
const leaves = [leaf('a1', 'group-a'), leaf('a2', 'group-a'), leaf('b1', 'b1')];

describe('partIdForSelection', () => {
  it('returns nothing without a selection', () => {
    expect(partIdForSelection(root, leaves, null)).toBeNull();
  });

  it('maps a leaf to its part', () => {
    expect(partIdForSelection(root, leaves, 'a1')).toBe('group-a');
    expect(partIdForSelection(root, leaves, 'b1')).toBe('b1');
  });

  it('maps a group to its part when the whole subtree shares one part', () => {
    expect(partIdForSelection(root, leaves, 'group-a')).toBe('group-a');
  });

  it('returns nothing when the subtree spans several parts', () => {
    expect(partIdForSelection(root, leaves, 'root')).toBeNull();
  });

  it('ignores unknown ids', () => {
    expect(partIdForSelection(root, leaves, 'missing')).toBeNull();
  });
});
