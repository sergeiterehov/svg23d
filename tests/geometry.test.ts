import { beforeAll, describe, expect, it } from 'vitest';
import type { ManifoldToplevel } from 'manifold-3d';
import { loadManifold } from './helpers/manifold';
import { buildPrism } from '@core/geometry/extrude';
import { sectionFromContours, offsetSection } from '@core/geometry/section';
import { buildModel } from '@core/solver/buildModel';
import type { Contour, ResolvedLeaf } from '@core/model/types';

const square = (size: number, offsetX = 0, offsetY = 0): Contour[] => [
  [
    { x: offsetX, y: offsetY },
    { x: offsetX + size, y: offsetY },
    { x: offsetX + size, y: offsetY + size },
    { x: offsetX, y: offsetY + size },
  ],
];

function makeLeaf(overrides: Partial<ResolvedLeaf> & { id: string }): ResolvedLeaf {
  return {
    name: overrides.id,
    partId: overrides.id,
    partName: overrides.id,
    order: 0,
    contours: square(100),
    fillRule: 'nonzero',
    color: '#ff0000',
    zFrom: 0,
    zTo: 2,
    clearance: 0,
    chamferTop: 0,
    chamferBottom: 0,
    hidden: false,
    ...overrides,
  };
}

let api: ManifoldToplevel;

beforeAll(async () => {
  api = await loadManifold();
});

describe('extrusion', () => {
  it('produces the expected volume for a plain prism', () => {
    const section = sectionFromContours(api, square(100), 'nonzero');
    const solid = buildPrism(api, section, { zFrom: 0, zTo: 2 });
    expect(solid.volume()).toBeCloseTo(20000, 1);
    expect(solid.genus()).toBe(0);
    solid.delete();
    section.delete();
  });

  it('offsets a section by the expected area', () => {
    const section = sectionFromContours(api, square(100), 'nonzero');
    const grown = offsetSection(section, 1);
    // perimeter * d + pi * d^2 for round joins
    expect(grown.area() - section.area()).toBeGreaterThan(400);
    expect(grown.area() - section.area()).toBeLessThan(410);
    grown.delete();
    section.delete();
  });

  it('45° chamfer removes c²/2 per millimetre of perimeter', () => {
    const section = sectionFromContours(api, square(100), 'nonzero');
    const solid = buildPrism(api, section, {
      zFrom: 0,
      zTo: 2,
      chamferTop: 1,
      chamferBottom: 1,
    });
    // Each chamfer removes perimeter * c²/2 = 400 * 0.5 = 200 mm³ (plus corner rounding).
    expect(solid.volume()).toBeGreaterThan(19500);
    expect(solid.volume()).toBeLessThan(19620);
    solid.delete();
    section.delete();
  });

  it('chamfer is clamped when it exceeds the height', () => {
    const section = sectionFromContours(api, square(10), 'nonzero');
    const solid = buildPrism(api, section, {
      zFrom: 0,
      zTo: 1,
      chamferTop: 5,
      chamferBottom: 5,
    });
    expect(solid.volume()).toBeGreaterThan(0);
    solid.delete();
    section.delete();
  });
});

describe('assembly solver', () => {
  it('subtracts the upper part volume from the lower part', () => {
    const lower = makeLeaf({ id: 'lower', partId: 'A', order: 0, zFrom: 0, zTo: 2 });
    const upper = makeLeaf({
      id: 'upper',
      partId: 'B',
      order: 1,
      zFrom: 1,
      zTo: 3,
      contours: square(20, 40, 40),
    });

    const result = buildModel({ api, leaves: [lower, upper] });
    expect(result.parts).toHaveLength(2);

    const partA = result.parts.find((p) => p.partId === 'A');
    const partB = result.parts.find((p) => p.partId === 'B');
    expect(partA?.volume).toBeCloseTo(20000 - 400, 0);
    expect(partB?.volume).toBeCloseTo(800, 0);
  });

  it('leaves a clearance gap around the socket', () => {
    const lower = makeLeaf({ id: 'lower', partId: 'A', order: 0, zFrom: 0, zTo: 2 });
    const upper = makeLeaf({
      id: 'upper',
      partId: 'B',
      order: 1,
      zFrom: 1,
      zTo: 3,
      contours: square(20, 40, 40),
      clearance: 0.2,
    });

    const result = buildModel({ api, leaves: [lower, upper] });
    const partA = result.parts.find((p) => p.partId === 'A');
    const removed = 20000 - (partA?.volume ?? 0);
    // 20x20 hole plus 0.2 mm per side: 20.4^2 = 416.16 (a bit more because of round joins)
    expect(removed).toBeGreaterThan(415);
    expect(removed).toBeLessThan(425);
  });

  it('uses the clearance of the inserted (upper) element, not of the plate', () => {
    const circle = (radius: number): Contour[] => [
      Array.from({ length: 96 }, (_, index) => {
        const angle = (index / 96) * Math.PI * 2;
        return { x: 50 + radius * Math.cos(angle), y: 50 + radius * Math.sin(angle) };
      }),
    ];

    const plate = makeLeaf({
      id: 'plate',
      partId: 'A',
      order: 0,
      zFrom: 0,
      zTo: 2,
      // The plate's own clearance must not influence the hole made by the pin.
      clearance: 5,
    });
    const pin = makeLeaf({
      id: 'pin',
      partId: 'B',
      order: 1,
      zFrom: 0,
      zTo: 2,
      contours: circle(10),
      clearance: 0.2,
    });

    const result = buildModel({ api, leaves: [plate, pin] });
    const removed = 20000 - (result.parts.find((p) => p.partId === 'A')?.volume ?? 0);
    // Hole radius = 10 + 0.2, height 2 mm → volume ≈ π · 10.2² · 2 ≈ 653.7 mm³
    const expectedVolume = Math.PI * (10 + 0.2) ** 2 * 2;
    expect(removed).toBeGreaterThan(expectedVolume * 0.97);
    expect(removed).toBeLessThan(expectedVolume * 1.03);
    // With the plate's own clearance (5 mm) the hole would be far larger.
    expect(removed).toBeLessThan(Math.PI * (10 + 5) ** 2 * 2);
  });

  it('does not cut inside a single part', () => {
    const a = makeLeaf({ id: 'a', partId: 'A', order: 0, zFrom: 0, zTo: 2 });
    const b = makeLeaf({ id: 'b', partId: 'A', order: 1, zFrom: 1, zTo: 3 });

    const result = buildModel({ api, leaves: [a, b] });
    expect(result.parts).toHaveLength(1);
    expect(result.parts[0].volume).toBeCloseTo(30000, 0);
  });

  it('ignores parts that do not overlap in Z', () => {
    const lower = makeLeaf({ id: 'lower', partId: 'A', order: 0, zFrom: 0, zTo: 2 });
    const upper = makeLeaf({
      id: 'upper',
      partId: 'B',
      order: 1,
      zFrom: 2.5,
      zTo: 3,
      contours: square(20, 40, 40),
    });

    const result = buildModel({ api, leaves: [lower, upper] });
    const partA = result.parts.find((p) => p.partId === 'A');
    expect(partA?.volume).toBeCloseTo(20000, 0);
  });

  it('mirrors the chamfer in the socket', () => {
    const lower = makeLeaf({ id: 'lower', partId: 'A', order: 0, zFrom: 0, zTo: 2 });
    const upper = makeLeaf({
      id: 'upper',
      partId: 'B',
      order: 1,
      zFrom: 0,
      zTo: 2,
      contours: square(20, 40, 40),
      chamferTop: 1,
    });

    const result = buildModel({ api, leaves: [lower, upper] });
    const partA = result.parts.find((p) => p.partId === 'A');
    const partB = result.parts.find((p) => p.partId === 'B');
    // The socket is slightly larger than the part because the ghost carries the same chamfer.
    expect(partB?.volume).toBeLessThan(800);
    expect(20000 - (partA?.volume ?? 0)).toBeGreaterThan(partB?.volume ?? 0);
  });

  it('warns when an element is completely cut away by a higher one', () => {
    const lower = makeLeaf({
      id: 'lower',
      partId: 'A',
      order: 0,
      zFrom: 0,
      zTo: 2,
      contours: square(20),
    });
    const upper = makeLeaf({
      id: 'upper',
      partId: 'B',
      order: 1,
      zFrom: 0,
      zTo: 2,
      contours: square(100),
    });

    const result = buildModel({ api, leaves: [lower, upper] });
    expect(result.parts).toHaveLength(1);
    expect(result.warnings.some((warning) => warning.code === 'fully-cut')).toBe(true);
    expect(result.warnings.find((warning) => warning.code === 'fully-cut')?.nodeId).toBe('lower');
  });
});

describe('hidden elements (ADR-0035)', () => {
  it('keeps a hidden element in the model and only drops it from the display set', () => {
    const plate = makeLeaf({ id: 'plate', partId: 'A', order: 0, zFrom: 0, zTo: 2 });
    const pin = makeLeaf({
      id: 'pin',
      partId: 'B',
      order: 1,
      zFrom: 0,
      zTo: 2,
      contours: square(20, 40, 40),
      hidden: true,
    });

    const result = buildModel({ api, leaves: [plate, pin] });
    // The model is untouched: the pin is still printed and still cuts its socket in the plate.
    expect(result.parts.map((part) => part.partId).sort()).toEqual(['A', 'B']);
    expect(result.parts.find((part) => part.partId === 'A')?.volume).toBeCloseTo(20000 - 800, 0);
    expect(result.stats.partCount).toBe(2);

    // The view gets the plate only.
    expect(result.displayParts.map((part) => part.partId)).toEqual(['A']);
  });

  it('rebuilds a part without its hidden leaves', () => {
    const a = makeLeaf({ id: 'a', partId: 'A', order: 0, zFrom: 0, zTo: 2 });
    const b = makeLeaf({
      id: 'b',
      partId: 'A',
      order: 1,
      zFrom: 0,
      zTo: 2,
      // Sticks out of the plate, so the drawn body is visibly smaller than the printed one.
      contours: square(20, 90, 40),
      hidden: true,
    });

    const result = buildModel({ api, leaves: [a, b] });
    expect(result.parts[0].volume).toBeCloseTo(20000 + 10 * 20 * 2, 0);
    expect(result.displayParts[0].volume).toBeCloseTo(20000, 0);
    // The display mesh is a different body: the hidden leaf is not in it.
    expect(result.displayParts[0].triangleCount).toBeLessThan(result.parts[0].triangleCount);
  });

  it('shares one mesh when nothing is hidden', () => {
    const leaf = makeLeaf({ id: 'a' });
    const result = buildModel({ api, leaves: [leaf] });
    expect(result.displayParts[0]).toBe(result.parts[0]);
  });
});
