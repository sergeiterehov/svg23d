// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_GLOBAL_SETTINGS } from '@core/model/defaults';
import type { NodeSettings, SvgDocNode } from '@core/model/types';
import { parseSvg } from '@core/svg/parseSvg';
import { resolveLeaves } from '@core/solver/resolveLeaves';
import { effectiveSettingsFor } from '@core/solver/inheritance';

const sample = readFileSync(resolve(process.cwd(), 'samples/html5.svg'), 'utf8');

function parseSample() {
  return parseSvg(sample, { fileName: 'sample.svg', global: DEFAULT_GLOBAL_SETTINGS });
}

function collectShapes(node: SvgDocNode, out: SvgDocNode[] = []): SvgDocNode[] {
  if (node.kind === 'shape') out.push(node);
  for (const child of node.children) collectShapes(child, out);
  return out;
}

describe('parseSvg', () => {
  it('reads the document structure and paint order', () => {
    const doc = parseSample();
    expect(doc.root.children).toHaveLength(1);
    const group = doc.root.children[0];
    expect(group.kind).toBe('group');
    expect(group.children).toHaveLength(5);
    expect(doc.paintOrder).toHaveLength(5);
  });

  it('resolves fills, including the default black', () => {
    const doc = parseSample();
    const shapes = collectShapes(doc.root);
    expect(shapes[0].fill).toBe('#e44d26');
    expect(shapes[1].fill).toBe('#f16529');
    expect(shapes[3].fill).toBe('#000000');
  });

  it('bakes the group transform into the contours', () => {
    const doc = parseSample();
    const shapes = collectShapes(doc.root);
    for (const shape of shapes) {
      expect(shape.bbox).toBeDefined();
      expect(shape.bbox!.minX).toBeGreaterThanOrEqual(0);
      expect(shape.bbox!.maxX).toBeLessThanOrEqual(500);
      expect(shape.bbox!.minY).toBeGreaterThanOrEqual(0);
      expect(shape.bbox!.maxY).toBeLessThanOrEqual(600);
    }
  });

  it('keeps holes and reports a stable hash', () => {
    const doc = parseSample();
    const shapes = collectShapes(doc.root);
    // The white "5" contains several subpaths, some of which are holes.
    expect(shapes[4].subpaths.length).toBeGreaterThan(1);
    expect(doc.hash).toMatch(/^[0-9a-f]{8}$/);
  });

  it('rejects broken documents', () => {
    expect(() => parseSvg('<svg><path d="M0 0"</svg>', { fileName: 'bad.svg', global: DEFAULT_GLOBAL_SETTINGS })).toThrow();
    expect(() => parseSvg('<div/>', { fileName: 'bad.svg', global: DEFAULT_GLOBAL_SETTINGS })).toThrow();
  });

  it('warns about unsupported elements', () => {
    const doc = parseSvg(
      '<svg viewBox="0 0 10 10"><text x="1" y="1">hi</text><path d="M0 0H10V10H0Z" fill="#ff0000"/></svg>',
      { fileName: 'text.svg', global: DEFAULT_GLOBAL_SETTINGS },
    );
    expect(doc.warnings.some((w) => w.code === 'unsupported-element')).toBe(true);
    expect(doc.paintOrder).toHaveLength(1);
  });

  it('applies styles from <style> blocks', () => {
    const doc = parseSvg(
      '<svg viewBox="0 0 10 10"><style>.cls-1{fill:#00ff00}</style><path class="cls-1" d="M0 0H10V10H0Z"/></svg>',
      { fileName: 'css.svg', global: DEFAULT_GLOBAL_SETTINGS },
    );
    const shapes = collectShapes(doc.root);
    expect(shapes[0].fill).toBe('#00ff00');
  });
});

describe('resolveLeaves', () => {
  it('creates one part per top-level child', () => {
    const doc = parseSample();
    const resolved = resolveLeaves({ document: doc, settings: {}, global: DEFAULT_GLOBAL_SETTINGS });
    expect(resolved.leaves).toHaveLength(5);
    expect(resolved.parts).toHaveLength(5);
    expect(resolved.leaves.map((leaf) => leaf.order)).toEqual([0, 1, 2, 3, 4]);
  });

  it('scales the model to the requested width', () => {
    const doc = parseSample();
    const resolved = resolveLeaves({
      document: doc,
      settings: {},
      global: { ...DEFAULT_GLOBAL_SETTINGS, fitSizeMm: 200, fit: 'width' },
    });
    expect(resolved.widthMm).toBeCloseTo(200, 6);
    const xs = resolved.leaves.flatMap((leaf) => leaf.contours.flat().map((p) => p.x));
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(200, 4);
  });

  it('fits the larger side when fit is "max"', () => {
    const doc = parseSample();
    const resolved = resolveLeaves({
      document: doc,
      settings: {},
      global: { ...DEFAULT_GLOBAL_SETTINGS, fitSizeMm: 200, fit: 'max' },
    });
    expect(Math.max(resolved.widthMm, resolved.heightMm)).toBeCloseTo(200, 6);
    expect(resolved.heightMm).toBeGreaterThan(resolved.widthMm);
  });

  it('inherits group settings and allows overrides', () => {
    const doc = parseSample();
    const group = doc.root.children[0];
    const firstChild = group.children[0];
    const settings: Record<string, NodeSettings> = {
      [group.id]: { zFrom: 1, zTo: 5, clearance: 0.3, chamferTop: 0.5 },
      [firstChild.id]: { zTo: 3 },
    };
    const resolved = resolveLeaves({ document: doc, settings, global: DEFAULT_GLOBAL_SETTINGS });
    const first = resolved.leaves.find((leaf) => leaf.id === firstChild.id);
    const second = resolved.leaves.find((leaf) => leaf.id === group.children[1].id);

    expect(first?.zFrom).toBe(1);
    expect(first?.zTo).toBe(3);
    expect(second?.zTo).toBe(5);
    expect(second?.clearance).toBe(0.3);
    expect(second?.chamferTop).toBe(0.5);
  });

  it('reports the effective settings for a node', () => {
    const doc = parseSample();
    const group = doc.root.children[0];
    const child = group.children[2];
    const settings: Record<string, NodeSettings> = { [group.id]: { zTo: 4 } };
    const effective = effectiveSettingsFor(doc.root, settings, DEFAULT_GLOBAL_SETTINGS, child.id);
    expect(effective?.zTo).toBe(4);
    expect(effective?.zFrom).toBe(DEFAULT_GLOBAL_SETTINGS.defaultZFrom);
  });

  it('skips hidden and zero-height leaves with warnings', () => {
    const doc = parseSample();
    const first = doc.root.children[0].children[0];
    const resolved = resolveLeaves({
      document: doc,
      settings: { [first.id]: { zFrom: 2, zTo: 2 } },
      global: DEFAULT_GLOBAL_SETTINGS,
    });
    expect(resolved.leaves).toHaveLength(4);
    expect(resolved.warnings.some((w) => w.nodeId === first.id)).toBe(true);
  });

  it('honours explicit part markers', () => {
    const doc = parseSample();
    const group = doc.root.children[0];
    const resolved = resolveLeaves({
      document: doc,
      settings: { [group.id]: { isPart: true } },
      global: DEFAULT_GLOBAL_SETTINGS,
    });
    expect(resolved.parts).toHaveLength(1);
  });

  it('applies a manual paint order from childOrder', () => {
    const doc = parseSample();
    const group = doc.root.children[0];
    const [first, second] = group.children;
    const defaultOrder = resolveLeaves({
      document: doc,
      settings: {},
      global: DEFAULT_GLOBAL_SETTINGS,
    });
    expect(defaultOrder.leaves[0].id).toBe(first.id);

    const swapped = resolveLeaves({
      document: doc,
      settings: { [group.id]: { childOrder: [second.id, first.id] } },
      global: DEFAULT_GLOBAL_SETTINGS,
    });
    expect(swapped.leaves[0].id).toBe(second.id);
    expect(swapped.leaves[0].order).toBeLessThan(swapped.leaves[1].order);
  });
});
