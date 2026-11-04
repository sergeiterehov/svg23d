import type { GlobalSettings, NodeSettings, SvgDocNode } from '../model/types';

export interface EffectiveSettings {
  zFrom: number;
  zTo: number;
  clearance: number;
  chamferTop: number;
  chamferBottom: number;
  /** View-only: not drawn in 3D, the model stays as it is. */
  hidden: boolean;
  /** Excluded from the model — equivalent to deleting the node (also set by `display:none`). */
  ignored: boolean;
  isPart: boolean;
  colorOverride: string | undefined;
}

/** Settings after inheritance resolution for a single node (ADR-0006). */
export function effectiveSettingsFor(
  root: SvgDocNode,
  settings: Record<string, NodeSettings>,
  global: GlobalSettings,
  nodeId: string,
): EffectiveSettings | null {
  const path = findPath(root, nodeId);
  if (!path) return null;

  const effective: EffectiveSettings = {
    zFrom: global.defaultZFrom,
    zTo: global.defaultZTo,
    clearance: global.defaultClearance,
    chamferTop: global.defaultChamferTop,
    chamferBottom: global.defaultChamferBottom,
    hidden: false,
    ignored: false,
    isPart: false,
    colorOverride: undefined,
  };

  for (const node of path) {
    const own = settings[node.id];
    if (!own) continue;
    if (own.zFrom !== undefined) effective.zFrom = own.zFrom;
    if (own.zTo !== undefined) effective.zTo = own.zTo;
    if (own.clearance !== undefined) effective.clearance = own.clearance;
    if (own.chamferTop !== undefined) effective.chamferTop = own.chamferTop;
    if (own.chamferBottom !== undefined) effective.chamferBottom = own.chamferBottom;
    if (own.ignored === true) effective.ignored = true;
    // Hiding is sticky: `hidden: true` on a group hides everything inside it, and a child's own
    // `hidden: false` cannot cancel that — otherwise the tree shows an element as visible while its
    // parent has hidden it.
    if (own.hidden === true) effective.hidden = true;
    if (own.isPart !== undefined) effective.isPart = own.isPart;
    if (own.colorOverride !== undefined) effective.colorOverride = own.colorOverride;
  }
  // «Игнорировать» is sticky too, and an element hidden in the source (`display:none`) is not part of
  // the drawing at all: both mean "not in the model", so the UI shows one state for them.
  effective.ignored = effective.ignored || path.some((node) => node.hidden);
  return effective;
}

/** Returns the chain root → … → node. */
export function findPath(root: SvgDocNode, nodeId: string): SvgDocNode[] | null {
  if (root.id === nodeId) return [root];
  for (const child of root.children) {
    const childPath = findPath(child, nodeId);
    if (childPath) return [root, ...childPath];
  }
  return null;
}
