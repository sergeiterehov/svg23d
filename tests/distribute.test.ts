// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_GLOBAL_SETTINGS } from '@core/model/defaults';
import { distributeLayers, LAYER_MM, SINK_MM } from '@core/solver/distribute';
import { findPartRoots } from '@core/solver/resolveLeaves';
import { parseSvg } from '@core/svg/parseSvg';

const landscape = readFileSync(resolve(process.cwd(), 'samples/landscape.svg'), 'utf8');

function ranges(source: string): Record<string, [number, number]> {
  const document = parseSvg(source, { fileName: 'sample.svg', global: DEFAULT_GLOBAL_SETTINGS });
  const settings = distributeLayers(document.root, {}, DEFAULT_GLOBAL_SETTINGS);
  const out: Record<string, [number, number]> = {};
  for (const id of findPartRoots(document.root, settings)) {
    const node = id;
    out[node] = [settings[id]?.zFrom ?? NaN, settings[id]?.zTo ?? NaN];
  }
  return out;
}

describe('distributeLayers', () => {
  it('stacks the landscape parts into 5 mm layers sunk 1 mm into the lowest one below', () => {
    // sky covers everything; the details all sit on it (and on each other), so they sink into the
    // sky — the lowest layer under them — instead of climbing on top of each other.
    expect(ranges(landscape)).toEqual({
      sky: [0, LAYER_MM],
      sun: [LAYER_MM - SINK_MM, LAYER_MM * 2 - SINK_MM],
      hill: [LAYER_MM - SINK_MM, LAYER_MM * 2 - SINK_MM],
      trunk: [LAYER_MM - SINK_MM, LAYER_MM * 2 - SINK_MM],
      crown: [LAYER_MM - SINK_MM, LAYER_MM * 2 - SINK_MM],
      'crown-2': [LAYER_MM - SINK_MM, LAYER_MM * 2 - SINK_MM],
    });
  });

  it('keeps parts that do not overlap on the same layer', () => {
    const source =
      '<svg viewBox="0 0 100 100"><g>' +
      '<rect x="0" y="0" width="40" height="40"/>' +
      '<rect x="60" y="60" width="40" height="40"/>' +
      '</g></svg>';
    const result = ranges(source);
    const values = Object.values(result);
    expect(values).toHaveLength(2);
    for (const [zFrom, zTo] of values) {
      expect(zFrom).toBe(0);
      expect(zTo).toBe(LAYER_MM);
    }
  });

  it('sinks into the lowest of several layers below', () => {
    // The big plate is the base; the middle block stands on it; the thin bar covers both.
    const source =
      '<svg viewBox="0 0 100 100"><g>' +
      '<rect id="base" x="0" y="0" width="100" height="100"/>' +
      '<rect id="block" x="20" y="20" width="60" height="60"/>' +
      '<rect id="bar" x="0" y="40" width="100" height="20"/>' +
      '</g></svg>';
    const result = ranges(source);
    expect(result.base).toEqual([0, LAYER_MM]);
    expect(result.block).toEqual([LAYER_MM - SINK_MM, LAYER_MM * 2 - SINK_MM]);
    // Sleeps on the base, not on the raised block (that would be 8–13): it cuts through both.
    expect(result.bar).toEqual([LAYER_MM - SINK_MM, LAYER_MM * 2 - SINK_MM]);
  });
});
