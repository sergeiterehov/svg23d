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

/** Element that intersects nothing: it stands on the project base. */
const base: [number, number] = [BASE_FROM, BASE_TO];
/** Element standing on the base whose top is `steps` × 5 mm above the base top. */
function standing(steps = 1): [number, number] {
  return [BASE_TO, BASE_TO + steps * LAYER_MM];
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
    // Only the sky stands on the base; everything else rests on the top of what is under it, and the
    // trunk stops 5 mm above the highest crown it is crossed by — it stays underneath the crowns.
    expect(ranges(landscape)).toEqual({
      sky: base,
      sun: standing(1),
      hill: standing(1),
      trunk: standing(2),
      crown: standing(3),
      'crown-2': standing(4),
    });
  });

  it('keeps zero bottoms only for the elements that reach the base', () => {
    const result = ranges(landscape);
    expect(result.sky[0]).toBe(BASE_FROM);
    for (const [id, range] of Object.entries(result)) {
      if (id === 'sky') continue;
      expect(range[0]).toBeGreaterThan(BASE_FROM);
    }
  });

  it('puts every later HTML5 shape above the ones it overlaps', () => {
    const values = Object.values(ranges(html5));
    expect(values[0]).toEqual(base);
    for (const value of values.slice(1)) expect(value[0]).toBe(BASE_TO);
    // Tops never go down along the paint order (each shape overlaps one of the previous ones).
    const tops = values.map((value) => value[1]);
    for (let i = 1; i < tops.length; i += 1) expect(tops[i]).toBeGreaterThanOrEqual(tops[i - 1]);
  });

  it('keeps fully disjoint elements on the project base', () => {
    const source =
      '<svg viewBox="0 0 100 100"><g>' +
      '<rect x="0" y="0" width="40" height="40"/>' +
      '<rect x="60" y="60" width="40" height="40"/>' +
      '</g></svg>';
    const values = Object.values(ranges(source));
    expect(values).toHaveLength(2);
    for (const range of values) expect(range).toEqual(base);
  });

  it('stands on the top of the lowest intersection and ends 5 mm above the highest', () => {
    const source =
      '<svg viewBox="0 0 100 100"><g>' +
      '<rect id="plate" x="0" y="0" width="100" height="100"/>' +
      '<rect id="block" x="20" y="20" width="60" height="60"/>' +
      '<rect id="bar" x="0" y="40" width="100" height="20"/>' +
      '</g></svg>';
    const result = ranges(source);
    expect(result.plate).toEqual(base);
    expect(result.block).toEqual(standing(1));
    // The bar crosses both the plate (top 30) and the block (top 35): it starts at 30 and ends at 40.
    expect(result.bar).toEqual([BASE_TO, BASE_TO + 2 * LAYER_MM]);
  });
});
