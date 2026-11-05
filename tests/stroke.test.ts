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
  return strokeSection(subpaths, width, 'round', caps).area;
}

/** Union of the stroke pieces as the solver sees it: rings, vertices and area. */
function strokeSection(
  subpaths: FlatSubpath[],
  width: number,
  linejoin: 'miter' | 'round' | 'bevel',
  linecap: 'butt' | 'round' | 'square' = 'butt',
): { polygons: Array<Array<[number, number]>>; area: number } {
  const contours = strokeToContours(subpaths, {
    width,
    linecap,
    linejoin,
    tolerance: 0.001,
  });
  const section = sectionFromContours(api, contours, 'nonzero');
  const area = section.area();
  const polygons = section.toPolygons() as Array<Array<[number, number]>>;
  section.delete();
  return { polygons, area };
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

  it('honours miter and bevel joins at corners', () => {
    // Outer 12×12 minus inner 8×8; miter keeps the corners square, bevel cuts ½ per corner.
    expect(strokeSection([closedSquare], 2, 'miter').area).toBeCloseTo(80, 3);
    expect(strokeSection([closedSquare], 2, 'bevel').area).toBeCloseTo(78, 1);
  });
});

describe('smooth stroke outlines', () => {
  const circle = (radius: number, segments: number): FlatSubpath => ({
    points: Array.from({ length: segments }, (_, i) => {
      const angle = (i / segments) * Math.PI * 2;
      return { x: radius * Math.cos(angle), y: radius * Math.sin(angle) };
    }),
    closed: true,
  });

  it('places one offset point per sample instead of a disc at every vertex', () => {
    // Regression for the ripple: the union used to contain the envelope of one disc per vertex —
    // about 8 boundary vertices per sample, each off the true offset by up to the tolerance.
    const segments = 96;
    const { polygons } = strokeSection([circle(40, segments)], 4, 'round');
    expect(polygons).toHaveLength(2);
    const vertices = polygons.flat();
    expect(vertices.length).toBeLessThanOrEqual(2 * segments + 8);
    for (const [x, y] of vertices) {
      const radius = Math.hypot(x, y);
      expect(Math.min(Math.abs(radius - 42), Math.abs(radius - 38))).toBeLessThan(1e-6);
    }
  });

  it('matches the analytic area of a stroked circle', () => {
    const { area } = strokeSection([circle(40, 720)], 4, 'round');
    expect(area / (Math.PI * (42 ** 2 - 38 ** 2))).toBeCloseTo(1, 3);
  });

  it('fills the disc when the stroke is thicker than the radius of curvature', () => {
    const { polygons, area } = strokeSection([circle(2, 64)], 6, 'round');
    expect(polygons).toHaveLength(1);
    expect(area / (Math.PI * 25)).toBeCloseTo(1, 2);
  });
});

describe('name.svg (fill and stroke in one colour)', () => {
  const source = readFileSync(resolve(process.cwd(), 'samples/name.svg'), 'utf8');
  const document = parseSvg(source, { fileName: 'name.svg', global: DEFAULT_GLOBAL_SETTINGS });

  it('keeps the stroke band as a shape of the document', () => {
    const shapes = collectShapes(document.root);
    const stroke = shapes.find((node) => node.id.endsWith('#stroke'));
    expect(stroke).toBeDefined();
    expect(stroke?.fill).toBe('#ffffff');
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
    const object = document.root.children.find((node) => node.id === 's0');
    expect(object?.union).toBe(true);
    expect(object?.children.map((child) => child.id).sort()).toEqual(['s0#fill', 's0#stroke']);

    const resolved = resolveLeaves({ document, settings: {}, global: DEFAULT_GLOBAL_SETTINGS });
    const leaf = resolved.leaves.find((item) => item.id === 's0');
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
      settings: { 's0#stroke': { ignored: true } },
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
