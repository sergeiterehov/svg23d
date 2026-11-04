import type { BBox, Contour, FillRule, SvgDocNode } from '../model/types';

/**
 * Footprints of the parts (see ADR-0025): a coarse raster of the top view, one bit per cell.
 *
 * Bounding boxes are not enough to know what a part really stands on. A thin stroke or a letter with
 * counters has a huge box and almost no area, so "the box contains the part" says nothing about the
 * material below it — a dot inside the counter of a letter would be stacked on the stroke and end up
 * hanging in the air. Rasterising the outlines and remembering which part painted each cell answers
 * the question the way the picture does: what is visible under this shape.
 */

export interface FootprintGrid {
  minX: number;
  minY: number;
  /** Cell size in user units. */
  cell: number;
  cols: number;
  rows: number;
}

/** Cells along the longer side of the model. Enough for strokes of a millimetre or two. */
const RESOLUTION = 256;

/** Builds a grid covering `box` (the union of all parts). */
export function createGrid(box: BBox): FootprintGrid {
  const width = Math.max(box.maxX - box.minX, 1e-6);
  const height = Math.max(box.maxY - box.minY, 1e-6);
  const cell = Math.max(width, height) / RESOLUTION;
  return {
    minX: box.minX,
    minY: box.minY,
    cell,
    cols: Math.max(1, Math.ceil(width / cell)),
    rows: Math.max(1, Math.ceil(height / cell)),
  };
}

/** Fills the cells covered by `contours` with `value` (1 = inside, 0 = outside). */
function fillContours(
  contours: Contour[],
  fillRule: FillRule,
  grid: FootprintGrid,
  out: Uint8Array,
  value: number,
): void {
  const crossings: Array<{ x: number; dir: 1 | -1 }> = [];
  for (let row = 0; row < grid.rows; row += 1) {
    const y = grid.minY + (row + 0.5) * grid.cell;
    crossings.length = 0;
    for (const contour of contours) {
      const count = contour.length;
      for (let index = 0; index < count; index += 1) {
        const a = contour[index]!;
        const b = contour[(index + 1) % count]!;
        // Half-open intervals: a vertex shared by two edges is counted once.
        if (a.y <= y === b.y <= y) continue;
        const t = (y - a.y) / (b.y - a.y);
        crossings.push({ x: a.x + t * (b.x - a.x), dir: b.y > a.y ? 1 : -1 });
      }
    }
    if (crossings.length < 2) continue;
    crossings.sort((a, b) => a.x - b.x);

    let winding = 0;
    for (let index = 0; index < crossings.length - 1; index += 1) {
      winding += crossings[index]!.dir;
      const inside = fillRule === 'evenodd' ? (index + 1) % 2 === 1 : winding !== 0;
      if (!inside) continue;
      const from = crossings[index]!.x;
      const to = crossings[index + 1]!.x;
      // Cell centres inside [from, to) belong to the shape.
      const first = Math.max(0, Math.ceil((from - grid.minX) / grid.cell - 0.5));
      const last = Math.min(grid.cols - 1, Math.floor((to - grid.minX) / grid.cell - 0.5));
      const offset = row * grid.cols;
      for (let col = first; col <= last; col += 1) out[offset + col] = value;
    }
  }
}

/** Writes the footprint of one node and all its descendants into `out` (0/1 per cell). */
export function rasterizeSubtree(
  node: SvgDocNode,
  grid: FootprintGrid,
  out: Uint8Array,
  scratch: Uint8Array,
): void {
  if (node.kind === 'shape' && node.subpaths.length > 0) {
    const mask = node.maskInclude && node.maskInclude.length > 0 ? node.maskInclude : null;
    if (!mask) {
      fillContours(node.subpaths, node.fillRule, grid, out, 1);
    } else {
      // A masked shape keeps only the part inside its include mask, minus the exclude mask.
      scratch.fill(0);
      fillContours(mask, 'nonzero', grid, scratch, 1);
      if (node.maskExclude && node.maskExclude.length > 0) {
        fillContours(node.maskExclude, 'nonzero', grid, scratch, 0);
      }
      for (let cell = 0; cell < out.length; cell += 1) {
        if (scratch[cell] === 0) continue;
        out[cell] = 1;
      }
    }
  }
  for (const child of node.children) rasterizeSubtree(child, grid, out, scratch);
}

/** Marks the cells of `box` — the fallback for shapes too thin for the grid to hit. */
export function fillBox(box: BBox, grid: FootprintGrid, out: Uint8Array): void {
  const firstCol = Math.max(0, Math.floor((box.minX - grid.minX) / grid.cell));
  const lastCol = Math.min(grid.cols - 1, Math.floor((box.maxX - grid.minX) / grid.cell));
  const firstRow = Math.max(0, Math.floor((box.minY - grid.minY) / grid.cell));
  const lastRow = Math.min(grid.rows - 1, Math.floor((box.maxY - grid.minY) / grid.cell));
  for (let row = firstRow; row <= lastRow; row += 1) {
    const offset = row * grid.cols;
    for (let col = firstCol; col <= lastCol; col += 1) out[offset + col] = 1;
  }
}
