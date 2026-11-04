import type { BBox, GlobalSettings, NodeSettings, SvgDocNode } from '../model/types';
import { createGrid, fillBox, rasterizeSubtree } from './footprint';
import { findNode, findPartRoots } from './resolveLeaves';

/**
 * "Разложить по слоям": turns the cut order into a physical stack (see ADR-0018, ADR-0025).
 *
 * The height of an element is **derived from the parts visible under it**: the top view is rasterised,
 * every part remembers which cells it painted, and a part only counts the parts it actually covers. So
 * a trunk drawn inside the hill stands on the hill and not on the sky behind it, a crown sticking out
 * above the hill still reaches down to the sky, and a dot inside the counter of a letter rests on the
 * background instead of balancing on a thin stroke.
 *
 * Its bottom is the **top** of the lowest of them sunk by `SINK_MM` into it, its top is `LAYER_MM`
 * above the highest of them. Without anything beneath, the element takes the project defaults — so
 * nothing hangs in the air.
 */
export const LAYER_MM = 5;
/** How deep a part bites into the one under it, so the two always share volume. */
export const SINK_MM = 0.5;
/** A support has to cover this share of the part's footprint: one stray cell is not a support. */
const SUPPORT_SHARE = 0.02;

function collectBox(node: SvgDocNode, box: BBox): void {
  if (node.bbox) {
    box.minX = Math.min(box.minX, node.bbox.minX);
    box.minY = Math.min(box.minY, node.bbox.minY);
    box.maxX = Math.max(box.maxX, node.bbox.maxX);
    box.maxY = Math.max(box.maxY, node.bbox.maxY);
  }
  for (const child of node.children) collectBox(child, box);
}

/** XY footprint of a node and all its descendants, in SVG user units. */
export function subtreeBox(node: SvgDocNode): BBox | null {
  const box: BBox = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  collectBox(node, box);
  if (!Number.isFinite(box.minX) || !Number.isFinite(box.minY)) return null;
  return box;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Returns the per-part settings with `zFrom`/`zTo` assigned. */
export function distributeLayers(
  root: SvgDocNode,
  settings: Record<string, NodeSettings>,
  global: GlobalSettings,
): Record<string, NodeSettings> {
  const next: Record<string, NodeSettings> = { ...settings };
  const ids = findPartRoots(root, settings);
  const nodes = ids.map((id) => findNode(root, id));
  const boxes = nodes.map((node) => (node ? subtreeBox(node) : null));

  const area: BBox = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const box of boxes) {
    if (!box) continue;
    area.minX = Math.min(area.minX, box.minX);
    area.minY = Math.min(area.minY, box.minY);
    area.maxX = Math.max(area.maxX, box.maxX);
    area.maxY = Math.max(area.maxY, box.maxY);
  }
  if (!Number.isFinite(area.minX)) return next;

  const grid = createGrid(area);
  const cells = grid.cols * grid.rows;
  /** Part index that painted each cell last — what is visible there. */
  const owners = new Int16Array(cells).fill(-1);
  const mask = new Uint8Array(cells);
  const scratch = new Uint8Array(cells);
  const placed: Array<{ zFrom: number; zTo: number }> = [];

  // Paint order: the first part is drawn first, so it is the bottom of the stack.
  ids.forEach((id, index) => {
    const node = nodes[index];
    const box = boxes[index];
    mask.fill(0);
    if (node) rasterizeSubtree(node, grid, mask, scratch);
    let covered = 0;
    for (let cell = 0; cell < cells; cell += 1) if (mask[cell] !== 0) covered += 1;
    if (covered === 0 && box) {
      // Too thin for the grid to hit: its own box is the best available answer.
      fillBox(box, grid, mask);
      covered = 0;
      for (let cell = 0; cell < cells; cell += 1) if (mask[cell] !== 0) covered += 1;
    }

    const counts = new Map<number, number>();
    for (let cell = 0; cell < cells; cell += 1) {
      if (mask[cell] === 0) continue;
      const owner = owners[cell] as number;
      if (owner < 0) continue;
      counts.set(owner, (counts.get(owner) ?? 0) + 1);
    }
    const threshold = Math.max(1, Math.round(covered * SUPPORT_SHARE));
    const supports = [...counts.entries()]
      .filter(([, share]) => share >= threshold)
      .map(([owner]) => placed[owner])
      .filter((item): item is { zFrom: number; zTo: number } => item !== undefined);

    let zFrom: number;
    let zTo: number;
    if (supports.length === 0) {
      zFrom = round(global.defaultZFrom);
      zTo = round(global.defaultZTo);
    } else {
      // Bottom = top of the lowest part under this one (sunk by half a millimetre), top = 5 mm above
      // the highest one.
      zFrom = round(Math.min(...supports.map((item) => item.zTo)) - SINK_MM);
      zTo = round(Math.max(...supports.map((item) => item.zTo)) + LAYER_MM);
    }

    placed.push({ zFrom, zTo });
    for (let cell = 0; cell < cells; cell += 1) if (mask[cell] !== 0) owners[cell] = index;
    next[id] = { ...(next[id] ?? {}), zFrom, zTo };
  });

  return next;
}
