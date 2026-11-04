import type { Contour, Vec2 } from '../model/types';

/**
 * 2D affine matrix in SVG order: [a, b, c, d, e, f]
 * x' = a·x + c·y + e
 * y' = b·x + d·y + f
 */
export type Matrix = readonly [number, number, number, number, number, number];

export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

export function multiply(m1: Matrix, m2: Matrix): Matrix {
  // m1 applied after m2 (i.e. m1 · m2)
  const [a1, b1, c1, d1, e1, f1] = m1;
  const [a2, b2, c2, d2, e2, f2] = m2;
  return [
    a1 * a2 + c1 * b2,
    b1 * a2 + d1 * b2,
    a1 * c2 + c1 * d2,
    b1 * c2 + d1 * d2,
    a1 * e2 + c1 * f2 + e1,
    b1 * e2 + d1 * f2 + f1,
  ];
}

export function applyMatrix(m: Matrix, p: Vec2): Vec2 {
  const [a, b, c, d, e, f] = m;
  return { x: a * p.x + c * p.y + e, y: b * p.x + d * p.y + f };
}

export function applyMatrixToContours(contours: Contour[], m: Matrix): Contour[] {
  if (isIdentity(m)) return contours;
  return contours.map((contour) => contour.map((p) => applyMatrix(m, p)));
}

export function isIdentity(m: Matrix): boolean {
  return (
    m[0] === 1 && m[1] === 0 && m[2] === 0 && m[3] === 1 && m[4] === 0 && m[5] === 0
  );
}

export function isFlipped(m: Matrix): boolean {
  // Negative determinant means the orientation of contours is reversed.
  return m[0] * m[3] - m[1] * m[2] < 0;
}

const TRANSFORM_RE = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g;
const SEPARATOR_RE = /[\s,]+/;

function numbers(input: string): number[] {
  return input
    .split(SEPARATOR_RE)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map(Number)
    .filter((n) => Number.isFinite(n));
}

const DEG = Math.PI / 180;

/** Parses an SVG `transform` attribute into a single matrix. */
export function parseTransform(attribute: string | null | undefined): Matrix {
  if (!attribute) return IDENTITY;
  let result: Matrix = IDENTITY;
  TRANSFORM_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TRANSFORM_RE.exec(attribute)) !== null) {
    const fn = match[1];
    const args = numbers(match[2] ?? '');
    let m: Matrix = IDENTITY;
    switch (fn) {
      case 'matrix': {
        if (args.length >= 6) {
          m = [args[0], args[1], args[2], args[3], args[4], args[5]];
        }
        break;
      }
      case 'translate': {
        m = [1, 0, 0, 1, args[0] ?? 0, args[1] ?? 0];
        break;
      }
      case 'scale': {
        const sx = args[0] ?? 1;
        const sy = args[1] ?? sx;
        m = [sx, 0, 0, sy, 0, 0];
        break;
      }
      case 'rotate': {
        const angle = (args[0] ?? 0) * DEG;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        const rotation: Matrix = [cos, sin, -sin, cos, 0, 0];
        if (args.length >= 3) {
          const cx = args[1];
          const cy = args[2];
          m = multiply(multiply([1, 0, 0, 1, cx, cy], rotation), [1, 0, 0, 1, -cx, -cy]);
        } else {
          m = rotation;
        }
        break;
      }
      case 'skewX': {
        m = [1, 0, Math.tan((args[0] ?? 0) * DEG), 1, 0, 0];
        break;
      }
      case 'skewY': {
        m = [1, Math.tan((args[0] ?? 0) * DEG), 0, 1, 0, 0];
        break;
      }
      default:
        break;
    }
    result = multiply(result, m);
  }
  return result;
}
