import type { SvgDocNode, SvgDocument } from './types';

/**
 * Structural edits on top of the parsed document (see ADR-0026).
 *
 * The project keeps the raw SVG and re-parses it, so groups, renames, moves and deletions cannot be
 * baked into the source. Instead they are stored as a small **overlay**: which node lives under which
 * parent, which nodes were removed, which names were changed and which groups were created. The
 * document that the rest of the app sees is the parsed tree with this overlay applied — a pure,
 * cheap and undo-friendly operation.
 *
 * Sibling order is *not* part of the overlay: it already lives in `settings.childOrder`, which the
 * solver and the tree both respect.
 */
export interface TreeEdit {
  /** Node id → display name (also used to name created groups). */
  names: Record<string, string>;
  /** Node id → parent id; `''` is the document root. Only nodes that moved are listed. */
  parents: Record<string, string>;
  /** Groups created by the user, in creation order. They have no counterpart in the SVG. */
  groups: string[];
  /** Removed nodes; a whole subtree disappears with its root. */
  removed: string[];
}

export const EMPTY_TREE_EDIT: TreeEdit = {
  names: {},
  parents: {},
  groups: [],
  removed: [],
};

const ROOT = '';

function cloneNode(node: SvgDocNode, depth: number): SvgDocNode {
  return { ...node, depth, children: node.children.map((child) => cloneNode(child, depth + 1)) };
}

/** `true` when `target` is `node` itself or sits somewhere inside its subtree. */
function isInside(node: SvgDocNode, target: SvgDocNode): boolean {
  if (node === target) return true;
  return node.children.some((child) => isInside(child, target));
}

/** Applying the overlay to the parsed document. The hash stays the same: the geometry did not change. */
export function applyTreeEdit(document: SvgDocument, edit: TreeEdit): SvgDocument {
  const root = cloneNode(document.root, -1);
  const removed = new Set(edit.removed);

  const prune = (node: SvgDocNode): void => {
    node.children = node.children.filter((child) => !removed.has(child.id));
    for (const child of node.children) prune(child);
  };
  prune(root);

  const index = new Map<string, { node: SvgDocNode; parent: SvgDocNode }>();
  const indexTree = (node: SvgDocNode): void => {
    for (const child of node.children) {
      index.set(child.id, { node: child, parent: node });
      indexTree(child);
    }
  };
  indexTree(root);

  // Groups created by the user exist only in the overlay.
  for (const id of edit.groups) {
    if (removed.has(id) || index.has(id)) continue;
    const group: SvgDocNode = {
      id,
      tag: 'g',
      kind: 'group',
      name: edit.names[id] ?? 'Группа',
      fill: 'none',
      fillRule: 'nonzero',
      hidden: false,
      depth: 0,
      children: [],
      subpaths: [],
      warnings: [],
    };
    root.children.push(group);
    index.set(id, { node: group, parent: root });
  }

  for (const [nodeId, parentId] of Object.entries(edit.parents)) {
    const entry = index.get(nodeId);
    if (!entry) continue;
    if ((parentId === ROOT && entry.parent === root) || entry.parent.id === parentId) continue;
    const target = parentId === ROOT ? root : index.get(parentId)?.node;
    // A shape cannot hold children, and moving a node into itself would lose it.
    if (!target || target.kind === 'shape') continue;
    if (target !== root && isInside(entry.node, target)) continue;
    entry.parent.children = entry.parent.children.filter((child) => child.id !== nodeId);
    target.children.push(entry.node);
    entry.parent = target;
  }

  const finish = (node: SvgDocNode, depth: number): void => {
    node.depth = depth;
    const name = edit.names[node.id];
    if (name) node.name = name;
    for (const child of node.children) finish(child, depth + 1);
  };
  finish(root, -1);

  const paintOrder: string[] = [];
  const collect = (node: SvgDocNode): void => {
    for (const child of node.children) {
      if (child.kind === 'shape' && child.subpaths.length > 0) paintOrder.push(child.id);
      collect(child);
    }
  };
  collect(root);

  return { ...document, root, paintOrder };
}

/** Nodes in document (paint) order with their parent, ignoring removed subtrees. */
function indexNodes(root: SvgDocNode): Map<string, { node: SvgDocNode; parent: SvgDocNode }> {
  const index = new Map<string, { node: SvgDocNode; parent: SvgDocNode }>();
  const walk = (node: SvgDocNode): void => {
    for (const child of node.children) {
      index.set(child.id, { node: child, parent: node });
      walk(child);
    }
  };
  walk(root);
  return index;
}

/** Position of every node in a depth-first walk — "higher in the picture" means a larger index. */
function documentOrder(root: SvgDocNode): Map<string, number> {
  const order = new Map<string, number>();
  let index = 0;
  const walk = (node: SvgDocNode): void => {
    for (const child of node.children) {
      order.set(child.id, index);
      index += 1;
      walk(child);
    }
  };
  walk(root);
  return order;
}

export function findNodeIn(root: SvgDocNode, nodeId: string): SvgDocNode | null {
  for (const child of root.children) {
    if (child.id === nodeId) return child;
    const found = findNodeIn(child, nodeId);
    if (found) return found;
  }
  return null;
}

function hasAncestorIn(
  nodeId: string,
  parentOf: Map<string, SvgDocNode>,
  selected: Set<string>,
): boolean {
  let current = parentOf.get(nodeId);
  while (current) {
    if (selected.has(current.id)) return true;
    current = parentOf.get(current.id);
  }
  return false;
}

export interface GroupResult {
  edit: TreeEdit;
  groupId: string;
  /** Parent of the new group (`''` for the document root). */
  parentId: string;
  /** The element whose place the group takes. */
  anchorId: string;
  /** Nodes that went into the group, bottom → top. */
  movedIds: string[];
  /** Ids that were dropped because a selected ancestor already covers them. */
  skippedIds: string[];
}

/**
 * Wraps the selection in a new group.
 *
 * The group takes the place of the **least nested and highest** element of the selection, which is the
 * only position that keeps the stack predictable when the selection spans several parents: everything
 * else is dragged to that level by the move.
 */
export function createGroup(
  document: SvgDocument,
  edit: TreeEdit,
  ids: string[],
  name: string,
): GroupResult | null {
  const index = indexNodes(document.root);
  const order = documentOrder(document.root);
  const selected = new Set(ids.filter((id) => index.has(id)));
  if (selected.size === 0) return null;

  const parentOf = new Map<string, SvgDocNode>();
  for (const [id, entry] of index) parentOf.set(id, entry.parent);

  const candidates = [...selected].filter((id) => !hasAncestorIn(id, parentOf, selected));
  const skippedIds = [...selected].filter((id) => !candidates.includes(id));
  if (candidates.length === 0) return null;

  // Least nested first, then the highest one in the picture.
  const anchorId = candidates.reduce((best, id) => {
    const a = index.get(best)!;
    const b = index.get(id)!;
    if (a.node.depth !== b.node.depth) return a.node.depth < b.node.depth ? best : id;
    return (order.get(best) ?? 0) > (order.get(id) ?? 0) ? best : id;
  });
  const anchor = index.get(anchorId)!;
  const parentId = anchor.parent.id === document.root.id ? ROOT : anchor.parent.id;
  const movedIds = candidates.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));

  const existing = new Set<string>([...index.keys(), ...edit.groups]);
  let number = edit.groups.length + 1;
  let groupId = `group-${number}`;
  while (existing.has(groupId)) {
    number += 1;
    groupId = `group-${number}`;
  }

  const next: TreeEdit = {
    names: { ...edit.names, [groupId]: name || `Группа ${number}` },
    parents: { ...edit.parents },
    groups: [...edit.groups, groupId],
    removed: [...edit.removed],
  };
  next.parents[groupId] = parentId;
  for (const id of movedIds) next.parents[id] = groupId;

  return { edit: next, groupId, parentId, anchorId, movedIds, skippedIds };
}

export interface MoveResult {
  edit: TreeEdit;
  /** New parent of the moved node (`''` for the root). */
  parentId: string;
}

/**
 * Puts `nodeId` next to `targetId` (`before` = below it in the picture, `after` = above it) or inside
 * it when the target is a group.
 */
export function moveNodeInTree(
  document: SvgDocument,
  edit: TreeEdit,
  nodeId: string,
  targetId: string,
  position: 'before' | 'after' | 'inside',
): MoveResult | null {
  const index = indexNodes(document.root);
  const node = index.get(nodeId)?.node;
  const target = index.get(targetId)?.node;
  if (!node || !target || nodeId === targetId) return null;
  if (isInside(node, target)) return null;
  if (position === 'inside' && target.kind !== 'group') return null;

  const parent = position === 'inside' ? target : (index.get(targetId)?.parent ?? document.root);
  const parentId = parent === document.root ? ROOT : parent.id;
  if (parent.kind === 'shape') return null;

  return {
    edit: { ...edit, parents: { ...edit.parents, [nodeId]: parentId } },
    parentId,
  };
}

export function renameInTree(
  document: SvgDocument,
  edit: TreeEdit,
  nodeId: string,
  name: string,
): TreeEdit | null {
  const trimmed = name.trim();
  const node = findNodeIn(document.root, nodeId);
  if (!node) return null;
  if (trimmed.length === 0 || trimmed === node.name) {
    if (trimmed.length === 0) return null;
    return null;
  }
  return { ...edit, names: { ...edit.names, [nodeId]: trimmed } };
}

export function removeFromTree(edit: TreeEdit, ids: string[]): TreeEdit | null {
  const removed = new Set(edit.removed);
  let changed = false;
  for (const id of ids) {
    if (removed.has(id)) continue;
    removed.add(id);
    changed = true;
  }
  if (!changed) return null;
  const parents = { ...edit.parents };
  for (const id of ids) delete parents[id];
  return { ...edit, parents, removed: [...removed] };
}
