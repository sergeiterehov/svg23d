import type { BBox, Contour, GlobalSettings, SvgDocNode, Vec2 } from './types';

export const DEFAULT_GLOBAL_SETTINGS: GlobalSettings = {
  fitSizeMm: 200,
  fit: 'max',
  defaultZFrom: 0,
  defaultZTo: 30,
  defaultClearance: 0.15,
  defaultChamferTop: 0,
  defaultChamferBottom: 0,
  flatness: 0.02,
  view: {
    opaque2d: false,
    lighting: 'studio',
    material: 'matte',
  },
};

/** Vertical step used to tessellate a 45° chamfer (see ADR-0007). */
export const CHAMFER_STEP_MM = 0.05;
export const MAX_CHAMFER_LAYERS = 40;

export const EMPTY_BBOX: BBox = {
  minX: Infinity,
  minY: Infinity,
  maxX: -Infinity,
  maxY: -Infinity,
};

export function bboxOfContours(contours: Contour[]): BBox {
  const b: BBox = { ...EMPTY_BBOX };
  for (const contour of contours) {
    for (const p of contour) {
      if (p.x < b.minX) b.minX = p.x;
      if (p.y < b.minY) b.minY = p.y;
      if (p.x > b.maxX) b.maxX = p.x;
      if (p.y > b.maxY) b.maxY = p.y;
    }
  }
  return b;
}

export function isEmptyBBox(b: BBox): boolean {
  return !(b.minX <= b.maxX && b.minY <= b.maxY);
}

export function bboxArea(b: BBox): number {
  if (isEmptyBBox(b)) return 0;
  return (b.maxX - b.minX) * (b.maxY - b.minY);
}

export function bboxIntersects(a: BBox, b: BBox): boolean {
  return a.minX <= b.maxX && b.minX <= a.maxX && a.minY <= b.maxY && b.minY <= a.maxY;
}

export function padBBox(b: BBox, pad: number): BBox {
  return {
    minX: b.minX - pad,
    minY: b.minY - pad,
    maxX: b.maxX + pad,
    maxY: b.maxY + pad,
  };
}

export function unionBBox(a: BBox, b: BBox): BBox {
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

export const vec = (x: number, y: number): Vec2 => ({ x, y });

/** Union of the bounding boxes of every shape in the tree (user units). */
export function contentBBoxOf(node: SvgDocNode): BBox {
  let result: BBox = { ...EMPTY_BBOX };
  const stack = [node];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    if (current.bbox) result = unionBBox(result, current.bbox);
    stack.push(...current.children);
  }
  return result;
}
