import { describe, expect, it } from 'vitest';
import { flattenPathData } from '@core/svg/flatten';
import { contourArea } from '@core/svg/units';

const TOL = 0.01;

function area(path: string): number {
  const contours = flattenPathData(path, TOL);
  return contours.reduce((sum, contour) => sum + Math.abs(contourArea(contour)), 0);
}

describe('path flattening', () => {
  it('parses absolute and relative line commands', () => {
    expect(area('M0 0 L10 0 L10 10 L0 10 Z')).toBeCloseTo(100, 6);
    expect(area('M0 0 l10 0 l0 10 l-10 0 z')).toBeCloseTo(100, 6);
  });

  it('handles implicit lineto after moveto', () => {
    expect(area('M0 0 10 0 10 10 0 10 Z')).toBeCloseTo(100, 6);
  });

  it('closes subpaths implicitly (fill semantics)', () => {
    expect(area('M0 0 L10 0 L10 10')).toBeCloseTo(50, 6);
  });

  it('flattens cubic curves close to the analytic area', () => {
    // A circle of radius 10 approximated with four cubics.
    const k = 0.5522847498307936 * 10;
    const d = [
      'M10 0',
      `C10 ${k} ${k} 10 0 10`,
      `C${-k} 10 -10 ${k} -10 0`,
      `C-10 ${-k} ${-k} -10 0 -10`,
      `C${k} -10 10 ${-k} 10 0`,
      'Z',
    ].join(' ');
    const result = area(d);
    expect(result).toBeGreaterThan(Math.PI * 100 * 0.995);
    expect(result).toBeLessThan(Math.PI * 100 * 1.005);
  });

  it('flattens elliptical arcs (A command)', () => {
    const result = area('M10 0 A10 10 0 1 1 -10 0 A10 10 0 1 1 10 0 Z');
    expect(result).toBeGreaterThan(Math.PI * 100 * 0.995);
    expect(result).toBeLessThan(Math.PI * 100 * 1.005);
  });

  it('parses compact arc flags without separators', () => {
    // "a5 5 0 0110 0" → rx=5 ry=5 rot=0 largeArc=0 sweep=1 dx=10 dy=0
    const contours = flattenPathData('M0 0 a5 5 0 0110 0 Z', TOL);
    expect(contours.length).toBe(1);
    expect(contours[0].length).toBeGreaterThan(3);
  });

  it('keeps holes as separate rings', () => {
    const contours = flattenPathData('M0 0 H10 V10 H0 Z M2 2 H8 V8 H2 Z', TOL);
    expect(contours).toHaveLength(2);
  });

  it('handles quadratic and smooth curves', () => {
    expect(area('M0 0 Q5 10 10 0 Z')).toBeCloseTo(33.33, 0);
    // The "S" reflection must produce a straight continuation here, so the contour closes flat.
    const contours = flattenPathData('M0 0 C0 10 10 10 10 0 S20 -10 20 0 Z', TOL);
    expect(contours).toHaveLength(1);
    expect(contours[0].length).toBeGreaterThan(6);
  });
});
