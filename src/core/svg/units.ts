import type { BBox, Contour, GlobalSettings } from '../model/types';
import type { Matrix } from './transforms';

/**
 * Mapping from SVG user units to millimetres (ADR-0009).
 * The model keeps its origin at the bottom-left of the viewBox, so all coordinates are
 * non-negative and Z can start at 0 — convenient for slicers.
 */
export interface UnitMapping {
  matrix: Matrix;
  /** Millimetres per user unit. */
  scale: number;
  widthMm: number;
  heightMm: number;
}

export function computeUnitMapping(
  viewBox: BBox,
  global: GlobalSettings,
  contentBox?: BBox,
): UnitMapping {
  const box = contentBox && !isEmptyContentBox(contentBox) ? contentBox : viewBox;
  const boxWidth = Math.max(box.maxX - box.minX, 1e-6);
  const boxHeight = Math.max(box.maxY - box.minY, 1e-6);
  const target = Math.max(global.fitSizeMm, 0.1);
  const scale =
    global.fit === 'height'
      ? target / boxHeight
      : global.fit === 'max'
        ? target / Math.max(boxWidth, boxHeight)
        : target / boxWidth;

  const matrix: Matrix = [scale, 0, 0, -scale, -box.minX * scale, box.maxY * scale];

  return {
    matrix,
    scale,
    widthMm: boxWidth * scale,
    heightMm: boxHeight * scale,
  };
}

function isEmptyContentBox(box: BBox): boolean {
  return !(box.minX <= box.maxX && box.minY <= box.maxY);
}

/** Converts mm back to user units (used to turn the flattening tolerance into local units). */
export function userUnitTolerance(flatnessMm: number, mapping: UnitMapping): number {
  return Math.max(flatnessMm / Math.max(mapping.scale, 1e-9), 1e-6);
}

export function contourArea(contour: Contour): number {
  let sum = 0;
  for (let i = 0; i < contour.length; i++) {
    const a = contour[i];
    const b = contour[(i + 1) % contour.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}
