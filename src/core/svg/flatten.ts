import type { Contour, Vec2 } from '../model/types';

/**
 * SVG path parsing and flattening (ADR-0011: full command support, including arcs).
 * Everything is flattened to polylines in the local user unit space; the caller applies
 * the accumulated transform and converts to millimetres.
 */

const EPS = 1e-9;
const MAX_SUBDIVISION_DEPTH = 18;
const MAX_ARC_SEGMENTS = 512;

const isWs = (c: string): boolean =>
  c === ' ' || c === '\n' || c === '\r' || c === '\t' || c === '\f';

function skipSeparators(d: string, i: number): number {
  while (i < d.length && (isWs(d[i]) || d[i] === ',')) i++;
  return i;
}

interface Scan<T> {
  value: T;
  next: number;
}

function readNumber(d: string, i: number): Scan<number> | null {
  const start = i;
  if (d[i] === '+' || d[i] === '-') i++;
  let hasDigits = false;
  while (i < d.length && d[i] >= '0' && d[i] <= '9') {
    i++;
    hasDigits = true;
  }
  if (d[i] === '.') {
    i++;
    while (i < d.length && d[i] >= '0' && d[i] <= '9') {
      i++;
      hasDigits = true;
    }
  }
  if (!hasDigits) return null;
  if (d[i] === 'e' || d[i] === 'E') {
    let j = i + 1;
    if (d[j] === '+' || d[j] === '-') j++;
    let hasExp = false;
    while (j < d.length && d[j] >= '0' && d[j] <= '9') {
      j++;
      hasExp = true;
    }
    if (hasExp) i = j;
  }
  return { value: Number(d.slice(start, i)), next: i };
}

function readFlag(d: string, i: number): Scan<0 | 1> | null {
  if (d[i] === '0') return { value: 0, next: i + 1 };
  if (d[i] === '1') return { value: 1, next: i + 1 };
  return null;
}

export type PathCommand =
  | { type: 'M'; x: number; y: number }
  | { type: 'L'; x: number; y: number }
  | {
      type: 'C';
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      x: number;
      y: number;
    }
  | { type: 'Q'; x1: number; y1: number; x: number; y: number }
  | {
      type: 'A';
      rx: number;
      ry: number;
      rotation: number;
      largeArc: 0 | 1;
      sweep: 0 | 1;
      x: number;
      y: number;
    }
  | { type: 'Z' };

class PathSyntaxError extends Error {}

/**
 * Parses a `d` attribute into absolute commands.
 * Handles implicit repeats (`m` followed by coordinate pairs = lineto), compact flags in arcs
 * (`a1 1 0 0110 10`) and relative/absolute variants.
 */
export function parsePathData(d: string): PathCommand[] {
  const commands: PathCommand[] = [];
  let i = 0;
  let current: string | null = null;
  let cx = 0;
  let cy = 0;
  let startX = 0;
  let startY = 0;

  const num = (): number => {
    i = skipSeparators(d, i);
    const scanned = readNumber(d, i);
    if (!scanned) throw new PathSyntaxError(`Expected number at ${i} in "${d.slice(0, 40)}…"`);
    i = scanned.next;
    return scanned.value;
  };
  const flag = (): 0 | 1 => {
    i = skipSeparators(d, i);
    const scanned = readFlag(d, i);
    if (!scanned) throw new PathSyntaxError(`Expected arc flag at ${i}`);
    i = scanned.next;
    return scanned.value;
  };

  while (true) {
    i = skipSeparators(d, i);
    if (i >= d.length) break;
    const ch = d[i];
    if (/[a-zA-Z]/.test(ch)) {
      current = ch;
      i++;
    } else if (current === null) {
      throw new PathSyntaxError(`Path data must start with a command, got "${d.slice(0, 20)}"`);
    }

    if (current === null) break;
    const upper = current.toUpperCase();
    const relative: boolean = current !== upper;

    switch (upper) {
      case 'M': {
        let x = num();
        let y = num();
        if (relative) {
          x += cx;
          y += cy;
        }
        commands.push({ type: 'M', x, y });
        cx = x;
        cy = y;
        startX = x;
        startY = y;
        // Subsequent pairs are implicit lineto commands.
        current = relative ? 'l' : 'L';
        break;
      }
      case 'L': {
        let x = num();
        let y = num();
        if (relative) {
          x += cx;
          y += cy;
        }
        commands.push({ type: 'L', x, y });
        cx = x;
        cy = y;
        break;
      }
      case 'H': {
        let x = num();
        if (relative) x += cx;
        commands.push({ type: 'L', x, y: cy });
        cx = x;
        break;
      }
      case 'V': {
        let y = num();
        if (relative) y += cy;
        commands.push({ type: 'L', x: cx, y });
        cy = y;
        break;
      }
      case 'C': {
        let x1 = num();
        let y1 = num();
        let x2 = num();
        let y2 = num();
        let x = num();
        let y = num();
        if (relative) {
          x1 += cx;
          y1 += cy;
          x2 += cx;
          y2 += cy;
          x += cx;
          y += cy;
        }
        commands.push({ type: 'C', x1, y1, x2, y2, x, y });
        cx = x;
        cy = y;
        break;
      }
      case 'S': {
        let x2 = num();
        let y2 = num();
        let x = num();
        let y = num();
        if (relative) {
          x2 += cx;
          y2 += cy;
          x += cx;
          y += cy;
        }
        const prev = commands[commands.length - 1];
        const reflect = prev && prev.type === 'C' ? { x: 2 * cx - prev.x2, y: 2 * cy - prev.y2 } : { x: cx, y: cy };
        commands.push({ type: 'C', x1: reflect.x, y1: reflect.y, x2, y2, x, y });
        cx = x;
        cy = y;
        break;
      }
      case 'Q': {
        let x1 = num();
        let y1 = num();
        let x = num();
        let y = num();
        if (relative) {
          x1 += cx;
          y1 += cy;
          x += cx;
          y += cy;
        }
        commands.push({ type: 'Q', x1, y1, x, y });
        cx = x;
        cy = y;
        break;
      }
      case 'T': {
        let x = num();
        let y = num();
        if (relative) {
          x += cx;
          y += cy;
        }
        const prev = commands[commands.length - 1];
        const reflect = prev && prev.type === 'Q' ? { x: 2 * cx - prev.x1, y: 2 * cy - prev.y1 } : { x: cx, y: cy };
        commands.push({ type: 'Q', x1: reflect.x, y1: reflect.y, x, y });
        cx = x;
        cy = y;
        break;
      }
      case 'A': {
        const rx = num();
        const ry = num();
        const rotation = num();
        const largeArc = flag();
        const sweep = flag();
        let x = num();
        let y = num();
        if (relative) {
          x += cx;
          y += cy;
        }
        commands.push({ type: 'A', rx, ry, rotation, largeArc, sweep, x, y });
        cx = x;
        cy = y;
        break;
      }
      case 'Z': {
        commands.push({ type: 'Z' });
        cx = startX;
        cy = startY;
        current = null;
        break;
      }
      default:
        throw new PathSyntaxError(`Unsupported path command "${ch}"`);
    }
  }

  return commands;
}

/** Flattens a cubic Bézier via recursive subdivision. Returns points after `p0`, including `p3`. */
export function flattenCubic(p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2, tolerance: number): Vec2[] {
  const out: Vec2[] = [];
  subdivideCubic(p0, p1, p2, p3, tolerance * tolerance, 0, out);
  return out;
}

function subdivideCubic(
  p0: Vec2,
  p1: Vec2,
  p2: Vec2,
  p3: Vec2,
  tolSq: number,
  depth: number,
  out: Vec2[],
): void {
  const dx = p3.x - p0.x;
  const dy = p3.y - p0.y;
  const d1 = Math.abs((p1.x - p3.x) * dy - (p1.y - p3.y) * dx);
  const d2 = Math.abs((p2.x - p3.x) * dy - (p2.y - p3.y) * dx);
  const dd = (d1 + d2) * (d1 + d2);

  if (depth >= MAX_SUBDIVISION_DEPTH || dd <= tolSq * (dx * dx + dy * dy)) {
    out.push(p3);
    return;
  }

  const p01 = mid(p0, p1);
  const p12 = mid(p1, p2);
  const p23 = mid(p2, p3);
  const p012 = mid(p01, p12);
  const p123 = mid(p12, p23);
  const p0123 = mid(p012, p123);

  subdivideCubic(p0, p01, p012, p0123, tolSq, depth + 1, out);
  subdivideCubic(p0123, p123, p23, p3, tolSq, depth + 1, out);
}

function mid(a: Vec2, b: Vec2): Vec2 {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/** Converts a quadratic command to a cubic control point pair. */
export function quadToCubic(p0: Vec2, q: Vec2, p1: Vec2): [Vec2, Vec2] {
  return [
    { x: p0.x + (2 / 3) * (q.x - p0.x), y: p0.y + (2 / 3) * (q.y - p0.y) },
    { x: p1.x + (2 / 3) * (q.x - p1.x), y: p1.y + (2 / 3) * (q.y - p1.y) },
  ];
}

/**
 * Flattens an elliptical arc using the endpoint → centre parameterisation from the SVG spec (F.6.5).
 */
export function flattenArc(
  p0: Vec2,
  rxIn: number,
  ryIn: number,
  rotationDeg: number,
  largeArc: 0 | 1,
  sweep: 0 | 1,
  p1: Vec2,
  tolerance: number,
): Vec2[] {
  let rx = Math.abs(rxIn);
  let ry = Math.abs(ryIn);
  if (rx < EPS || ry < EPS) return [p1];

  const phi = (rotationDeg * Math.PI) / 180;
  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);

  const dx2 = (p0.x - p1.x) / 2;
  const dy2 = (p0.y - p1.y) / 2;
  const x1p = cosPhi * dx2 + sinPhi * dy2;
  const y1p = -sinPhi * dx2 + cosPhi * dy2;

  // Scale radii up if they are too small to span the endpoints.
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    const s = Math.sqrt(lambda);
    rx *= s;
    ry *= s;
  }

  const sign = largeArc === sweep ? -1 : 1;
  const numerator = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const denominator = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  const coef = sign * Math.sqrt(Math.max(0, numerator / Math.max(denominator, EPS)));
  const cxp = (coef * (rx * y1p)) / ry;
  const cyp = (coef * -(ry * x1p)) / rx;

  const cx = cosPhi * cxp - sinPhi * cyp + (p0.x + p1.x) / 2;
  const cy = sinPhi * cxp + cosPhi * cyp + (p0.y + p1.y) / 2;

  const angleOf = (ux: number, uy: number, vx: number, vy: number): number => {
    const dot = ux * vx + uy * vy;
    const len = Math.hypot(ux, uy) * Math.hypot(vx, vy);
    let a = Math.acos(Math.min(1, Math.max(-1, dot / Math.max(len, EPS))));
    if (ux * vy - uy * vx < 0) a = -a;
    return a;
  };

  const theta1 = angleOf(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let delta = angleOf(
    (x1p - cxp) / rx,
    (y1p - cyp) / ry,
    (-x1p - cxp) / rx,
    (-y1p - cyp) / ry,
  );
  if (!sweep && delta > 0) delta -= 2 * Math.PI;
  else if (sweep && delta < 0) delta += 2 * Math.PI;

  const radius = Math.max(rx, ry);
  const maxStep = 2 * Math.acos(Math.max(-1, Math.min(1, 1 - tolerance / Math.max(radius, EPS))));
  const steps = Math.min(
    MAX_ARC_SEGMENTS,
    Math.max(2, Math.ceil(Math.abs(delta) / Math.max(maxStep, 1e-3))),
  );

  const points: Vec2[] = [];
  for (let i = 1; i <= steps; i++) {
    const theta = theta1 + (delta * i) / steps;
    const cos = Math.cos(theta);
    const sin = Math.sin(theta);
    points.push({
      x: cosPhi * rx * cos - sinPhi * ry * sin + cx,
      y: sinPhi * rx * cos + cosPhi * ry * sin + cy,
    });
  }
  // Guarantee an exact endpoint (float error otherwise leaves a gap).
  points[points.length - 1] = p1;
  return points;
}

export interface FlatSubpath {
  points: Vec2[];
  /** `true` when the subpath was closed with `Z` (stroke caps are not applied). */
  closed: boolean;
}

/** Flattens a `d` attribute into subpaths, keeping whether each one was closed. */
export function flattenPathDataSubpaths(d: string, tolerance: number): FlatSubpath[] {
  const commands = parsePathData(d);
  const subpaths: FlatSubpath[] = [];
  let current: Vec2[] | null = null;
  let cursor: Vec2 = { x: 0, y: 0 };
  let subpathStart: Vec2 = { x: 0, y: 0 };

  const ensureContour = (): Vec2[] => {
    if (!current) current = [{ ...cursor }];
    return current;
  };
  const finish = (closed: boolean): void => {
    if (!current) return;
    const points = dedupePoints(current, closed);
    if (points.length > 0) subpaths.push({ points, closed });
    current = null;
  };
  const push = (p: Vec2): void => {
    const contour = ensureContour();
    const last = contour[contour.length - 1];
    if (Math.abs(last.x - p.x) > 1e-9 || Math.abs(last.y - p.y) > 1e-9) {
      contour.push({ ...p });
    }
  };

  for (const command of commands) {
    switch (command.type) {
      case 'M': {
        finish(false);
        cursor = { x: command.x, y: command.y };
        subpathStart = { ...cursor };
        current = [{ ...cursor }];
        break;
      }
      case 'L': {
        cursor = { x: command.x, y: command.y };
        push(cursor);
        break;
      }
      case 'C': {
        const p0 = cursor;
        const p3 = { x: command.x, y: command.y };
        const points = flattenCubic(
          p0,
          { x: command.x1, y: command.y1 },
          { x: command.x2, y: command.y2 },
          p3,
          tolerance,
        );
        ensureContour();
        for (const p of points) push(p);
        cursor = p3;
        break;
      }
      case 'Q': {
        const p0 = cursor;
        const p1 = { x: command.x, y: command.y };
        const [c1, c2] = quadToCubic(p0, { x: command.x1, y: command.y1 }, p1);
        const points = flattenCubic(p0, c1, c2, p1, tolerance);
        ensureContour();
        for (const p of points) push(p);
        cursor = p1;
        break;
      }
      case 'A': {
        const p0 = cursor;
        const p1 = { x: command.x, y: command.y };
        const points = flattenArc(
          p0,
          command.rx,
          command.ry,
          command.rotation,
          command.largeArc,
          command.sweep,
          p1,
          tolerance,
        );
        ensureContour();
        for (const p of points) push(p);
        cursor = p1;
        break;
      }
      case 'Z': {
        finish(true);
        cursor = { ...subpathStart };
        break;
      }
      default:
        break;
    }
  }

  finish(false);
  return subpaths;
}

/** Flattens a `d` attribute into closed contours (in local user units). */
export function flattenPathData(d: string, tolerance: number): Contour[] {
  // Fill semantics: open subpaths are implicitly closed.
  return dedupeRings(flattenPathDataSubpaths(d, tolerance).map((subpath) => subpath.points));
}

function dedupePoints(points: Vec2[], closed: boolean): Vec2[] {
  const cleaned: Vec2[] = [];
  for (const p of points) {
    const last = cleaned[cleaned.length - 1];
    if (!last || Math.abs(last.x - p.x) > 1e-9 || Math.abs(last.y - p.y) > 1e-9) {
      cleaned.push(p);
    }
  }
  if (closed && cleaned.length > 1) {
    const first = cleaned[0];
    const last = cleaned[cleaned.length - 1];
    if (Math.abs(first.x - last.x) < 1e-9 && Math.abs(first.y - last.y) < 1e-9) {
      cleaned.pop();
    }
  }
  return cleaned;
}

/** Drops degenerate rings and consecutive duplicate points. */
export function dedupeRings(contours: Contour[]): Contour[] {
  const result: Contour[] = [];
  for (const contour of contours) {
    const cleaned: Contour = [];
    for (const p of contour) {
      const last = cleaned[cleaned.length - 1];
      if (!last || Math.abs(last.x - p.x) > 1e-9 || Math.abs(last.y - p.y) > 1e-9) {
        cleaned.push(p);
      }
    }
    if (cleaned.length > 1) {
      const first = cleaned[0];
      const last = cleaned[cleaned.length - 1];
      if (Math.abs(first.x - last.x) < 1e-9 && Math.abs(first.y - last.y) < 1e-9) {
        cleaned.pop();
      }
    }
    if (cleaned.length >= 3) result.push(cleaned);
  }
  return result;
}
