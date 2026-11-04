import type { ResolvedLeaf, SvgDocNode } from '../model/types';
import { findNode } from './resolveLeaves';

/**
 * Maps a tree selection to the printed part that should be highlighted in 3D.
 * A leaf belongs to exactly one part; a group is highlighted when all its leaves share one part.
 */
export function partIdForSelection(
  root: SvgDocNode,
  leaves: ResolvedLeaf[],
  selectedId: string | null,
): string | null {
  if (!selectedId) return null;

  const node = findNode(root, selectedId);
  if (!node) return null;

  const ids = collectSubtreeIds(node);
  const partIds = new Set<string>();
  for (const leaf of leaves) {
    if (ids.has(leaf.id)) partIds.add(leaf.partId);
  }
  if (partIds.size !== 1) return null;
  return partIds.values().next().value ?? null;
}

/** Ids of the node and all its descendants. */
export function collectSubtreeIds(node: SvgDocNode): Set<string> {
  const ids = new Set<string>();

  const stack: SvgDocNode[] = [node];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    ids.add(current.id);
    stack.push(...current.children);
  }
  return ids;
}
