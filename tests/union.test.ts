// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from 'vitest';
import type { ManifoldToplevel } from 'manifold-3d';
import { loadManifold } from './helpers/manifold';
import { DEFAULT_GLOBAL_SETTINGS } from '@core/model/defaults';
import {
  EMPTY_TREE_EDIT,
  applyTreeEdit,
  clearUnions,
  markUnions,
  removeFromTree,
  ungroupInTree,
  type TreeEdit,
} from '@core/model/treeEdit';
import { parseSvg } from '@core/svg/parseSvg';
import { resolveLeaves } from '@core/solver/resolveLeaves';
import { buildModel } from '@core/solver/buildModel';
import type { NodeSettings } from '@core/model/types';

/**
 * ADR-0028: a union object is a group of shapes merged on the 2D level before extrusion. The
 * shapes stay in the document (their content is editable), but the model gets one body: no socket
 * is cut between the pieces, and the children's own settings do not take part.
 */

const source = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
  <rect id="a" x="0" y="0" width="60" height="60" fill="#ff0000"/>
  <rect id="b" x="40" y="40" width="60" height="60" fill="#00ff00"/>
</svg>`;

const unionEdit: TreeEdit = {
  ...EMPTY_TREE_EDIT,
  names: { 'group-1': 'Объединение' },
  parents: { a: 'group-1', b: 'group-1' },
  groups: ['group-1'],
  unions: ['group-1'],
};

function parse() {
  return parseSvg(source, { fileName: 'union.svg', global: DEFAULT_GLOBAL_SETTINGS });
}

function resolve(document = parse(), settings: Record<string, NodeSettings> = {}) {
  return resolveLeaves({ document, settings, global: DEFAULT_GLOBAL_SETTINGS });
}

let api: ManifoldToplevel;
beforeAll(async () => {
  api = await loadManifold();
});

describe('union overlay', () => {
  it('marks a group as a union when the overlay is applied', () => {
    const document = applyTreeEdit(parse(), unionEdit);
    const group = document.root.children.find((node) => node.id === 'group-1');
    expect(group?.union).toBe(true);
    expect(group?.children.map((child) => child.id).sort()).toEqual(['a', 'b']);
  });

  it('marks and clears unions without touching the rest of the edit', () => {
    const marked = markUnions(EMPTY_TREE_EDIT, ['group-7']);
    expect(marked?.unions).toEqual(['group-7']);
    expect(markUnions(marked as TreeEdit, ['group-7'])).toBeNull();

    const cleared = clearUnions(marked as TreeEdit, ['group-7']);
    expect(cleared?.unions).toEqual([]);
    expect(clearUnions(marked as TreeEdit, ['other'])).toBeNull();
  });

  it('forgets a union whose group was deleted', () => {
    const edit = removeFromTree(unionEdit, ['group-1']);
    expect(edit?.unions).toEqual([]);
  });
});

describe('union resolving', () => {
  it('resolves the whole group into one leaf with all contour sets', () => {
    const document = applyTreeEdit(parse(), unionEdit);
    const leaves = resolve(document).leaves;

    expect(leaves).toHaveLength(1);
    expect(leaves[0].id).toBe('group-1');
    expect(leaves[0].name).toBe('Объединение');
    // The first shape is the primary geometry, the second is merged into it by the solver.
    expect(leaves[0].unionSources).toHaveLength(1);
    expect(leaves[0].color).toBe('#ff0000');
  });

  it('ignores the settings of the parts', () => {
    const document = applyTreeEdit(parse(), unionEdit);
    const settings: Record<string, NodeSettings> = {
      a: { zFrom: 5, zTo: 6, chamferTop: 1, clearance: 2 },
      b: { zFrom: 20, zTo: 21, chamferTop: 1, clearance: 2 },
    };
    const leaf = resolve(document, settings).leaves[0];
    expect(leaf.zFrom).toBe(DEFAULT_GLOBAL_SETTINGS.defaultZFrom);
    expect(leaf.zTo).toBe(DEFAULT_GLOBAL_SETTINGS.defaultZTo);
    expect(leaf.chamferTop).toBe(DEFAULT_GLOBAL_SETTINGS.defaultChamferTop);
    expect(leaf.clearance).toBe(DEFAULT_GLOBAL_SETTINGS.defaultClearance);
  });

  it('takes the settings of the union itself', () => {
    const document = applyTreeEdit(parse(), unionEdit);
    const leaf = resolve(document, { 'group-1': { zTo: 12, colorOverride: '#123456' } }).leaves[0];
    expect(leaf.zTo).toBe(12);
    expect(leaf.color).toBe('#123456');
  });

  it('drops an ignored part from the merged body', () => {
    const document = applyTreeEdit(parse(), unionEdit);
    const leaf = resolve(document, { b: { ignored: true } }).leaves[0];
    expect(leaf.unionSources).toBeUndefined();
  });

  it('keeps a hidden part in the merged body — «Скрыть» is a view flag', () => {
    const document = applyTreeEdit(parse(), unionEdit);
    const leaf = resolve(document, { b: { hidden: true } }).leaves[0];
    expect(leaf.unionSources).toHaveLength(1);
    // A piece is not drawn on its own, so hiding it cannot hide it from the merged body either.
    expect(leaf.hidden).toBe(false);
  });

  it('lifts the pieces up when «Разъединить» dissolves the union', () => {
    const union = applyTreeEdit(parse(), unionEdit);
    const dissolved = ungroupInTree(union, unionEdit, 'group-1');

    expect(dissolved?.movedIds).toEqual(['a', 'b']);
    // No group is left behind: the pieces take its place, exactly like «Разгруппировать».
    const document = applyTreeEdit(parse(), dissolved!.edit);
    expect(document.root.children.map((node) => node.id).sort()).toEqual(['a', 'b']);
    expect(dissolved?.edit.unions).toEqual([]);

    const leaves = resolve(document).leaves;
    expect(leaves.map((leaf) => leaf.id)).toEqual(['a', 'b']);
    expect(leaves.every((leaf) => leaf.unionSources === undefined)).toBe(true);
  });

  it('goes back to separate leaves when the union flag is cleared', () => {
    const edit = clearUnions(unionEdit, ['group-1']) as TreeEdit;
    const document = applyTreeEdit(parse(), edit);
    const leaves = resolve(document).leaves;
    expect(leaves.map((leaf) => leaf.id)).toEqual(['a', 'b']);
    expect(leaves.every((leaf) => leaf.unionSources === undefined)).toBe(true);
  });
});

describe('union geometry', () => {
  it('prints the merged pieces as one part instead of two', () => {
    const grouped = applyTreeEdit(parse(), {
      ...EMPTY_TREE_EDIT,
      parents: { a: 'group-1', b: 'group-1' },
      groups: ['group-1'],
    });
    expect(buildModel({ api, leaves: resolve(grouped).leaves }).parts).toHaveLength(2);

    const merged = applyTreeEdit(parse(), unionEdit);
    const built = buildModel({ api, leaves: resolve(merged).leaves });
    expect(built.parts).toHaveLength(1);
    expect(built.stats.volume).toBeGreaterThan(0);
  });

  it('does not print the overlap twice', () => {
    const merged = applyTreeEdit(parse(), unionEdit);
    const leaf = resolve(merged).leaves[0];
    const union = buildModel({ api, leaves: [leaf] });

    // The same shapes as separate parts: the socket of the upper one keeps the total equal to two
    // full squares, so the union must be smaller by exactly the overlap.
    const sources = [
      { contours: leaf.contours, fillRule: leaf.fillRule, mask: leaf.mask },
      ...(leaf.unionSources ?? []),
    ];
    const separate = buildModel({
      api,
      leaves: sources.map((source, index) => ({
        ...leaf,
        id: `part-${index}`,
        partId: `part-${index}`,
        contours: source.contours,
        fillRule: source.fillRule,
        mask: source.mask,
        unionSources: undefined,
      })),
    });

    // viewBox 100 → 200 mm: the squares overlap by 40 × 40 mm at a height of 30 mm.
    expect(separate.stats.volume - union.stats.volume).toBeCloseTo(40 * 40 * 30, 0);
  });
});
