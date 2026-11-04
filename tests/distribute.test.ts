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

/** Z range of a layer `n` steps above the plate. */
function layer(n: number): [number, number] {
  const zFrom = n * (LAYER_MM - SINK_MM);
  return [zFrom, zFrom + LAYER_MM];
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
  it('stands each landscape element on the layer that covers it', () => {
    // sky covers everything → it is the base. Sun and hill only lie on the sky, so they share
    // layer 1. The hill covers the trunk → the trunk climbs onto it. The crowns stick out above
    // the hill, so nothing but the sky covers them: they stay on layer 1.
    expect(ranges(landscape)).toEqual({
      sky: layer(0),
      sun: layer(1),
      hill: layer(1),
      trunk: layer(2),
      crown: layer(1),
      'crown-2': layer(1),
    });
  });

  it('does not stack elements that only touch each other', () => {
    // HTML5 shapes overlap along their edges but never cover one another, so they end up in the
    // same band above the first one.
    const result = ranges(html5);
    const values = Object.values(result);
    expect(values[0]).toEqual(layer(0));
    for (const value of values.slice(1)) expect(value).toEqual(layer(1));
  });

  it('keeps fully disjoint elements on the base layer', () => {
    const source =
      '<svg viewBox="0 0 100 100"><g>' +
      '<rect x="0" y="0" width="40" height="40"/>' +
      '<rect x="60" y="60" width="40" height="40"/>' +
      '</g></svg>';
    const values = Object.values(ranges(source));
    expect(values).toHaveLength(2);
    for (const range of values) expect(range).toEqual(layer(0));
  });

  it('stacks crossing elements on the higher one and keeps a covered element on its cover', () => {
    // The bar spans wider than the block, so it is not covered by it — it crosses the block and
    // lands on the block's level. Nothing else climbs.
    const source =
      '<svg viewBox="0 0 100 100"><g>' +
      '<rect id="base" x="0" y="0" width="100" height="100"/>' +
      '<rect id="block" x="20" y="20" width="60" height="60"/>' +
      '<rect id="bar" x="0" y="40" width="100" height="20"/>' +
      '</g></svg>';
    const result = ranges(source);
    expect(result.base).toEqual(layer(0));
    expect(result.block).toEqual(layer(1));
    expect(result.bar).toEqual(layer(1));
  });
});
