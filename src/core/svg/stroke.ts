import type { Contour, Vec2 } from '../model/types';
import type { FlatSubpath } from './flatten';

/**
 * Stroke → filled outline (ADR-0014, ADR-0038).
 *
 * SVG strokes are painted as a band of `stroke-width` around the path. The band is emitted as a
 * strip of one quad per flattened segment plus a join wedge at every corner, and the downstream
 * NonZero union turns the strip into the exact outline of the stroked area.
 *
 * The previous implementation put a disc at every vertex instead. On a curve that makes the outer
 * edge the envelope of hundreds of small polygons: an order of magnitude more boundary vertices
 * than the curve needs, each offset in a slightly different direction. Extruded, that envelope
 * shows up as a ripple on the walls. Here every offset point is placed once, along the normal of
 * the curve at that point, so the outline of a stroked circle is exactly two concentric polylines.
 *
 * Joins follow `stroke-linejoin`: `miter` (clamped by the SVG limit of 4), `bevel` or `round`.
 * A smooth junction between two flattened segments gets one shared offset point, not a wedge.
 */

const SAME_POINT = 1e-9;
/** SVG miter limit: a tip longer than 4× the half-width falls back to a bevel. */
const MITER_LIMIT = 4;
/** Turn angle below which two adjacent segments belong to one smooth curve, not to a corner. */
const SMOOTH_COS = Math.cos((20 * Math.PI) / 180);

export interface StrokeStyle {
  width: number;
  linecap: 'butt' | 'round' | 'square';
  linejoin: 'miter' | 'round' | 'bevel';
  /** Flattening tolerance in user units, used for join arcs and round caps. */
  tolerance: number;
}

export function strokeToContours(subpaths: FlatSubpath[], style: StrokeStyle): Contour[] {
  const hw = style.width / 2;
  if (!(hw > 0) || style.width <= 0) return [];

  const tolerance = Math.max(style.tolerance, 1e-6);
  const polygons: Contour[] = [];

  for (const subpath of subpaths) {
    const points = dedupePoints(subpath.points, subpath.closed);
    if (points.length === 0) continue;

    if (points.length === 1) {
      // A lone moveto still paints a dot with round caps.
      if (style.linecap !== 'butt') polygons.push(disc(points[0], hw, tolerance));
      continue;
    }

    addBand(polygons, points, subpath.closed, hw, style, tolerance);
  }

  return polygons
    .map(dropCoincident)
    .filter((polygon) => polygon.length >= 3)
    .map(ensureCounterClockwise);
}

/** Drops repeated points and, for a closed ring, the duplicated first/last point. */
function dedupePoints(points: Vec2[], closed: boolean): Vec2[] {
  const cleaned: Vec2[] = [];
  for (const point of points) {
    const last = cleaned[cleaned.length - 1];
    if (!last || !isSamePoint(last, point)) cleaned.push({ ...point });
  }
  if (closed && cleaned.length > 1 && isSamePoint(cleaned[0], cleaned[cleaned.length - 1])) {
    cleaned.pop();
  }
  return cleaned;
}

function dropCoincident(polygon: Contour): Contour {
  const cleaned: Contour = [];
  for (const point of polygon) {
    const last = cleaned[cleaned.length - 1];
    if (!last || !isSamePoint(last, point)) cleaned.push(point);
  }
  return cleaned;
}

function isSamePoint(a: Vec2, b: Vec2): boolean {
  return Math.abs(a.x - b.x) <= SAME_POINT && Math.abs(a.y - b.y) <= SAME_POINT;
}

interface VertexOffsets {
  corner: boolean;
  /** Signed angle from the incoming to the outgoing normal. Positive turns the left side out. */
  turn: number;
  leftIn: Vec2;
  leftOut: Vec2;
  rightIn: Vec2;
  rightOut: Vec2;
}

function addBand(
  out: Contour[],
  points: Vec2[],
  closed: boolean,
  hw: number,
  style: StrokeStyle,
  tolerance: number,
): void {
  const count = points.length;
  const segmentCount = closed ? count : count - 1;
  const normals: Vec2[] = [];
  const lengths: number[] = [];

  for (let i = 0; i < segmentCount; i++) {
    const a = points[i];
    const b = points[(i + 1) % count];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = Math.hypot(dx, dy);
    lengths.push(length);
    // Left-hand normal of the segment direction.
    normals.push({ x: -dy / length, y: dx / length });
  }

  const vertices = points.map((point, index) =>
    vertexOffsets(point, index, count, segmentCount, closed, normals, hw),
  );

  // When the stroke is thicker than the local radius of curvature the inner offset folds through
  // itself. Quad pieces alone would leave a hole there, so such vertices also get a round piece —
  // at that size the band has no visible walls left to ripple anyway.
  for (let i = 0; i < count; i++) {
    const vertex = vertices[i];
    if (vertex.corner) continue;
    const hasIn = closed || i > 0;
    const hasOut = closed || i < count - 1;
    if (!hasIn || !hasOut) continue;
    const previous = lengths[(i - 1 + segmentCount) % segmentCount];
    const next = lengths[i % segmentCount];
    if (hw * Math.abs(vertex.turn) * 2 > previous + next) {
      out.push(disc(points[i], hw, tolerance));
    }
  }

  // One quad per segment. Its parallel edges lie exactly on the offset curve at both ends and
  // neighbouring quads share the offset points, so their union is the band itself — no extra
  // vertices appear where the pieces meet.
  for (let i = 0; i < segmentCount; i++) {
    const a = vertices[i];
    const b = vertices[(i + 1) % count];
    out.push([a.leftOut, b.leftIn, b.rightIn, a.rightOut]);
  }

  // Only corners need a wedge, and only on the outer side — the one opposite to the turn: the
  // inner side is covered by the overlapping quads and the union resolves their crossing.
  for (let i = 0; i < count; i++) {
    const vertex = vertices[i];
    if (!vertex.corner) continue;
    if (vertex.turn < 0) {
      addJoin(out, points[i], vertex.leftIn, vertex.leftOut, vertex.turn, hw, style, tolerance);
    } else if (vertex.turn > 0) {
      addJoin(out, points[i], vertex.rightIn, vertex.rightOut, vertex.turn, hw, style, tolerance);
    }
  }

  if (!closed) {
    const first = points[0];
    const second = points[1];
    addCap(out, first, unit(first.x - second.x, first.y - second.y), hw, style.linecap, tolerance);
    const last = points[count - 1];
    const previous = points[count - 2];
    addCap(out, last, unit(last.x - previous.x, last.y - previous.y), hw, style.linecap, tolerance);
  }
}

function vertexOffsets(
  point: Vec2,
  index: number,
  count: number,
  segmentCount: number,
  closed: boolean,
  normals: Vec2[],
  hw: number,
): VertexOffsets {
  const hasIn = closed || index > 0;
  const hasOut = closed || index < count - 1;
  const incoming = normals[(index - 1 + segmentCount) % segmentCount];
  const outgoing = normals[index % segmentCount];
  const nIn = hasIn ? incoming : outgoing;
  const nOut = hasOut ? outgoing : incoming;

  const dot = nIn.x * nOut.x + nIn.y * nOut.y;
  const corner = hasIn && hasOut && dot < SMOOTH_COS;
  const turn = Math.atan2(nIn.x * nOut.y - nIn.y * nOut.x, dot);

  if (!corner) {
    // Smooth junction: one shared offset point, along the bisector of the two segment normals.
    // On a flattened curve the bisector is (to second order) the normal of the curve itself.
    const sumX = nIn.x + nOut.x;
    const sumY = nIn.y + nOut.y;
    const length = Math.hypot(sumX, sumY) || 1;
    const nx = sumX / length;
    const ny = sumY / length;
    const left = { x: point.x + hw * nx, y: point.y + hw * ny };
    const right = { x: point.x - hw * nx, y: point.y - hw * ny };
    return { corner: false, turn, leftIn: left, leftOut: left, rightIn: right, rightOut: right };
  }

  return {
    corner: true,
    turn,
    leftIn: { x: point.x + hw * nIn.x, y: point.y + hw * nIn.y },
    leftOut: { x: point.x + hw * nOut.x, y: point.y + hw * nOut.y },
    rightIn: { x: point.x - hw * nIn.x, y: point.y - hw * nIn.y },
    rightOut: { x: point.x - hw * nOut.x, y: point.y - hw * nOut.y },
  };
}

/**
 * Fills the gap that a corner opens on the outer side of the band: an arc (`round`), a straight
 * edge (`bevel`) or a spike (`miter`). The arc endpoints are exactly the shared offset points, so
 * the wedge meets the quads without seams.
 */
function addJoin(
  out: Contour[],
  point: Vec2,
  from: Vec2,
  to: Vec2,
  turn: number,
  hw: number,
  style: StrokeStyle,
  tolerance: number,
): void {
  if (isSamePoint(from, to)) return;

  if (style.linejoin === 'miter') {
    const tip = miterTip(point, from, to);
    if (tip && Math.hypot(tip.x - point.x, tip.y - point.y) <= MITER_LIMIT * hw) {
      out.push([point, from, tip, to]);
      return;
    }
    out.push([point, from, to]);
    return;
  }

  if (style.linejoin === 'bevel') {
    out.push([point, from, to]);
    return;
  }

  out.push([point, ...arcPoints(point, from, turn, tolerance, to)]);
}

/** Intersection of the two offset lines meeting at the corner. */
function miterTip(point: Vec2, from: Vec2, to: Vec2): Vec2 | null {
  const d1 = { x: from.y - point.y, y: -(from.x - point.x) };
  const d2 = { x: to.y - point.y, y: -(to.x - point.x) };
  const denominator = d1.x * d2.y - d1.y * d2.x;
  if (Math.abs(denominator) < 1e-12) return null;
  const t = ((to.x - from.x) * d2.y - (to.y - from.y) * d2.x) / denominator;
  return { x: from.x + d1.x * t, y: from.y + d1.y * t };
}

/** Arc of `radius = |from − center|` from `from` by `sweep` radians; the last point is exactly `to`. */
function arcPoints(center: Vec2, from: Vec2, sweep: number, tolerance: number, to: Vec2): Vec2[] {
  const radius = Math.hypot(from.x - center.x, from.y - center.y);
  const start = Math.atan2(from.y - center.y, from.x - center.x);
  const ratio = Math.min(1, Math.max(-1, 1 - tolerance / Math.max(radius, 1e-9)));
  const maxStep = 2 * Math.acos(ratio);
  const steps = Math.max(1, Math.min(64, Math.ceil(Math.abs(sweep) / Math.max(maxStep, 1e-3))));
  const points: Vec2[] = [];
  for (let i = 0; i <= steps; i++) {
    if (i === steps) {
      points.push({ ...to });
      break;
    }
    const angle = start + (sweep * i) / steps;
    points.push({
      x: center.x + radius * Math.cos(angle),
      y: center.y + radius * Math.sin(angle),
    });
  }
  return points;
}

/** Cap at `end`; `outward` is the unit direction the cap grows in. */
function addCap(
  out: Contour[],
  end: Vec2,
  outward: Vec2,
  hw: number,
  cap: StrokeStyle['linecap'],
  tolerance: number,
): void {
  if (cap === 'butt') return;
  if (cap === 'round') {
    out.push(disc(end, hw, tolerance));
    return;
  }
  const nx = -outward.y * hw;
  const ny = outward.x * hw;
  out.push([
    { x: end.x + nx, y: end.y + ny },
    { x: end.x + nx + outward.x * hw, y: end.y + ny + outward.y * hw },
    { x: end.x - nx + outward.x * hw, y: end.y - ny + outward.y * hw },
    { x: end.x - nx, y: end.y - ny },
  ]);
}

function unit(x: number, y: number): Vec2 {
  const length = Math.hypot(x, y) || 1;
  return { x: x / length, y: y / length };
}

function disc(center: Vec2, radius: number, tolerance: number): Contour {
  const ratio = Math.min(1, Math.max(-1, 1 - tolerance / Math.max(radius, 1e-9)));
  const step = 2 * Math.acos(ratio);
  // The cap only guards against absurd counts for very thick strokes. It used to be 64, which is
  // reached already at the default quality for a 22-unit stroke — and then «Точное»/«Максимальное»
  // silently did nothing. 128 keeps the finest preset meaningful and the polygon still smooth.
  const segments = Math.max(8, Math.min(128, Math.ceil((Math.PI * 2) / Math.max(step, 1e-3))));
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
