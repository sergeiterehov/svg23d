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

/** Z range of level `n` (0 = the bottom part): 5 mm tall, 1 mm of it sunk into the level below. */
function level(n: number): [number, number] {
  const zFrom = n * (LAYER_MM - SINK_MM);
  return [zFrom, zFrom + LAYER_MM];
}

function ranges(source: string): Array<{ id: string; range: [number, number] }> {
  const document = parseSvg(source, { fileName: 'sample.svg', global: DEFAULT_GLOBAL_SETTINGS });
  const settings = distributeLayers(document.root, {}, DEFAULT_GLOBAL_SETTINGS);
  return findPartRoots(document.root, settings).map((id) => ({
    id,
    range: [settings[id]?.zFrom ?? NaN, settings[id]?.zTo ?? NaN],
  }));
}

describe('distributeLayers', () => {
  it('builds a staircase: every part is one level and ends higher than the part below', () => {
    // Paint order (bottom part first) becomes the stack order.
    expect(ranges(landscape)).toEqual([
      { id: 'sky', range: level(0) },
      { id: 'sun', range: level(1) },
      { id: 'hill', range: level(2) },
      { id: 'trunk', range: level(3) },
      { id: 'crown', range: level(4) },
      { id: 'crown-2', range: level(5) },
    ]);
  });

  it('gives the HTML5 logo five distinct protrusion heights', () => {
    const result = ranges(html5);
    expect(result.map((item) => item.range)).toEqual([
      level(0),
      level(1),
      level(2),
      level(3),
      level(4),
    ]);
    // Every top is unique — this is what "разная высота выступа" means.
    const tops = result.map((item) => item.range[1]);
    expect(new Set(tops).size).toBe(tops.length);
  });

  it('keeps the level thickness and the sink constant', () => {
    for (const { range } of ranges(landscape)) {
      expect(range[1] - range[0]).toBe(LAYER_MM);
    }
    const result = ranges(landscape).map((item) => item.range[0]);
    for (let i = 1; i < result.length; i += 1) {
      expect(result[i] - result[i - 1]).toBe(LAYER_MM - SINK_MM);
    }
  });
});
