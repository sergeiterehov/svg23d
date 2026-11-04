import type { BBox, GlobalSettings, NodeSettings, SvgDocNode } from '../model/types';
import { findNode, findPartRoots } from './resolveLeaves';

/**
 * "Разложить по слоям": turns the cut order into a physical stack (see ADR-0018).
 *
 * The height of an element is **derived from the elements it intersects** (a shared area in the top
 * view), not fixed: its bottom is the **top** of the lowest of them and its top is `LAYER_MM` above
 * the highest of them. So an element always stands on what is beneath it and ends above everything
 * it overlaps (a trunk crossed by crowns stays underneath them).
 *
 * Zero height is only for elements that stand on the project base — the ones that intersect nothing;
 * everything else rests on the top of the part below, so nothing hangs in the air.
 */
export const LAYER_MM = 5;

interface MutableBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function collectBox(node: SvgDocNode, box: MutableBox): void {
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
  const box: MutableBox = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  collectBox(node, box);
  if (!Number.isFinite(box.minX) || !Number.isFinite(box.minY)) return null;
  return box;
}

function boxesOverlap(a: BBox, b: BBox): boolean {
  return a.minX < b.maxX && b.minX < a.maxX && a.minY < b.maxY && b.minY < a.maxY;
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
  const placed: Array<{ zFrom: number; zTo: number; box: BBox | null }> = [];

  // Paint order: the first part is drawn first, so it is the bottom of the stack.
  for (const id of findPartRoots(root, settings)) {
    const node = findNode(root, id);
    const box = node ? subtreeBox(node) : null;
    const below = box ? placed.filter((item) => item.box && boxesOverlap(item.box, box)) : [];

    let zFrom: number;
    let zTo: number;
    if (below.length === 0) {
      zFrom = round(global.defaultZFrom);
      zTo = round(global.defaultZTo);
    } else {
      // Bottom = top of the lowest element under this one, top = 5 mm above the highest one.
      zFrom = round(Math.min(...below.map((item) => item.zTo)));
      zTo = round(Math.max(...below.map((item) => item.zTo)) + LAYER_MM);
    }

    placed.push({ zFrom, zTo, box });
    next[id] = { ...(next[id] ?? {}), zFrom, zTo };
  }

  return next;
}
