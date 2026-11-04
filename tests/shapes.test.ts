import { describe, expect, it } from 'vitest';
import { contourArea } from '@core/svg/units';
import { shapeToContours } from '@core/svg/shapes';

const TOL = 0.01;

function attrs(map: Record<string, string>): (name: string) => string | null {
  return (name) => map[name] ?? null;
}

describe('basic shapes', () => {
  it('rect', () => {
    const { contours } = shapeToContours('rect', attrs({ x: '0', y: '0', width: '10', height: '20' }), TOL);
    expect(contours).toHaveLength(1);
    expect(Math.abs(contourArea(contours[0]))).toBeCloseTo(200, 6);
  });

  it('rounded rect keeps its area (minus corners)', () => {
    const { contours } = shapeToContours(
      'rect',
      attrs({ x: '0', y: '0', width: '10', height: '10', rx: '2' }),
      0.001,
    );
    const expected = 100 - 4 * (4 - Math.PI);
    expect(Math.abs(contourArea(contours[0]))).toBeCloseTo(expected, 1);
  });

  it('circle', () => {
    const { contours } = shapeToContours('circle', attrs({ cx: '5', cy: '5', r: '5' }), TOL);
    expect(Math.abs(contourArea(contours[0]))).toBeCloseTo(Math.PI * 25, 1);
  });

  it('ellipse', () => {
    const { contours } = shapeToContours(
      'ellipse',
      attrs({ cx: '0', cy: '0', rx: '10', ry: '5' }),
      TOL,
    );
    expect(Math.abs(contourArea(contours[0]))).toBeCloseTo(Math.PI * 50, 1);
  });

  it('polygon', () => {
    const { contours } = shapeToContours(
      'polygon',
      attrs({ points: '0,0 10,0 10,10 0,10' }),
      TOL,
    );
    expect(Math.abs(contourArea(contours[0]))).toBeCloseTo(100, 6);
  });

  it('line is rejected with a warning', () => {
    const result = shapeToContours('line', attrs({ x1: '0', y1: '0', x2: '10', y2: '0' }), TOL);
    expect(result.contours).toHaveLength(0);
    expect(result.warnings).toHaveLength(1);
  });
});
