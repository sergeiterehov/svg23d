// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { DEFAULT_GLOBAL_SETTINGS } from '@core/model/defaults';
import { createGrid, fillBox, rasterizeSubtree } from '@core/solver/footprint';
import { distributeLayers, LAYER_MM, SINK_MM } from '@core/solver/distribute';
import { findPartRoots } from '@core/solver/resolveLeaves';
import { parseSvg } from '@core/svg/parseSvg';

/** A square ring: outline 10…90 with a square hole 30…70 (even-odd). */
const RING_SVG =
  '<svg viewBox="0 0 100 100"><g>' +
  '<rect id="bg" x="0" y="0" width="100" height="100"/>' +
  '<path id="ring" fill-rule="evenodd" d="M10 10 H90 V90 H10 Z M30 30 H70 V70 H30 Z"/>' +
  '<rect id="dot" x="45" y="45" width="10" height="10"/>' +
  '</g></svg>';

function parse(source: string) {
  return parseSvg(source, { fileName: 'test.svg', global: DEFAULT_GLOBAL_SETTINGS });
}

function ranges(source: string): Record<string, [number, number]> {
  const document = parse(source);
  const settings = distributeLayers(document.root, {}, DEFAULT_GLOBAL_SETTINGS);
  const out: Record<string, [number, number]> = {};
  for (const id of findPartRoots(document.root, settings)) {
    out[id] = [settings[id]?.zFrom ?? NaN, settings[id]?.zTo ?? NaN];
  }
  return out;
}

describe('footprint raster', () => {
  it('leaves the hole of a ring empty', () => {
    const document = parse(RING_SVG);
    const ring = document.root.children[0]!.children.find((child) => child.id === 'ring')!;
    const grid = createGrid({ minX: 0, minY: 0, maxX: 100, maxY: 100 });
    const mask = new Uint8Array(grid.cols * grid.rows);
    rasterizeSubtree(ring, grid, mask, new Uint8Array(mask.length));

    const cellAt = (x: number, y: number): number => {
      const col = Math.floor((x - grid.minX) / grid.cell);
      const row = Math.floor((y - grid.minY) / grid.cell);
      return mask[row * grid.cols + col] as number;
    };
    expect(cellAt(20, 50)).toBe(1); // on the ring
    expect(cellAt(50, 20)).toBe(1); // on the ring
    expect(cellAt(50, 50)).toBe(0); // inside the hole
    expect(cellAt(2, 2)).toBe(0); // outside
    // An 80 × 80 outline with a 40 × 40 hole: 4800 of 10000 square units.
    const filled = mask.reduce((sum, value) => sum + value, 0);
    const expected = (4800 / (100 * 100)) * grid.cols * grid.rows;
    expect(filled).toBeGreaterThan(expected * 0.95);
    expect(filled).toBeLessThan(expected * 1.05);
  });

  it('marks a box when a shape is too thin to hit a cell', () => {
    const grid = createGrid({ minX: 0, minY: 0, maxX: 100, maxY: 100 });
    const mask = new Uint8Array(grid.cols * grid.rows);
    fillBox({ minX: 40, minY: 40, maxX: 42, maxY: 42 }, grid, mask);
    expect(mask.reduce((sum, value) => sum + value, 0)).toBeGreaterThan(0);
  });
});

describe('distributeLayers with rasterised footprints', () => {
  it('rests a dot inside the hole of a ring on the background, not on the ring', () => {
    const result = ranges(RING_SVG);
    expect(result.bg).toEqual([0, 30]);
    expect(result.ring).toEqual([29.5, 35]);
    // The ring's box contains the dot, but there is no material under it: the dot stands on the
    // background instead of balancing on the stroke.
    expect(result.dot).toEqual([30 - SINK_MM, 30 + LAYER_MM]);
  });

  it('still stacks a part that really is inside another one', () => {
    const result = ranges(
      '<svg viewBox="0 0 100 100"><g>' +
        '<rect id="bg" x="0" y="0" width="100" height="100"/>' +
        '<rect id="block" x="20" y="20" width="60" height="60"/>' +
        '<rect id="bar" x="40" y="40" width="20" height="20"/>' +
        '</g></svg>',
    );
    expect(result.block).toEqual([29.5, 35]);
    // `bar` sits on the block: 35 − 0.5 … 35 + 5.
    expect(result.bar).toEqual([35 - SINK_MM, 35 + LAYER_MM]);
  });
});
