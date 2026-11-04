import type { BBox, GlobalSettings, NodeSettings, SvgDocNode } from '../model/types';
import { findNode, findPartRoots } from './resolveLeaves';

/**
 * "Разложить по слоям": build a physical stack from the cut order.
 *
 * Rule (see ADR-0018): an element stands on the highest layer that **fully covers its footprint**
 * (`boxContains`), sunk by `SINK_MM` so the upper part leaves a socket in the lower one. It is the
 * layer the element visually lies on, not simply its neighbour in the document:
 *
 * - the sky covers everything, the hill covers the trunk → the trunk stands on the hill;
 * - a tree crown sticks out above the hill, so nothing but the sky covers it → the crown stands
 *   on the sky, next to the hill;
 * - elements that intersect but do not cover each other (two crossing bars) stack on the higher
 *   of the two, and fully disjoint elements share the base layer.
 */
export const LAYER_MM = 5;
/** How deep a level sinks into the layer it stands on, in mm. */
export const SINK_MM = 1;

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

/** `inner` lies completely inside `outer` (footprint comparison, not exact geometry). */
function boxContains(outer: BBox, inner: BBox): boolean {
  const eps = 1e-6;
  return (
    inner.minX >= outer.minX - eps &&
    inner.maxX <= outer.maxX + eps &&
    inner.minY >= outer.minY - eps &&
    inner.maxY <= outer.maxY + eps
  );
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Top of the layer the element stands on, or `null` when it rests on the plate itself. */
function supportFor(placed: Array<{ zTo: number; box: BBox | null }>, box: BBox): number | null {
  const covering = placed.filter((item) => item.box && boxContains(item.box, box));
  if (covering.length > 0) return Math.max(...covering.map((item) => item.zTo));

  const crossing = placed.filter((item) => item.box && boxesOverlap(item.box, box));
  if (crossing.length > 0) return Math.max(...crossing.map((item) => item.zTo));

  return null;
}

/** Returns the per-part settings with `zFrom`/`zTo` assigned. */
export function distributeLayers(
  root: SvgDocNode,
  settings: Record<string, NodeSettings>,
  global: GlobalSettings,
): Record<string, NodeSettings> {
  const next: Record<string, NodeSettings> = { ...settings };
  const placed: Array<{ zTo: number; box: BBox | null }> = [];

  // Paint order: the first part is drawn first, so it is the bottom of the stack.
  for (const id of findPartRoots(root, settings)) {
    const node = findNode(root, id);
    const box = node ? subtreeBox(node) : null;
    const supportTop = box ? supportFor(placed, box) : null;
    const zFrom = supportTop === null ? round(global.defaultZFrom) : round(supportTop - SINK_MM);
    const zTo = round(zFrom + LAYER_MM);

    placed.push({ zTo, box });
    next[id] = { ...(next[id] ?? {}), zFrom, zTo };
  }

  return next;
}
