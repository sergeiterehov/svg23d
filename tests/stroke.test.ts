// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { ManifoldToplevel } from 'manifold-3d';
import { loadManifold } from './helpers/manifold';
import { DEFAULT_GLOBAL_SETTINGS } from '@core/model/defaults';
import type { SvgDocNode } from '@core/model/types';
import type { FlatSubpath } from '@core/svg/flatten';
import { strokeToContours } from '@core/svg/stroke';
import { parseSvg } from '@core/svg/parseSvg';
import { sectionFromContours } from '@core/geometry/section';
import { resolveLeaves } from '@core/solver/resolveLeaves';
import { buildModel } from '@core/solver/buildModel';

function collectShapes(node: SvgDocNode, out: SvgDocNode[] = []): SvgDocNode[] {
  if (node.kind === 'shape') out.push(node);
  for (const child of node.children) collectShapes(child, out);
  return out;
}

let api: ManifoldToplevel;
beforeAll(async () => {
  api = await loadManifold();
});

function strokeArea(subpaths: FlatSubpath[], width: number, caps: 'butt' | 'round' | 'square') {
  const polygons = strokeToContours(subpaths, {
    width,
    linecap: caps,
    linejoin: 'round',
    tolerance: 0.001,
  });
  const section = sectionFromContours(api, polygons, 'nonzero');
  const area = section.area();
  section.delete();
  return area;
}

const closedSquare: FlatSubpath = {
  points: [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ],
  closed: true,
};

describe('stroke outlines', () => {
  it('strokes a closed square as a band of the requested width', () => {
    // Outer 12×12 minus inner 8×8, with rounded outer corners.
    const expected = (144 - 4 * (1 - Math.PI / 4)) - 64;
    expect(strokeArea([closedSquare], 2, 'butt')).toBeCloseTo(expected, 1);
  });

  it('strokes an open line with butt caps', () => {
    const line: FlatSubpath = {
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
      closed: false,
    };
    expect(strokeArea([line], 2, 'butt')).toBeCloseTo(20, 3);
  });

  it('adds round caps', () => {
    const line: FlatSubpath = {
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
      closed: false,
    };
    expect(strokeArea([line], 2, 'round')).toBeCloseTo(20 + Math.PI, 0);
  });

  it('adds square caps', () => {
    const line: FlatSubpath = {
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
      closed: false,
    };
    expect(strokeArea([line], 2, 'square')).toBeCloseTo(24, 1);
  });

  it('ignores zero width', () => {
    expect(strokeToContours([closedSquare], { width: 0, linecap: 'butt', linejoin: 'miter', tolerance: 0.01 })).toEqual([]);
  });
});

describe('name.svg (text with stroke)', () => {
  const source = readFileSync(resolve(process.cwd(), 'samples/name.svg'), 'utf8');
  const document = parseSvg(source, { fileName: 'name.svg', global: DEFAULT_GLOBAL_SETTINGS });

  it('emits the stroke as its own element', () => {
    const shapes = collectShapes(document.root);
    const stroke = shapes.find((node) => node.id.endsWith('#stroke'));
    expect(stroke).toBeDefined();
    expect(stroke?.fill).toBe('#c2ff00');
    expect(stroke?.name).toContain('обводка');
    expect(stroke?.subpaths.length).toBeGreaterThan(0);
    expect(stroke?.bbox).toBeDefined();
  });

  it('no longer reports strokes as unsupported', () => {
    expect(
      document.warnings.some((warning) => warning.message.includes('Обводка (stroke) не преобразуется')),
    ).toBe(false);
  });

  it('applies the mask that hides the stroke behind the glyphs', () => {
    const shapes = collectShapes(document.root);
    const stroke = shapes.find((node) => node.id.endsWith('#stroke'));
    expect(stroke?.maskInclude?.length).toBeGreaterThan(0);
    expect(stroke?.maskExclude?.length).toBeGreaterThan(0);
    expect(document.warnings.some((warning) => warning.message.toLowerCase().includes('маска'))).toBe(
      false,
    );
  });

  it('builds a model where the stroke is a real 3D element', () => {
    const resolved = resolveLeaves({
      document,
      settings: {},
      global: DEFAULT_GLOBAL_SETTINGS,
    });
    expect(resolved.leaves.some((leaf) => leaf.id.endsWith('#stroke'))).toBe(true);

    const built = buildModel({ api, leaves: resolved.leaves });
    expect(built.parts.length).toBeGreaterThan(0);
    expect(built.stats.volume).toBeGreaterThan(0);

    // The mask removes the part of the stroke that lies on top of the glyphs.
    const withoutMask = buildModel({
      api,
      leaves: resolved.leaves.map((leaf) => ({ ...leaf, mask: undefined })),
    });
    expect(built.stats.volume).toBeLessThan(withoutMask.stats.volume);
  });
});
