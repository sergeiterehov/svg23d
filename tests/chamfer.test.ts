import { beforeAll, describe, expect, it } from 'vitest';
import type { ManifoldToplevel } from 'manifold-3d';
import { loadManifold } from './helpers/manifold';
import { buildPrism } from '@core/geometry/extrude';
import { sectionFromContours } from '@core/geometry/section';
import type { Contour } from '@core/model/types';

const square = (size: number, offsetX = 0, offsetY = 0): Contour => [
  { x: offsetX, y: offsetY },
  { x: offsetX + size, y: offsetY },
  { x: offsetX + size, y: offsetY + size },
  { x: offsetX, y: offsetY + size },
];

let api: ManifoldToplevel;

beforeAll(async () => {
  api = await loadManifold();
});

describe('45° chamfers (ADR-0040)', () => {
  it('lofts the slope instead of stacking layers', () => {
    const section = sectionFromContours(api, [square(100)], 'nonzero');
    const solid = buildPrism(api, section, { zFrom: 0, zTo: 10, chamferBottom: 1, chamferTop: 1 });
    // The stepped build produced tens of thousands of triangles for the same shape.
    expect(solid.numTri()).toBeLessThan(100);
    // ∫(98 + 2z)² dz over each chamfer plus the straight middle.
    const frustum = (100 ** 3 - 98 ** 3) / 6;
    expect(solid.volume()).toBeCloseTo(frustum * 2 + 100 * 100 * 8, 0);
    solid.delete();
    section.delete();
  });

  it('keeps the profile exactly 45°', () => {
    const section = sectionFromContours(api, [square(100)], 'nonzero');
    const solid = buildPrism(api, section, { zFrom: 0, zTo: 10, chamferBottom: 2, chamferTop: 2 });

    // At half a millimetre above the bottom the square is inset by 1.5 mm: 97 × 97.
    const low = solid.slice(0.5);
    expect(low.area()).toBeCloseTo(97 * 97, 0);
    low.delete();
    // In the middle nothing is cut away.
    const middle = solid.slice(5);
    expect(middle.area()).toBeCloseTo(100 * 100, 0);
    middle.delete();
    // Half a millimetre below the top the same inset as at the bottom.
    const high = solid.slice(9.5);
    expect(high.area()).toBeCloseTo(97 * 97, 0);
    high.delete();

    solid.delete();
    section.delete();
  });

  it('chamfers a hole outwards', () => {
    const hole = square(20, 40, 40).slice().reverse();
    const section = sectionFromContours(api, [square(100), hole], 'nonzero');
    const solid = buildPrism(api, section, { zFrom: 0, zTo: 10, chamferBottom: 2, chamferTop: 0 });
    const low = solid.slice(0.5);
    // Outer 97 × 97, the hole grows by 1.5 mm per side: 23 × 23.
    expect(low.area()).toBeCloseTo(97 * 97 - 23 * 23, 0);
    low.delete();
    solid.delete();
    section.delete();
  });

  it('falls back gracefully when the inset splits a thin neck', () => {
    // Two plates joined by a 1 mm bridge: a 2 mm chamfer cannot be lofted ring by ring.
    const bridge: Contour = [
      { x: 0, y: 99.5 },
      { x: 60, y: 99.5 },
      { x: 60, y: 100.5 },
      { x: 0, y: 100.5 },
    ];
    const section = sectionFromContours(
      api,
      [square(40, 0, 80), square(40, 20, 120), bridge],
      'nonzero',
    );
    const solid = buildPrism(api, section, { zFrom: 0, zTo: 10, chamferBottom: 2, chamferTop: 2 });
    expect(solid.volume()).toBeGreaterThan(0);
    expect(solid.status()).toBe('NoError');
    solid.delete();
    section.delete();
  });
});
