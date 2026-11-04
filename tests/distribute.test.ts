// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_GLOBAL_SETTINGS } from '@core/model/defaults';
import { distributeLayers, LAYER_MM, SINK_MM } from '@core/solver/distribute';
import { findPartRoots } from '@core/solver/resolveLeaves';
import { parseSvg } from '@core/svg/parseSvg';

const landscape = readFileSync(resolve(process.cwd(), 'samples/landscape.svg'), 'utf8');
const html5 = readFileSync(resolve(process.cwd(), 'samples/html5.svg'), 'utf8');

const BASE_FROM = DEFAULT_GLOBAL_SETTINGS.defaultZFrom;
const BASE_TO = DEFAULT_GLOBAL_SETTINGS.defaultZTo;

/** Element that intersects nothing: it stands on the project base. */
const base: [number, number] = [BASE_FROM, BASE_TO];
/** Element sunk `SINK_MM` into a support whose top is `supportTop` and reaching `top` in mm. */
function band(supportTop: number, top: number): [number, number] {
  return [supportTop - SINK_MM, top];
}
/** Element standing on the base plate (top `BASE_TO`) and reaching `top` in mm. */
const onBase = (top: number): [number, number] => band(BASE_TO, top);

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
  it('derives each landscape height from the parts visible under it', () => {
    // The trunk is drawn inside the hill, so the sky behind the hill is hidden and the trunk stands on
    // the hill (35). The crowns stick out above the hill: they see the sky and reach down to it (30 −
    // 0.5), while their tops follow the highest part they cross.
    expect(ranges(landscape)).toEqual({
      sky: base,
      sun: onBase(BASE_TO + LAYER_MM),
      hill: onBase(BASE_TO + LAYER_MM),
      trunk: band(BASE_TO + LAYER_MM, BASE_TO + 2 * LAYER_MM),
      crown: onBase(BASE_TO + 3 * LAYER_MM),
      'crown-2': onBase(BASE_TO + 4 * LAYER_MM),
    });
  });

  it('sinks every element into the part under it instead of resting on its surface', () => {
    const result = ranges(landscape);
    expect(result.sun[0]).toBe(result.sky[1] - SINK_MM);
    expect(result.trunk[0]).toBe(result.hill[1] - SINK_MM);
    expect(result.crown[0]).toBe(result.sky[1] - SINK_MM);
  });

  it('ignores a layer hidden behind a later one', () => {
    const result = ranges(landscape);
    // The trunk lies inside the hill, so it is built from the hill, not from the sky behind it.
    expect(result.trunk[0]).toBe(result.hill[1] - SINK_MM);
    // The crowns still cross the sky: it is their lowest support.
    expect(result.crown[0]).toBe(result.sky[1] - SINK_MM);
    expect(result['crown-2'][0]).toBe(result.sky[1] - SINK_MM);
  });

  it('puts the crowns above the trunk', () => {
    const result = ranges(landscape);
    expect(result.crown[1]).toBeGreaterThan(result.trunk[1]);
    expect(result['crown-2'][1]).toBeGreaterThan(result.trunk[1]);
  });

  it('treats an element under a container as standing on the container', () => {
    const source =
      '<svg viewBox="0 0 100 100"><g>' +
      '<rect id="plate" x="0" y="0" width="100" height="100"/>' +
      '<rect id="block" x="20" y="20" width="60" height="60"/>' +
      '<rect id="bar" x="20" y="40" width="60" height="20"/>' +
      '</g></svg>';
    const result = ranges(source);
    expect(result.plate).toEqual(base);
    expect(result.block).toEqual(onBase(BASE_TO + LAYER_MM));
    // The bar is drawn inside the block, so the plate under the block does not count.
    expect(result.bar).toEqual(band(BASE_TO + LAYER_MM, BASE_TO + 2 * LAYER_MM));
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
      '<rect id="low" x="0" y="0" width="60" height="60"/>' +
      '<rect id="high" x="40" y="40" width="60" height="60"/>' +
      '<rect id="bridge" x="30" y="30" width="40" height="40"/>' +
      '</g></svg>';
    const result = ranges(source);
    expect(result.low).toEqual(base);
    expect(result.high).toEqual(onBase(BASE_TO + LAYER_MM));
    // `bridge` crosses both edges and is contained by neither: the lower one gives the bottom (minus the
    // sink), the higher one the top.
    expect(result.bridge).toEqual([result.low[1] - SINK_MM, result.high[1] + LAYER_MM]);
  });

  it('puts every later HTML5 shape above the ones it overlaps', () => {
    const values = Object.values(ranges(html5));
    // No background in the logo, so the first shape is the base plate of the stack.
    expect(values[0]).toEqual(base);
    const tops = values.map((value) => value[1]);
    for (let i = 1; i < tops.length; i += 1) expect(tops[i]).toBeGreaterThanOrEqual(tops[i - 1]);
  });
});
