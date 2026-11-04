import type { BBox, GlobalSettings, NodeSettings, SvgDocNode } from '../model/types';
import { findNode, findPartRoots } from './resolveLeaves';

/**
 * "Разложить по слоям": turns the cut order into a physical stack (see ADR-0018).
 *
 * The height of an element is **derived from the parts visible under it** (a shared area in the top
 * view, the layer below is what paints it): its bottom is the **top** of the lowest of them sunk by
 * `SINK_MM` into it, and its top is `LAYER_MM` above the highest of them. So an element always stands on
 * what is beneath it, bites into it instead of resting on a zero-thickness contact, and ends above
 * everything it overlaps (a trunk crossed by crowns stays underneath them).
 *
 * A part painted over another one hides it: a trunk drawn inside the hill stands on the hill and not on
 * the sky behind it, while a crown that sticks out above the hill still reaches down to the sky.
 *
 * Without a support an element takes the project defaults — so nothing hangs in the air.
 */
export const LAYER_MM = 5;
/** How deep a part bites into the one under it, so the two always share volume. */
export const SINK_MM = 0.5;

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

/** `outer` fully covers `inner` in the top view. */
function boxContains(outer: BBox, inner: BBox): boolean {
  return (
    outer.minX <= inner.minX &&
    outer.minY <= inner.minY &&
    outer.maxX >= inner.maxX &&
    outer.maxY >= inner.maxY
  );
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
    // Only the layers actually visible under this one count. A part fully covered by a later part — the
    // sky behind the hill, with a trunk drawn inside the hill — is not what the element stands on.
    const visible = below.filter(
      (_, index) =>
        !below.some(
          (later, laterIndex) =>
            laterIndex > index && later.box !== null && box !== null && boxContains(later.box, box),
        ),
    );
    const resting = visible.length > 0 ? visible : below;

    let zFrom: number;
    let zTo: number;
    if (resting.length === 0) {
      zFrom = round(global.defaultZFrom);
      zTo = round(global.defaultZTo);
    } else {
      // Bottom = top of the lowest part under this one (sunk by half a millimetre), top = 5 mm above
      // the highest one.
      zFrom = round(Math.min(...resting.map((item) => item.zTo)) - SINK_MM);
      zTo = round(Math.max(...resting.map((item) => item.zTo)) + LAYER_MM);
    }

    placed.push({ zFrom, zTo, box });
    next[id] = { ...(next[id] ?? {}), zFrom, zTo };
  }

  return next;
}
