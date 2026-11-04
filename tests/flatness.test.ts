// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from 'vitest';
import type { ManifoldToplevel } from 'manifold-3d';
import { loadManifold } from './helpers/manifold';
import { DEFAULT_GLOBAL_SETTINGS } from '@core/model/defaults';
import type { GlobalSettings } from '@core/model/types';
import { parseSvg } from '@core/svg/parseSvg';
import { resolveLeaves } from '@core/solver/resolveLeaves';
import { buildModel } from '@core/solver/buildModel';

/**
 * «Качество кривых» is the flattening tolerance of the curves, in mm. It is applied when the SVG is
 * parsed (ADR-0030), so the store re-parses the source when the setting changes — otherwise the
 * number in the panel would only move the slider and never the triangle count.
 */

const source = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
  <circle id="disc" cx="50" cy="50" r="40" fill="#ff0000"/>
</svg>`;

function globalWith(flatness: number): GlobalSettings {
  return { ...DEFAULT_GLOBAL_SETTINGS, flatness };
}

function parseWith(flatness: number) {
  const global = globalWith(flatness);
  const document = parseSvg(source, { fileName: 'disc.svg', global });
  const resolved = resolveLeaves({ document, settings: {}, global });
  return { document, leaves: resolved.leaves };
}

function contourPoints(flatness: number): number {
  const { leaves } = parseWith(flatness);
  return leaves.reduce(
    (sum, leaf) => sum + leaf.contours.reduce((count, contour) => count + contour.length, 0),
    0,
  );
}

let api: ManifoldToplevel;
beforeAll(async () => {
  api = await loadManifold();
});

describe('curve quality', () => {
  it('flattens the same circle into more points with a finer tolerance', () => {
    const coarse = contourPoints(0.05);
    const fine = contourPoints(0.005);
    expect(coarse).toBeGreaterThan(8);
    expect(fine).toBeGreaterThan(coarse * 1.5);
  });

  it('changes the triangle count of the built model', () => {
    const coarse = buildModel({ api, leaves: parseWith(0.05).leaves });
    const fine = buildModel({ api, leaves: parseWith(0.005).leaves });
    expect(fine.stats.triangleCount).toBeGreaterThan(coarse.stats.triangleCount);
  });

  it('keeps the printed volume: only the outline gets smoother', () => {
    const coarse = buildModel({ api, leaves: parseWith(0.05).leaves });
    const fine = buildModel({ api, leaves: parseWith(0.005).leaves });
    const relative = Math.abs(fine.stats.volume - coarse.stats.volume) / coarse.stats.volume;
    expect(relative).toBeLessThan(0.01);
  });

  it('keeps the tolerance in millimetres, so a smaller model gets a coarser polygon', () => {
    // 0.02 mm is 0.01 % of a 200 mm model but 0.1 % of a 20 mm one: the same absolute deviation
    // means fewer points once the model is scaled down.
    const big = { ...DEFAULT_GLOBAL_SETTINGS, fitSizeMm: 200, flatness: 0.02 };
    const small = { ...DEFAULT_GLOBAL_SETTINGS, fitSizeMm: 20, flatness: 0.02 };
    const points = (global: GlobalSettings): number => {
      const document = parseSvg(source, { fileName: 'disc.svg', global });
      return resolveLeaves({ document, settings: {}, global }).leaves[0].contours[0].length;
    };
    expect(points(small)).toBeLessThan(points(big));
  });
});
