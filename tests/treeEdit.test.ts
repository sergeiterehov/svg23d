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
  orderKeyFor,
  removeFromTree,
  renameInTree,
  ungroupInTree,
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

describe('moves combined with deletions', () => {
  it('keeps an element that was moved out of a group before the group is deleted', () => {
    const base = document();
    // Move `c` out of `inner` to the root, then remove the (now single-child) group `inner`.
    const moved = moveNodesInTree(base, EMPTY_TREE_EDIT, ['c'], 'top', 'inside')!;
    const afterMove = applyTreeEdit(base, moved.edit);
    const edit = removeFromTree(moved.edit, ['inner'])!;
    const edited = applyTreeEdit(base, edit);

    expect(edited.paintOrder).toContain('c');
    expect(findNodeIn(edited.root, 'c')).not.toBeNull();
    expect(parentIdOf(edited, 'c')).toBe('top');
    // Only the group itself and what was left inside it are gone.
    expect(childIds(edited, '')).toEqual(['top']);
    expect(childIds(edited, 'inner')).toEqual([]);
    // The move is still visible in the first snapshot: the group had `d` in it.
    expect(childIds(afterMove, 'inner')).toEqual(['d']);
  });

  it('removes an element that was moved into the deleted group', () => {
    const base = document();
    const moved = moveNodesInTree(base, EMPTY_TREE_EDIT, ['a'], 'inner', 'inside')!;
    const edit = removeFromTree(moved.edit, ['inner'])!;
    const edited = applyTreeEdit(base, edit);
    expect(findNodeIn(edited.root, 'a')).toBeNull();
    expect(edited.paintOrder).toEqual(['b']);
  });
});

describe('findPartRoots', () => {
  it('walks the parts in the manual child order, not in the raw child order', () => {
    const base = document();
    const doc = applyTreeEdit(base, EMPTY_TREE_EDIT);
    const settings = { top: { childOrder: ['inner', 'a', 'b'] } };
    expect(findPartRoots(doc.root, settings)).toEqual(['inner', 'a', 'b']);
    // Without the override the document order wins.
    expect(findPartRoots(doc.root, {})).toEqual(['a', 'b', 'inner']);
  });
});

describe('orderKeyFor', () => {
  it('keys the top level by the root node id, not by the empty string', () => {
    const doc = applyTreeEdit(document(), EMPTY_TREE_EDIT);
    expect(orderKeyFor(doc, '')).toBe(doc.root.id);
    expect(orderKeyFor(doc, 'inner')).toBe('inner');
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

describe('ungroupInTree', () => {
  it('lifts the children into the parent and removes the group', () => {
    const edit = {
      ...EMPTY_TREE_EDIT,
      names: { 'group-1': 'Группа' },
      groups: ['group-1'],
      parents: { a: 'group-1', b: 'group-1' },
    };
    const grouped = applyTreeEdit(document(), edit);
    const result = ungroupInTree(grouped, edit, 'group-1');
    expect(result?.movedIds).toEqual(['a', 'b']);
    // A created group lives at the root, so its children land there too.
    expect(result?.parentId).toBe('');

    const after = applyTreeEdit(document(), result!.edit);
    expect(findNodeIn(after.root, 'group-1')).toBeNull();
    expect(after.root.children.map((child) => child.id)).toEqual(['top', 'a', 'b']);
    expect(result?.edit.groups).toEqual([]);
    expect(result?.edit.unions).toEqual([]);
  });

  it('dissolves an SVG group and forgets union flags', () => {
    const edit = {
      ...EMPTY_TREE_EDIT,
      groups: ['group-1'],
      parents: { a: 'group-1', b: 'group-1' },
      unions: ['group-1'],
    };
    const grouped = applyTreeEdit(document(), edit);
    const result = ungroupInTree(grouped, edit, 'group-1');
    expect(result?.edit.unions).toEqual([]);

    // An SVG group is dissolved the same way: its children move up to the parent.
    const svgGroup = ungroupInTree(document(), EMPTY_TREE_EDIT, 'inner');
    expect(svgGroup?.movedIds).toEqual(['c', 'd']);
    const after = applyTreeEdit(document(), svgGroup!.edit);
    expect(findNodeIn(after.root, 'inner')).toBeNull();
    expect(childIds(after, 'top')).toEqual(['a', 'b', 'c', 'd']);
  });

  it('does not reuse the id of a dissolved group', () => {
    const edit = {
      ...EMPTY_TREE_EDIT,
      groups: ['group-1'],
      parents: { a: 'group-1', b: 'group-1' },
    };
    const grouped = applyTreeEdit(document(), edit);
    const dissolved = ungroupInTree(grouped, edit, 'group-1')!;
    const regrouped = applyTreeEdit(document(), dissolved.edit);

    const again = createGroup(regrouped, dissolved.edit, ['a', 'b'], '');
    expect(again).not.toBeNull();
    expect(again!.groupId).not.toBe('group-1');
    // The new group really appears in the document (the old id would be pruned as removed).
    const after = applyTreeEdit(document(), again!.edit);
    expect(findNodeIn(after.root, again!.groupId)).not.toBeNull();
  });

  it('refuses shapes and groups without children', () => {
    const doc = document();
    expect(ungroupInTree(doc, EMPTY_TREE_EDIT, 'a')).toBeNull();
    const empty = applyTreeEdit(doc, {
      ...EMPTY_TREE_EDIT,
      groups: ['group-9'],
      parents: {},
    });
    expect(ungroupInTree(empty, { ...EMPTY_TREE_EDIT, groups: ['group-9'] }, 'group-9')).toBeNull();
  });
});
