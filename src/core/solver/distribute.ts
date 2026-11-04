import type { BBox, GlobalSettings, NodeSettings, SvgDocNode } from '../model/types';
import { findNode, findPartRoots } from './resolveLeaves';

/**
 * "Разложить по слоям": build a physical stack from the cut order.
 *
 * Every part gets its own Z range of the same thickness, and sinks `SINK_MM` into the layer
 * below so that the part above leaves a socket in the part below (ADR-0005). When a part spans
 * several lower layers it is sunk into the **lowest** of them, so it always cuts through to the
 * bottom of the stack instead of floating on top of a raised neighbour.
 */

/** Thickness of one distributed layer, in mm. */
export const LAYER_MM = 5;
/** How deep a layer sinks into the layer below, in mm. */
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

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Returns the per-part settings with `zFrom`/`zTo` assigned. Parts are processed in paint order,
 * so the first part is the bottom of the stack.
 */
export function distributeLayers(
  root: SvgDocNode,
  settings: Record<string, NodeSettings>,
  global: GlobalSettings,
): Record<string, NodeSettings> {
  const next: Record<string, NodeSettings> = { ...settings };
  const placed: Array<{ zTo: number; box: BBox | null }> = [];

  for (const id of findPartRoots(root, settings)) {
    const node = findNode(root, id);
    const box = node ? subtreeBox(node) : null;
    const below = box ? placed.filter((item) => item.box && boxesOverlap(item.box, box)) : [];

    // Nothing below → start at the project default. Otherwise sink into the lowest lower layer.
    const reference = below.length > 0 ? Math.min(...below.map((item) => item.zTo)) : null;
    const zFrom = round(reference === null ? global.defaultZFrom : reference - SINK_MM);
    const zTo = round(zFrom + LAYER_MM);

    placed.push({ zTo, box });
    next[id] = { ...(next[id] ?? {}), zFrom, zTo };
  }

  return next;
}
