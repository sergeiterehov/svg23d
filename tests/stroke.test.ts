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
    const expected = 144 - 4 * (1 - Math.PI / 4) - 64;
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
    expect(
      strokeToContours([closedSquare], {
        width: 0,
        linecap: 'butt',
        linejoin: 'miter',
        tolerance: 0.01,
      }),
    ).toEqual([]);
  });
});

describe('name.svg (fill and stroke in one colour)', () => {
  const source = readFileSync(resolve(process.cwd(), 'samples/name.svg'), 'utf8');
  const document = parseSvg(source, { fileName: 'name.svg', global: DEFAULT_GLOBAL_SETTINGS });

  it('keeps the stroke band as a shape of the document', () => {
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
      document.warnings.some((warning) =>
        warning.message.includes('Обводка (stroke) не преобразуется'),
      ),
    ).toBe(false);
  });

  it('merges a fill and a stroke of the same colour into one union object', () => {
    const object = document.root.children.find((node) => node.id === 'pi_stroke');
    expect(object?.union).toBe(true);
    expect(object?.children.map((child) => child.id).sort()).toEqual([
      'pi_stroke#fill',
      'pi_stroke#stroke',
    ]);

    const resolved = resolveLeaves({ document, settings: {}, global: DEFAULT_GLOBAL_SETTINGS });
    const leaf = resolved.leaves.find((item) => item.id === 'pi_stroke');
    expect(leaf).toBeDefined();
    // The fill is the primary contour set, the stroke band is merged into it on the 2D level.
    expect(leaf?.unionSources).toHaveLength(1);
    expect(resolved.leaves.some((item) => item.id.endsWith('#stroke'))).toBe(false);
  });

  it('builds the union as one body and the other colours as their own parts', () => {
    const resolved = resolveLeaves({ document, settings: {}, global: DEFAULT_GLOBAL_SETTINGS });
    const built = buildModel({ api, leaves: resolved.leaves });
    expect(built.stats.volume).toBeGreaterThan(0);

    // The union body is thicker than the fill alone: the stroke band is part of it.
    const fillOnly = resolveLeaves({
      document,
      settings: { 'pi_stroke#stroke': { ignored: true } },
      global: DEFAULT_GLOBAL_SETTINGS,
    });
    expect(buildModel({ api, leaves: fillOnly.leaves }).stats.volume).toBeLessThan(
      built.stats.volume,
    );
  });
});

describe('masks', () => {
  // A red square whose right half is excluded by a mask: the same coverage the solver subtracts.
  const source = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
    <mask id="half"><rect x="0" y="0" width="50" height="100" fill="#fff"/></mask>
    <rect id="plate" x="0" y="0" width="100" height="100" fill="#ff0000" mask="url(#half)"/>
  </svg>`;

  it('resolves mask coverage into include/exclude sets', () => {
    const document = parseSvg(source, { fileName: 'mask.svg', global: DEFAULT_GLOBAL_SETTINGS });
    const shape = collectShapes(document.root).find((node) => node.id === 'plate');
    expect(shape?.maskInclude?.length).toBeGreaterThan(0);

    const resolved = resolveLeaves({ document, settings: {}, global: DEFAULT_GLOBAL_SETTINGS });
    const leaf = resolved.leaves.find((item) => item.id === 'plate');
    expect(leaf?.mask?.include.length).toBeGreaterThan(0);
  });

  it('removes the masked-out area from the model', () => {
    const document = parseSvg(source, { fileName: 'mask.svg', global: DEFAULT_GLOBAL_SETTINGS });
    const resolved = resolveLeaves({ document, settings: {}, global: DEFAULT_GLOBAL_SETTINGS });
    const built = buildModel({ api, leaves: resolved.leaves });
    const withoutMask = buildModel({
      api,
      leaves: resolved.leaves.map((leaf) => ({ ...leaf, mask: undefined })),
    });
    expect(built.stats.volume).toBeGreaterThan(0);
    expect(withoutMask.stats.volume).toBeCloseTo(built.stats.volume * 2, 0);
  });
});
