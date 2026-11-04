import type { NodeSettings, SvgDocNode } from '../model/types';

/**
 * Manual paint-order overrides (ADR-0004).
 *
 * Document order is the default; a node may store `childOrder` (ids in paint order, bottom → top).
 * Unknown ids are ignored and any child missing from the list keeps its document position at the end,
 * so stale overrides can never hide geometry.
 */
export function orderedChildren(
  node: SvgDocNode,
  settings: Record<string, NodeSettings>,
): SvgDocNode[] {
  const order = settings[node.id]?.childOrder;
  if (!order || order.length === 0 || node.children.length === 0) return node.children;

  const byId = new Map(node.children.map((child) => [child.id, child]));
  const result: SvgDocNode[] = [];
  for (const id of order) {
    const child = byId.get(id);
    if (child) {
      result.push(child);
      byId.delete(id);
    }
  }
  for (const child of node.children) {
    if (byId.has(child.id)) result.push(child);
  }
  return result;
}

export function findParent(root: SvgDocNode, nodeId: string): SvgDocNode | null {
  for (const child of root.children) {
    if (child.id === nodeId) return root;
    const found = findParent(child, nodeId);
    if (found) return found;
  }
  return null;
}

/**
 * Moves a child by `direction` (+1 = later in paint order = visually higher/topping the list) inside
 * its parent's manual order. Returns the new id list (paint order) or null when nothing changed.
 */
export function shiftChildOrder(
  parent: SvgDocNode,
  childId: string,
  direction: 1 | -1,
  settings: Record<string, NodeSettings>,
): string[] | null {
  const current = orderedChildren(parent, settings).map((child) => child.id);
  const index = current.indexOf(childId);
  if (index < 0) return null;
  const target = index + direction;
  if (target < 0 || target >= current.length) return null;

  const next = [...current];
  next[index] = current[target];
  next[target] = childId;
  return next;
}
