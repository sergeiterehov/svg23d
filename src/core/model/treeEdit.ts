import type { SvgDocNode, SvgDocument } from './types';
import { t } from '@i18n';

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
  /** Nodes that are printed as one object: a 2D union of everything inside (ADR-0028). */
  unions: string[];
  /** Copies made by «Дублировать»: the overlay clones an existing subtree under fresh ids. */
  copies: TreeCopy[];
}

/**
 * A duplicate of an existing node (ADR-0036). The parsed SVG cannot hold it, so the copy is described
 * here: what to clone and where the clone lives. Copies of copies are allowed — `sourceId` may point
 * at an earlier entry.
 */
export interface TreeCopy {
  /** Id of the copy root; descendants get ids derived from it. */
  id: string;
  /** Node that is cloned. */
  sourceId: string;
  /** Parent of the copy in the overlay (`''` for the document root). */
  parentId: string;
}

export const EMPTY_TREE_EDIT: TreeEdit = {
  names: {},
  parents: {},
  groups: [],
  removed: [],
  unions: [],
  copies: [],
};

const ROOT = '';

/**
 * `childOrder` lives in `settings`, keyed by node id, while a tree edit says `''` for the document
 * root — this maps one to the other, so reordering the top level is recorded like any other level.
 */
export function orderKeyFor(document: { root: { id: string } }, parentId: string): string {
  return parentId === ROOT ? document.root.id : parentId;
}

function cloneNode(node: SvgDocNode, depth: number): SvgDocNode {
  return { ...node, depth, children: node.children.map((child) => cloneNode(child, depth + 1)) };
}

/** Copies a subtree under a new id; descendants get `<id>.<index>` ids, which are unique with it. */
function cloneWithIds(node: SvgDocNode, id: string): SvgDocNode {
  return {
    ...node,
    id,
    children: node.children.map((child, index) => cloneWithIds(child, `${id}.${index}`)),
  };
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
      name: edit.names[id] ?? t('name.group'),
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

  // Duplicates (see `duplicateInTree`): a copy is a clone of a node that already exists here. Copies
  // are inserted before the moves, so a copy that was then dragged elsewhere travels like any node.
  // `?? []` keeps projects saved before copies existed readable.
  for (const copy of edit.copies ?? []) {
    if (removed.has(copy.id) || index.has(copy.id)) continue;
    const source = index.get(copy.sourceId)?.node;
    const target = copy.parentId === ROOT ? root : index.get(copy.parentId)?.node;
    if (!source || !target || target.kind === 'shape') continue;
    const clone = cloneWithIds(source, copy.id);
    // Right after the element it duplicates: in the tree the copy shows up directly above it.
    const at = target.children.findIndex((child) => child.id === source.id);
    if (at >= 0) target.children.splice(at + 1, 0, clone);
    else target.children.push(clone);
    index.set(clone.id, { node: clone, parent: target });
    indexTree(clone);
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

  // Deletion comes **after** the moves: an empty group that is removed must not take the elements that
  // were just moved out of it with it (they are children of that group in the parsed document).
  const prune = (node: SvgDocNode): void => {
    node.children = node.children.filter((child) => !removed.has(child.id));
    for (const child of node.children) prune(child);
  };
  prune(root);

  const unions = new Set(edit.unions);
  const finish = (node: SvgDocNode, depth: number): void => {
    node.depth = depth;
    const name = edit.names[node.id];
    if (name) node.name = name;
    // Unions made by the parser already carry the flag through the clone; user-made ones live here.
    if (unions.has(node.id)) node.union = true;
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

  // Removed ids count as taken: a group that was dissolved or deleted must not come back to life
  // under the same name (applyTreeEdit prunes anything listed in `removed`).
  const existing = new Set<string>([...index.keys(), ...edit.groups, ...edit.removed]);
  let number = edit.groups.length + 1;
  let groupId = `group-${number}`;
  while (existing.has(groupId)) {
    number += 1;
    groupId = `group-${number}`;
  }

  const next: TreeEdit = {
    names: { ...edit.names, [groupId]: name || t('name.groupNumbered', { number }) },
    parents: { ...edit.parents },
    groups: [...edit.groups, groupId],
    removed: [...edit.removed],
    unions: [...edit.unions],
    copies: [...(edit.copies ?? [])],
  };
  next.parents[groupId] = parentId;
  for (const id of movedIds) next.parents[id] = groupId;

  return { edit: next, groupId, parentId, anchorId, movedIds, skippedIds };
}

export interface MoveResult {
  edit: TreeEdit;
  /** New parent of the moved nodes (`''` for the root). */
  parentId: string;
  /** Nodes that moved, bottom → top. */
  movedIds: string[];
}

/**
 * Puts `nodeIds` next to `targetId` (`before` = below it in the picture, `after` = above it) or inside
 * it when the target is a group. A multi-selection moves as one block and keeps its internal order.
 */
export function moveNodesInTree(
  document: SvgDocument,
  edit: TreeEdit,
  nodeIds: string[],
  targetId: string,
  position: 'before' | 'after' | 'inside',
): MoveResult | null {
  const index = indexNodes(document.root);
  const order = documentOrder(document.root);
  const target = index.get(targetId)?.node;
  if (!target) return null;

  const parentOf = new Map<string, SvgDocNode>();
  for (const [id, entry] of index) parentOf.set(id, entry.parent);

  const ids = new Set(nodeIds.filter((id) => index.has(id) && id !== targetId));
  if (ids.size === 0) return null;
  // Only the outermost nodes move: a child of another moved node travels with its parent.
  const movedIds = [...ids]
    .filter((id) => !hasAncestorIn(id, parentOf, ids))
    .sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
  if (movedIds.length === 0) return null;
  const nodeOf = (id: string): SvgDocNode => index.get(id)!.node;
  // Nothing may land inside itself.
  if (movedIds.some((id) => isInside(nodeOf(id), target))) return null;
  if (position === 'inside' && target.kind !== 'group') return null;

  const parent = position === 'inside' ? target : (index.get(targetId)?.parent ?? document.root);
  if (parent.kind === 'shape') return null;
  const parentId = parent === document.root ? ROOT : parent.id;

  const parents = { ...edit.parents };
  for (const id of movedIds) parents[id] = parentId;
  return { edit: { ...edit, parents }, parentId, movedIds };
}

export interface DuplicateResult {
  edit: TreeEdit;
  /** Source id → id of its copy for the whole copied subtree; used to copy the settings over. */
  idMap: Record<string, string>;
  /** One entry per copied subtree, in the order of `ids`. */
  copies: TreeCopy[];
  /** Roots of the copies — what the selection should become. */
  copyIds: string[];
}

/**
 * Duplicates the selection next to the original (ADR-0036). A selected node whose ancestor is also
 * selected is skipped: the ancestor's copy already carries it.
 *
 * The copy keeps the name, the children, the union flag and the paint position of its source; the
 * geometry comes from the parsed document, so no contour is duplicated in the project file.
 */
export function duplicateInTree(
  document: SvgDocument,
  edit: TreeEdit,
  ids: string[],
): DuplicateResult | null {
  const index = indexNodes(document.root);
  const order = documentOrder(document.root);
  const selected = new Set(ids.filter((id) => index.has(id)));
  if (selected.size === 0) return null;

  const parentOf = new Map<string, SvgDocNode>();
  for (const [id, entry] of index) parentOf.set(id, entry.parent);

  const roots = [...selected]
    .filter((id) => !hasAncestorIn(id, parentOf, selected))
    .sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
  if (roots.length === 0) return null;

  // Ids that are already used, deleted ones included: a removed copy must not come back to life.
  const taken = new Set<string>([
    ...index.keys(),
    ...edit.groups,
    ...edit.removed,
    ...(edit.copies ?? []).map((copy) => copy.id),
  ]);
  const idMap: Record<string, string> = {};
  const copies: TreeCopy[] = [];
  const names = { ...edit.names };
  // A copy of a union is a union too: the flag lives on the node id, not on the geometry.
  const unions = [...edit.unions];

  for (const sourceId of roots) {
    const entry = index.get(sourceId)!;
    const parentId = entry.parent.id === document.root.id ? ROOT : entry.parent.id;
    let number = 2;
    let copyId = `${sourceId}-${number}`;
    while (taken.has(copyId)) {
      number += 1;
      copyId = `${sourceId}-${number}`;
    }
    copies.push({ id: copyId, sourceId, parentId });

    const walk = (node: SvgDocNode, newId: string): void => {
      taken.add(newId);
      idMap[node.id] = newId;
      // Only overlay renames have to travel: the clone already carries the parsed name.
      const renamed = edit.names[node.id];
      if (renamed) names[newId] = renamed;
      if (node.union === true || edit.unions.includes(node.id)) unions.push(newId);
      node.children.forEach((child, i) => walk(child, `${newId}.${i}`));
    };
    walk(entry.node, copyId);
  }

  return {
    edit: { ...edit, names, unions, copies: [...(edit.copies ?? []), ...copies] },
    idMap,
    copies,
    copyIds: copies.map((copy) => copy.id),
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
  // A removed union must not leave a dangling id behind (the flag is re-applied from this list).
  const unions = edit.unions.filter((id) => !removed.has(id));
  return { ...edit, parents, removed: [...removed], unions };
}

export interface UngroupResult {
  edit: TreeEdit;
  /** Where the children went (`''` for the document root). */
  parentId: string;
  /** Children that moved up, in the order they had inside the group. */
  movedIds: string[];
}

/**
 * Dissolves a container (ADR-0026): its children take its place in the parent and the container
 * itself is removed from the overlay. A union is dissolved the same way — «Разъединить» lifts its
 * pieces up and drops the union flag with the group.
 */
export function ungroupInTree(
  document: SvgDocument,
  edit: TreeEdit,
  nodeId: string,
): UngroupResult | null {
  const index = indexNodes(document.root);
  const entry = index.get(nodeId);
  if (!entry || entry.node.kind !== 'group' || entry.node.children.length === 0) return null;

  const group = entry.node;
  const parentId = entry.parent.id === document.root.id ? ROOT : entry.parent.id;
  const parents = { ...edit.parents };
  for (const child of group.children) parents[child.id] = parentId;
  delete parents[nodeId];

  // A dissolved union is not a union any more: its flag goes with the container. This also covers
  // unions the parser made (they only exist in the document), where the removal is enough.
  const next: TreeEdit = {
    ...edit,
    parents,
    removed: Array.from(new Set([...edit.removed, nodeId])),
    groups: edit.groups.filter((id) => id !== nodeId),
  };

  return {
    edit: clearUnions(next, [nodeId]) ?? next,
    parentId,
    movedIds: group.children.map((child) => child.id),
  };
}

/** Marks nodes as union objects: printed as one body, children's settings ignored (ADR-0028). */
export function markUnions(edit: TreeEdit, ids: string[]): TreeEdit | null {
  const unions = new Set(edit.unions);
  let changed = false;
  for (const id of ids) {
    if (unions.has(id)) continue;
    unions.add(id);
    changed = true;
  }
  return changed ? { ...edit, unions: [...unions] } : null;
}

/** Turns a user-made union back into a plain group (parser-made unions have no overlay entry). */
export function clearUnions(edit: TreeEdit, ids: string[]): TreeEdit | null {
  const drop = new Set(ids);
  const unions = edit.unions.filter((id) => !drop.has(id));
  return unions.length === edit.unions.length ? null : { ...edit, unions };
}
