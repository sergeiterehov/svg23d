// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_GLOBAL_SETTINGS } from '@core/model/defaults';
import { distributeLayers, LAYER_MM } from '@core/solver/distribute';
import { findPartRoots } from '@core/solver/resolveLeaves';
import { parseSvg } from '@core/svg/parseSvg';

const landscape = readFileSync(resolve(process.cwd(), 'samples/landscape.svg'), 'utf8');
const html5 = readFileSync(resolve(process.cwd(), 'samples/html5.svg'), 'utf8');

const BASE_FROM = DEFAULT_GLOBAL_SETTINGS.defaultZFrom;
const BASE_TO = DEFAULT_GLOBAL_SETTINGS.defaultZTo;

/** Element with no intersections rests on the project defaults. */
const base: [number, number] = [BASE_FROM, BASE_TO];
/** Element built on top of intersections whose highest top is `BASE_TO`. */
function above(steps = 1): [number, number] {
  return [BASE_FROM, BASE_TO + steps * LAYER_MM];
}

function ranges(source: string): Record<string, [number, number]> {
  const document = parseSvg(source, { fileName: 'sample.svg', global: DEFAULT_GLOBAL_SETTINGS });
  const settings = distributeLayers(document.root, {}, DEFAULT_GLOBAL_SETTINGS);
  const out: Record<string, [number, number]> = {};
  for (const id of findPartRoots(document.root, settings)) {
    out[id] = [settings[id]?.zFrom ?? NaN, settings[id]?.zTo ?? NaN];
  }
  return out;
}

describe('distributeLayers', () => {
  it('derives each landscape height from what the element intersects', () => {
    // sky is the plate; sun and hill only meet the sky, so both end 5 mm above it; the trunk is
    // crossed by the crowns, so each crown ends above the trunk instead of the other way round.
    expect(ranges(landscape)).toEqual({
      sky: base,
      sun: above(1),
      hill: above(1),
      trunk: above(2),
      crown: above(3),
      'crown-2': above(4),
    });
  });

  it('puts every later HTML5 shape above the ones it overlaps', () => {
    const result = ranges(html5);
    const values = Object.values(result);
    expect(values[0]).toEqual(base);
    for (const value of values.slice(1)) expect(value[0]).toBe(BASE_FROM);
    // Tops strictly grow along the paint order (each shape overlaps the previous one).
    const tops = values.map((value) => value[1]);
    for (let i = 1; i < tops.length; i += 1) expect(tops[i]).toBeGreaterThanOrEqual(tops[i - 1]);
  });

  it('keeps fully disjoint elements on the project defaults', () => {
    const source =
      '<svg viewBox="0 0 100 100"><g>' +
      '<rect x="0" y="0" width="40" height="40"/>' +
      '<rect x="60" y="60" width="40" height="40"/>' +
      '</g></svg>';
    const values = Object.values(ranges(source));
    expect(values).toHaveLength(2);
    for (const range of values) expect(range).toEqual(base);
  });

  it('spans from the lowest bottom to 5 mm above the highest top of the intersections', () => {
    const source =
      '<svg viewBox="0 0 100 100"><g>' +
      '<rect id="base" x="0" y="0" width="100" height="100"/>' +
      '<rect id="block" x="20" y="20" width="60" height="60"/>' +
      '<rect id="bar" x="0" y="40" width="100" height="20"/>' +
      '</g></svg>';
    const result = ranges(source);
    expect(result.base).toEqual(base);
    expect(result.block).toEqual(above(1));
    // The bar crosses both the base and the block, so it ends above the block.
    expect(result.bar).toEqual(above(2));
  });
});
