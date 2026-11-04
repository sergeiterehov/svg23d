import type { GlobalSettings, NodeSettings, SvgDocNode } from '../model/types';
import { findPartRoots } from './resolveLeaves';

/**
 * "Разложить по слоям": turn the cut order into a physical stack.
 *
 * Every part is one level of a staircase: it starts `SINK_MM` below the top of the part before it
 * and is `LAYER_MM` thick. The 1 mm sink is what makes the upper part cut a socket into the lower
 * one (ADR-0005); the staircase shape is what makes every level **end at a different height**,
 * so a relief reads as layered instead of collapsing into one plane.
 *
 * Levels follow the paint order strictly (bottom part first), not the overlap graph: parts that
 * only touch the background would otherwise share a layer and show the same protrusion height.
 */
export const LAYER_MM = 5;
/** How deep a level sinks into the one below, in mm. */
export const SINK_MM = 1;

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
  let previousTop: number | null = null;

  for (const id of findPartRoots(root, settings)) {
    const zFrom = previousTop === null ? global.defaultZFrom : round(previousTop - SINK_MM);
    const zTo = round(zFrom + LAYER_MM);
    previousTop = zTo;
    next[id] = { ...(next[id] ?? {}), zFrom, zTo };
  }

  return next;
}
