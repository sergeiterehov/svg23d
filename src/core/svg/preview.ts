import type { Contour } from '../model/types';

/**
 * Helpers for the 2D preview. The preview is rendered from the *same* contours that go to the
 * solver, so what the user sees is what gets extruded.
 */

export function contoursToPathData(contours: Contour[], digits = 3): string {
  const parts: string[] = [];
  const fmt = (value: number): string => {
    const rounded = Number(value.toFixed(digits));
    return Object.is(rounded, -0) ? '0' : String(rounded);
  };
  for (const contour of contours) {
    if (contour.length < 3) continue;
    const [first, ...rest] = contour;
    parts.push(`M${fmt(first.x)} ${fmt(first.y)}`);
    for (const point of rest) parts.push(`L${fmt(point.x)} ${fmt(point.y)}`);
    parts.push('Z');
  }
  return parts.join(' ');
}

/** Total polygon area (shoelace, absolute per ring, holes included as separate rings). */
export function contoursArea(contours: Contour[]): number {
  let total = 0;
  for (const contour of contours) {
    let sum = 0;
    for (let i = 0; i < contour.length; i++) {
      const a = contour[i];
      const b = contour[(i + 1) % contour.length];
      sum += a.x * b.y - b.x * a.y;
    }
    total = Math.abs(total) + Math.abs(sum / 2) - Math.abs(total);
  }
  return Math.abs(total);
}
