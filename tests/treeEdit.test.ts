// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { DEFAULT_GLOBAL_SETTINGS } from '@core/model/defaults';
import type { SvgDocNode, SvgDocument } from '@core/model/types';
import {
  EMPTY_TREE_EDIT,
  applyTreeEdit,
  createGroup,
  findNodeIn,
  moveNodesInTree,
  removeFromTree,
  renameInTree,
} from '@core/model/treeEdit';
import { parseSvg } from '@core/svg/parseSvg';
import { findPartRoots } from '@core/solver/resolveLeaves';

const SOURCE =
  '<svg viewBox="0 0 100 100"><g id="top">' +
  '<rect id="a" x="0" y="0" width="10" height="10"/>' +
  '<rect id="b" x="10" y="0" width="10" height="10"/>' +
  '<g id="inner"><rect id="c" x="20" y="0" width="10" height="10"/>' +
  '<rect id="d" x="30" y="0" width="10" height="10"/></g>' +
  '</g></svg>';

function document(): SvgDocument {
  return parseSvg(SOURCE, { fileName: 'test.svg', global: DEFAULT_GLOBAL_SETTINGS });
}

/** Child ids of a node (root when `id` is empty), in document order. */
function childIds(doc: SvgDocument, id: string): string[] {
  const node = id === '' ? doc.root : findNodeIn(doc.root, id);
  return node ? node.children.map((child) => child.id) : [];
}

function parentIdOf(doc: SvgDocument, id: string): string | null {
  const walk = (node: SvgDocNode): string | null => {
    for (const child of node.children) {
      if (child.id === id) return node === doc.root ? '' : node.id;
      const found = walk(child);
      if (found !== null) return found;
    }
    return null;
  };
  return walk(doc.root);
}

describe('applyTreeEdit', () => {
  it('returns the parsed tree unchanged for an empty overlay', () => {
    const base = document();
    const edited = applyTreeEdit(base, EMPTY_TREE_EDIT);
    expect(childIds(edited, 'top')).toEqual(['a', 'b', 'inner']);
    expect(parentIdOf(edited, 'c')).toBe('inner');
    // The hash stays: nothing about the geometry changed.
    expect(edited.hash).toBe(base.hash);
  });

  it('renames nodes, including created groups', () => {
    const base = document();
    const edited = applyTreeEdit(base, {
      ...EMPTY_TREE_EDIT,
      names: { inner: 'Задний план' },
    });
    expect(findNodeIn(edited.root, 'inner')?.name).toBe('Задний план');
  });

  it('drops removed subtrees', () => {
    const base = document();
    const edited = applyTreeEdit(base, removeFromTree(EMPTY_TREE_EDIT, ['inner'])!);
    expect(childIds(edited, 'top')).toEqual(['a', 'b']);
    expect(findNodeIn(edited.root, 'c')).toBeNull();
    expect(edited.paintOrder).toEqual(['a', 'b']);
  });

  it('never moves a node inside itself', () => {
    const base = document();
    const result = moveNodesInTree(base, EMPTY_TREE_EDIT, ['inner'], 'c', 'after');
    expect(result).toBeNull();
  });

  it('refuses to drop into a shape', () => {
    const base = document();
    expect(moveNodesInTree(base, EMPTY_TREE_EDIT, ['a'], 'b', 'inside')).toBeNull();
  });
});

describe('createGroup', () => {
  it('takes the place of the least nested, highest element', () => {
    const base = document();
    // `c` sits inside `inner`, `b` is a top-level sibling: the group must go to the top level.
    const result = createGroup(base, EMPTY_TREE_EDIT, ['c', 'b'], '')!;
    expect(result).not.toBeNull();
    expect(result.parentId).toBe('top');
    expect(result.anchorId).toBe('b');
    expect(result.movedIds).toEqual(['b', 'c']);

    const edited = applyTreeEdit(base, result.edit);
    expect(parentIdOf(edited, 'b')).toBe(result.groupId);
    expect(parentIdOf(edited, 'c')).toBe(result.groupId);
    // Both are gone from their old parents, the group takes the anchor's place in `top`.
    expect(childIds(edited, 'top')).toEqual(['a', 'inner', result.groupId]);
    expect(childIds(edited, result.groupId)).toEqual(['b', 'c']);
    expect(findNodeIn(edited.root, result.groupId)?.name).toBe('Группа 1');
  });

  it('drops a selected element whose ancestor is selected too', () => {
    const base = document();
    const result = createGroup(base, EMPTY_TREE_EDIT, ['inner', 'c'], '')!;
    expect(result.movedIds).toEqual(['inner']);
    expect(result.skippedIds).toEqual(['c']);
  });

  it('groups a single element', () => {
    const base = document();
    const result = createGroup(base, EMPTY_TREE_EDIT, ['a'], 'Моя группа')!;
    const edited = applyTreeEdit(base, result.edit);
    expect(findNodeIn(edited.root, result.groupId)?.name).toBe('Моя группа');
    expect(childIds(edited, result.groupId)).toEqual(['a']);
  });

  it('creates groups with unique ids and keeps the shape of the tree', () => {
    const base = document();
    const first = createGroup(base, EMPTY_TREE_EDIT, ['a'], '')!;
    const afterFirst = applyTreeEdit(base, first.edit);
    const second = createGroup(afterFirst, first.edit, ['b'], '')!;
    expect(second.groupId).not.toBe(first.groupId);
    const edited = applyTreeEdit(base, second.edit);
    expect(childIds(edited, 'top')).toEqual(['inner', first.groupId, second.groupId]);
  });

  it('groups the whole tree at the root level', () => {
    const base = document();
    const result = createGroup(base, EMPTY_TREE_EDIT, ['top'], '')!;
    expect(result.parentId).toBe('');
    const edited = applyTreeEdit(base, result.edit);
    expect(childIds(edited, '')).toEqual([result.groupId]);
    expect(childIds(edited, result.groupId)).toEqual(['top']);
    // The grouped tree is one part now.
    expect(findPartRoots(edited.root, {})).toHaveLength(1);
  });
});

describe('moveNodeInTree', () => {
  it('moves a node into another group', () => {
    const base = document();
    const result = moveNodesInTree(base, EMPTY_TREE_EDIT, ['a'], 'inner', 'inside')!;
    const edited = applyTreeEdit(base, result.edit);
    expect(parentIdOf(edited, 'a')).toBe('inner');
    expect(childIds(edited, 'inner')).toEqual(['c', 'd', 'a']);
  });

  it('moves a node out of a group to the root', () => {
    const base = document();
    const result = moveNodesInTree(base, EMPTY_TREE_EDIT, ['c'], 'top', 'inside')!;
    const edited = applyTreeEdit(base, result.edit);
    expect(parentIdOf(edited, 'c')).toBe('top');
    expect(childIds(edited, 'inner')).toEqual(['d']);
    expect(childIds(edited, 'top')).toEqual(['a', 'b', 'inner', 'c']);
  });
});

describe('moveNodesInTree (multi-selection)', () => {
  it('moves a block of nodes into a group, keeping their order', () => {
    const base = document();
    const result = moveNodesInTree(base, EMPTY_TREE_EDIT, ['a', 'b'], 'inner', 'inside')!;
    expect(result.movedIds).toEqual(['a', 'b']);
    const edited = applyTreeEdit(base, result.edit);
    expect(childIds(edited, 'inner')).toEqual(['c', 'd', 'a', 'b']);
    expect(childIds(edited, 'top')).toEqual(['inner']);
  });

  it('drops moved children whose ancestor is in the same block', () => {
    const base = document();
    const result = moveNodesInTree(base, EMPTY_TREE_EDIT, ['inner', 'c', 'a'], 'top', 'before')!;
    expect(result.movedIds).toEqual(['a', 'inner']);
  });

  it('refuses a block that would land inside itself', () => {
    const base = document();
    expect(moveNodesInTree(base, EMPTY_TREE_EDIT, ['inner', 'a'], 'c', 'after')).toBeNull();
  });
});

describe('renameInTree', () => {
  it('ignores empty names and no-ops', () => {
    expect(renameInTree(document(), EMPTY_TREE_EDIT, 'a', '   ')).toBeNull();
    expect(renameInTree(document(), EMPTY_TREE_EDIT, 'missing', 'x')).toBeNull();
  });

  it('stores the new name', () => {
    const edit = renameInTree(document(), EMPTY_TREE_EDIT, 'a', 'Фон')!;
    expect(edit.names.a).toBe('Фон');
    expect(findNodeIn(applyTreeEdit(document(), edit).root, 'a')?.name).toBe('Фон');
  });
});
