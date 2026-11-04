import type {
  DocumentWarning,
  GlobalSettings,
  NodeSettings,
  ResolvedLeaf,
  SvgDocument,
  SvgDocNode,
} from '../model/types';
import { applyMatrixToContours } from '../svg/transforms';
import { computeUnitMapping } from '../svg/units';
import { orderedChildren } from './order';

/**
 * Resolves inherited settings into a flat, ordered list of leaves ready for the solver
 * (ADR-0004 paint order, ADR-0006 group inheritance, ADR-0009 millimetres).
 */

export interface ResolveInput {
  document: SvgDocument;
  settings: Record<string, NodeSettings>;
  global: GlobalSettings;
}

export interface PartInfo {
  id: string;
  name: string;
  color: string;
}

export interface ResolveResult {
  leaves: ResolvedLeaf[];
  parts: PartInfo[];
  warnings: DocumentWarning[];
  widthMm: number;
  heightMm: number;
}

interface Inherited {
  zFrom: number;
  zTo: number;
  clearance: number;
  chamferTop: number;
  chamferBottom: number;
  hidden: boolean;
}

function hasShapes(node: SvgDocNode): boolean {
  if (node.kind === 'shape') return true;
  return node.children.some(hasShapes);
}

/** Default part roots: children of the root, or its grandchildren when the root has one child. */
export function computeDefaultPartRoots(root: SvgDocNode): Set<string> {
  const roots = new Set<string>();
  const candidates = root.children.length > 1 ? root.children : (root.children[0]?.children ?? []);
  for (const child of candidates) {
    if (hasShapes(child)) roots.add(child.id);
  }
  if (roots.size === 0 && hasShapes(root)) roots.add(root.id);
  return roots;
}

/**
 * Ids of the nodes that start a printed part, in paint order.
 *
 * The walk follows `orderedChildren`, not the raw child arrays: manual order (`settings.childOrder`,
 * written by dragging rows in the tree) has to reach the solver too, otherwise the parts are stacked
 * in one order while the tree shows another.
 */
export function findPartRoots(root: SvgDocNode, settings: Record<string, NodeSettings>): string[] {
  const explicit = hasExplicitParts(root, settings);
  const defaults = explicit ? new Set<string>() : computeDefaultPartRoots(root);
  const result: string[] = [];
  const walk = (node: SvgDocNode): void => {
    if (settings[node.id]?.isPart === true || defaults.has(node.id)) {
      result.push(node.id);
      return;
    }
    for (const child of orderedChildren(node, settings)) walk(child);
  };
  walk(root);
  return result.length > 0 ? result : [root.id];
}

function hasExplicitParts(root: SvgDocNode, settings: Record<string, NodeSettings>): boolean {
  const stack: SvgDocNode[] = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) continue;
    if (settings[node.id]?.isPart) return true;
    stack.push(...node.children);
  }
  return false;
}

export function resolveLeaves(input: ResolveInput): ResolveResult {
  const { document: doc, settings, global } = input;
  const mapping = computeUnitMapping(doc.viewBox, global, doc.contentBox);
  const warnings: DocumentWarning[] = [];

  const explicitParts = hasExplicitParts(doc.root, settings);
  const defaultPartRoots = explicitParts ? new Set<string>() : computeDefaultPartRoots(doc.root);

  const leaves: ResolvedLeaf[] = [];
  const parts = new Map<string, PartInfo>();
  let order = 0;

  const base: Inherited = {
    zFrom: global.defaultZFrom,
    zTo: global.defaultZTo,
    clearance: global.defaultClearance,
    chamferTop: global.defaultChamferTop,
    chamferBottom: global.defaultChamferBottom,
    hidden: false,
  };

  const walk = (node: SvgDocNode, inherited: Inherited, partId: string, partName: string): void => {
    const own = settings[node.id] ?? {};
    const effective: Inherited = {
      zFrom: own.zFrom ?? inherited.zFrom,
      zTo: own.zTo ?? inherited.zTo,
      clearance: own.clearance ?? inherited.clearance,
      chamferTop: own.chamferTop ?? inherited.chamferTop,
      chamferBottom: own.chamferBottom ?? inherited.chamferBottom,
      hidden: inherited.hidden || node.hidden || own.hidden === true,
    };

    let currentPartId = partId;
    let currentPartName = partName;
    const startsPart = own.isPart === true || defaultPartRoots.has(node.id);
    if (startsPart || currentPartId === '') {
      currentPartId = node.id;
      currentPartName = node.name;
    }

    if (own.enabled === false) return;

    if (node.kind === 'shape') {
      if (effective.hidden) return;
      const contours = applyMatrixToContours(node.subpaths, mapping.matrix);
      if (contours.length === 0) return;

      if (!(effective.zTo > effective.zFrom)) {
        // A zero-height band is allowed by the UI (the element just is not printed), so this is
        // informational rather than an error.
        warnings.push({
          nodeId: node.id,
          code: 'empty-shape',
          message: `Элемент «${node.name}» не напечатан: «до» (${effective.zTo}) не больше «от» (${effective.zFrom})`,
        });
        return;
      }

      const color = settingsColor(own.colorOverride, node.fill);
      if (!parts.has(currentPartId)) {
        parts.set(currentPartId, { id: currentPartId, name: currentPartName, color });
      }

      const mask =
        node.maskInclude && node.maskInclude.length > 0
          ? {
              include: applyMatrixToContours(node.maskInclude, mapping.matrix),
              exclude: applyMatrixToContours(node.maskExclude ?? [], mapping.matrix),
            }
          : undefined;

      leaves.push({
        id: node.id,
        name: node.name,
        partId: currentPartId,
        partName: currentPartName,
        order: order++,
        contours,
        fillRule: node.fillRule,
        color,
        zFrom: effective.zFrom,
        zTo: effective.zTo,
        clearance: Math.max(0, effective.clearance),
        chamferTop: Math.max(0, effective.chamferTop),
        chamferBottom: Math.max(0, effective.chamferBottom),
        mask,
      });
      return;
    }

    for (const child of orderedChildren(node, settings)) {
      walk(child, effective, currentPartId, currentPartName);
    }
  };

  const rootSettings: Inherited = {
    ...base,
    zFrom: settings[doc.root.id]?.zFrom ?? base.zFrom,
    zTo: settings[doc.root.id]?.zTo ?? base.zTo,
    clearance: settings[doc.root.id]?.clearance ?? base.clearance,
    chamferTop: settings[doc.root.id]?.chamferTop ?? base.chamferTop,
    chamferBottom: settings[doc.root.id]?.chamferBottom ?? base.chamferBottom,
  };

  const rootPartId = doc.root.id;
  for (const child of orderedChildren(doc.root, settings)) {
    walk(child, rootSettings, rootPartId, doc.root.name);
  }

  if (leaves.length === 0) {
    warnings.push({
      nodeId: null,
      code: 'no-shapes',
      message: 'Нет элементов для построения модели',
    });
  }

  return {
    leaves,
    parts: Array.from(parts.values()),
    warnings,
    widthMm: mapping.widthMm,
    heightMm: mapping.heightMm,
  };
}

function settingsColor(override: string | undefined, fallback: string): string {
  if (override && override.trim().length > 0) return override;
  return fallback === 'none' ? '#000000' : fallback;
}

/** Flattens the tree into a list of nodes (used by the UI for lookups). */
export function flattenTree(root: SvgDocNode): SvgDocNode[] {
  const result: SvgDocNode[] = [];
  const stack: SvgDocNode[] = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) continue;
    result.push(node);
    for (let i = node.children.length - 1; i >= 0; i--) stack.push(node.children[i]);
  }
  return result;
}

export function findNode(root: SvgDocNode, id: string): SvgDocNode | null {
  const stack: SvgDocNode[] = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) continue;
    if (node.id === id) return node;
    stack.push(...node.children);
  }
  return null;
}
