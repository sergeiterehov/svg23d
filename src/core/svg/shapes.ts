import type { Contour, Vec2 } from '../model/types';
import { dedupeRings, flattenCubic } from './flatten';
import { t } from '@i18n';

/**
 * Basic SVG shapes → contours. Curves are flattened with the same tolerance as paths.
 * Returns an empty list (plus a warning) for shapes without area (`line`, zero-size rect/circle).
 */

const KAPPA = 0.5522847498307936;
const NUM_RE = /[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g;

export interface ShapeGeometry {
  contours: Contour[];
  warnings: string[];
}

function attr(get: (name: string) => string | null, name: string, fallback = 0): number {
  const raw = get(name);
  if (raw === null || raw.trim() === '') return fallback;
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) ? value : fallback;
}

function ellipseContours(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  tolerance: number,
): Contour[] {
  if (rx <= 0 || ry <= 0) return [];
  const points: Vec2[] = [{ x: cx + rx, y: cy }];
  const segments: Array<[Vec2, Vec2, Vec2, Vec2]> = [
    [
      { x: cx + rx, y: cy },
      { x: cx + rx, y: cy + ry * KAPPA },
      { x: cx + rx * KAPPA, y: cy + ry },
      { x: cx, y: cy + ry },
    ],
    [
      { x: cx, y: cy + ry },
      { x: cx - rx * KAPPA, y: cy + ry },
      { x: cx - rx, y: cy + ry * KAPPA },
      { x: cx - rx, y: cy },
    ],
    [
      { x: cx - rx, y: cy },
      { x: cx - rx, y: cy - ry * KAPPA },
      { x: cx - rx * KAPPA, y: cy - ry },
      { x: cx, y: cy - ry },
    ],
    [
      { x: cx, y: cy - ry },
      { x: cx + rx * KAPPA, y: cy - ry },
      { x: cx + rx, y: cy - ry * KAPPA },
      { x: cx + rx, y: cy },
    ],
  ];
  for (const [p0, p1, p2, p3] of segments) {
    for (const p of flattenCubic(p0, p1, p2, p3, tolerance)) points.push(p);
  }
  points.pop(); // last point duplicates the first
  return [points];
}

function roundedRectContours(
  x: number,
  y: number,
  width: number,
  height: number,
  rxIn: number,
  ryIn: number,
  tolerance: number,
): Contour[] {
  if (width <= 0 || height <= 0) return [];
  const rx = Math.min(Math.abs(rxIn), width / 2);
  const ry = Math.min(Math.abs(ryIn), height / 2);
  if (!(rx > 0) || !(ry > 0)) {
    return [
      [
        { x, y },
        { x: x + width, y },
        { x: x + width, y: y + height },
        { x, y: y + height },
      ],
    ];
  }

  const points: Vec2[] = [{ x: x + rx, y }];
  const right = x + width;
  const bottom = y + height;

  const corner = (from: Vec2, c1: Vec2, c2: Vec2, to: Vec2): void => {
    for (const p of flattenCubic(from, c1, c2, to, tolerance)) points.push(p);
  };

  // Clockwise around the rectangle (SVG Y axis points down).
  corner(
    { x: right - rx, y },
    { x: right - rx + rx * KAPPA, y },
    { x: right, y: y + ry - ry * KAPPA },
    { x: right, y: y + ry },
  );
  corner(
    { x: right, y: bottom - ry },
    { x: right, y: bottom - ry + ry * KAPPA },
    { x: right - rx + rx * KAPPA, y: bottom },
    { x: right - rx, y: bottom },
  );
  corner(
    { x: x + rx, y: bottom },
    { x: x + rx - rx * KAPPA, y: bottom },
    { x, y: bottom - ry + ry * KAPPA },
    { x, y: bottom - ry },
  );
  corner(
    { x, y: y + ry },
    { x, y: y + ry - ry * KAPPA },
    { x: x + rx - rx * KAPPA, y },
    { x: x + rx, y },
  );

  points.pop(); // the last point repeats the first
  return dedupeRings([points]);
}

export function shapeToContours(
  tag: string,
  get: (name: string) => string | null,
  tolerance: number,
): ShapeGeometry {
  switch (tag) {
    case 'rect': {
      const rxRaw = get('rx');
      const ryRaw = get('ry');
      let rx = rxRaw !== null && rxRaw.trim() !== '' ? Number.parseFloat(rxRaw) : Number.NaN;
      let ry = ryRaw !== null && ryRaw.trim() !== '' ? Number.parseFloat(ryRaw) : Number.NaN;
      if (Number.isNaN(rx) && Number.isNaN(ry)) {
        rx = 0;
        ry = 0;
      } else if (Number.isNaN(rx)) {
        rx = ry;
      } else if (Number.isNaN(ry)) {
        ry = rx;
      }
      return withWarning(
        roundedRectContours(
          attr(get, 'x'),
          attr(get, 'y'),
          attr(get, 'width'),
          attr(get, 'height'),
          rx,
          ry,
          tolerance,
        ),
        tag,
      );
    }
    case 'circle': {
      const r = attr(get, 'r');
      return withWarning(ellipseContours(attr(get, 'cx'), attr(get, 'cy'), r, r, tolerance), tag);
    }
    case 'ellipse': {
      return withWarning(
        ellipseContours(
          attr(get, 'cx'),
          attr(get, 'cy'),
          attr(get, 'rx'),
          attr(get, 'ry'),
          tolerance,
        ),
        tag,
      );
    }
    case 'polygon':
    case 'polyline': {
      const raw = get('points') ?? '';
      const numbers = (raw.match(NUM_RE) ?? []).map(Number).filter(Number.isFinite);
      const points: Vec2[] = [];
      for (let i = 0; i + 1 < numbers.length; i += 2) {
        points.push({ x: numbers[i], y: numbers[i + 1] });
      }
      return withWarning(dedupeRings([points]), tag);
    }
    case 'line': {
      return {
        contours: [],
        warnings: [t('warn.lineArea')],
      };
    }
    default:
      return { contours: [], warnings: [] };
  }
}

function withWarning(contours: Contour[], tag: string): ShapeGeometry {
  if (contours.length > 0) return { contours, warnings: [] };
  return { contours: [], warnings: [t('warn.emptyShapeTag', { tag })] };
}
