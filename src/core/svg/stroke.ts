import type { Contour, Vec2 } from '../model/types';
import type { FlatSubpath } from './flatten';

/**
 * Stroke → filled outline (ADR-0014).
 *
 * SVG strokes are painted as a band of `stroke-width` around the path. To extrude them we build the
 * band as a set of overlapping convex polygons (one quad per segment, one disc per vertex, caps at
 * open ends) and let `CrossSection` union them. All polygons are emitted counter-clockwise so a
 * NonZero union gives exactly the stroked area.
 *
 * Joins are always rounded: for `round` that is exact, for `miter`/`bevel` it is a stable superset
 * (rounded outer corner). Bevels/mitres are a printing detail, not worth fragile geometry.
 */

export interface StrokeStyle {
  width: number;
  linecap: 'butt' | 'round' | 'square';
  linejoin: 'miter' | 'round' | 'bevel';
  /** Flattening tolerance in user units, used for discs. */
  tolerance: number;
}

export function strokeToContours(subpaths: FlatSubpath[], style: StrokeStyle): Contour[] {
  const hw = style.width / 2;
  if (!(hw > 0) || style.width <= 0) return [];

  const tolerance = Math.max(style.tolerance, 1e-6);
  const polygons: Contour[] = [];

  for (const subpath of subpaths) {
    const points = subpath.points;
    if (points.length === 0) continue;

    if (points.length === 1) {
      // A lone moveto still paints a dot with round caps.
      if (style.linecap !== 'butt') polygons.push(disc(points[0], hw, tolerance));
      continue;
    }

    const segments: Array<[Vec2, Vec2]> = [];
    for (let i = 0; i + 1 < points.length; i++) segments.push([points[i], points[i + 1]]);
    if (subpath.closed) segments.push([points[points.length - 1], points[0]]);

    for (const [a, b] of segments) addSegmentQuad(polygons, a, b, hw);

    const vertices = subpath.closed ? points : points.slice(1, -1);
    for (const vertex of vertices) polygons.push(disc(vertex, hw, tolerance));

    if (!subpath.closed) {
      addCap(polygons, points[1], points[0], hw, style.linecap, tolerance);
      const last = points.length - 1;
      addCap(polygons, points[last - 1], points[last], hw, style.linecap, tolerance);
    }
  }

  return polygons.map(ensureCounterClockwise);
}

function addSegmentQuad(out: Contour[], a: Vec2, b: Vec2, hw: number): void {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  if (length < 1e-9) return;
  const nx = (-dy / length) * hw;
  const ny = (dx / length) * hw;
  out.push([
    { x: a.x + nx, y: a.y + ny },
    { x: b.x + nx, y: b.y + ny },
    { x: b.x - nx, y: b.y - ny },
    { x: a.x - nx, y: a.y - ny },
  ]);
}

/** Cap at `end`; `prev` is the neighbouring point (defines the outward direction). */
function addCap(
  out: Contour[],
  prev: Vec2,
  end: Vec2,
  hw: number,
  cap: StrokeStyle['linecap'],
  tolerance: number,
): void {
  if (cap === 'butt') return;
  if (cap === 'round') {
    out.push(disc(end, hw, tolerance));
    return;
  }
  const dx = end.x - prev.x;
  const dy = end.y - prev.y;
  const length = Math.hypot(dx, dy);
  if (length < 1e-9) return;
  const ux = dx / length;
  const uy = dy / length;
  const nx = -uy * hw;
  const ny = ux * hw;
  const tipX = end.x + ux * hw;
  const tipY = end.y + uy * hw;
  out.push([
    { x: end.x + nx, y: end.y + ny },
    { x: tipX + nx, y: tipY + ny },
    { x: tipX - nx, y: tipY - ny },
    { x: end.x - nx, y: end.y - ny },
  ]);
}

function disc(center: Vec2, radius: number, tolerance: number): Contour {
  const ratio = Math.min(1, Math.max(-1, 1 - tolerance / Math.max(radius, 1e-9)));
  const step = 2 * Math.acos(ratio);
  const segments = Math.max(8, Math.min(64, Math.ceil((Math.PI * 2) / Math.max(step, 1e-3))));
  const points: Contour = [];
  for (let i = 0; i < segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    points.push({
      x: center.x + radius * Math.cos(angle),
      y: center.y + radius * Math.sin(angle),
    });
  }
  return points;
}

function ensureCounterClockwise(contour: Contour): Contour {
  let area = 0;
  for (let i = 0; i < contour.length; i++) {
    const a = contour[i];
    const b = contour[(i + 1) % contour.length];
    area += a.x * b.y - b.x * a.y;
  }
  return area < 0 ? [...contour].reverse() : contour;
}
