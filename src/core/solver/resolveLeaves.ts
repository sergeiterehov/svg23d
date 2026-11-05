import type {
  DocumentWarning,
  GlobalSettings,
  LeafSource,
  NodeSettings,
  ResolvedLeaf,
  SvgDocument,
  SvgDocNode,
} from '../model/types';
import { applyMatrixToContours } from '../svg/transforms';
import { computeUnitMapping } from '../svg/units';
import { orderedChildren } from './order';
import { t } from '@i18n';

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
  /** «Игнорировать»: the element is not part of the model at all (ADR-0035). */
  ignored: boolean;
  /** «Скрыть»: the element is in the model but is not drawn in 3D. */
  hidden: boolean;
}

function hasShapes(node: SvgDocNode): boolean {
  if (node.kind === 'shape') return true;
  return node.children.some(hasShapes);
}

/**
 * Colour of a node without its own override: its `fill`, or — for a group/union that has none — the
 * first coloured shape inside. The solver uses the same rule for a union body, so the tree, the
 * inspector and the model agree on the colour.
 */
export function fallbackFillOf(node: SvgDocNode): string {
  if (node.fill !== 'none') return node.fill;
  const stack = [...node.children];
  while (stack.length > 0) {
    const next = stack.shift() as SvgDocNode;
    if (next.kind === 'shape' && next.fill !== 'none') return next.fill;
    stack.push(...next.children);
  }
  return '#cccccc';
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
    ignored: false,
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
      ignored: inherited.ignored || node.hidden || own.ignored === true,
      hidden: inherited.hidden || own.hidden === true,
    };

    let currentPartId = partId;
    let currentPartName = partName;
    const startsPart = own.isPart === true || defaultPartRoots.has(node.id);
    if (startsPart || currentPartId === '') {
      currentPartId = node.id;
      currentPartName = node.name;
    }

    if (own.ignored === true || node.hidden) return;

    const maskOf = (source: SvgDocNode): LeafSource['mask'] =>
      source.maskInclude && source.maskInclude.length > 0
        ? {
            include: applyMatrixToContours(source.maskInclude, mapping.matrix),
            exclude: applyMatrixToContours(source.maskExclude ?? [], mapping.matrix),
          }
        : undefined;

    /** One leaf; `sources` carries the extra contour sets of a union object. */
    const emitLeaf = (
      id: string,
      name: string,
      primary: LeafSource,
      color: string,
      extra: LeafSource[] = [],
    ): void => {
      if (!(effective.zTo > effective.zFrom)) {
        // A zero-height band is allowed by the UI (the element just is not printed), so this is
        // informational rather than an error.
        warnings.push({
          nodeId: id,
          code: 'empty-shape',
          message: t('warn.badHeight', { name, to: effective.zTo, from: effective.zFrom }),
        });
        return;
      }
      if (!parts.has(currentPartId)) {
        parts.set(currentPartId, { id: currentPartId, name: currentPartName, color });
      }
      leaves.push({
        id,
        name,
        partId: currentPartId,
        partName: currentPartName,
        order: order++,
        contours: primary.contours,
        fillRule: primary.fillRule,
        ...(primary.mask ? { mask: primary.mask } : {}),
        ...(extra.length > 0 ? { unionSources: extra } : {}),
        color,
        zFrom: effective.zFrom,
        zTo: effective.zTo,
        clearance: Math.max(0, effective.clearance),
        chamferTop: Math.max(0, effective.chamferTop),
        chamferBottom: Math.max(0, effective.chamferBottom),
        hidden: effective.hidden,
      });
    };

    if (node.union === true) {
      // One object made of everything inside (ADR-0028): the children's own settings are ignored, the
      // node's inherited ones apply to the whole body. The boolean union happens in the solver, where
      // the 2D engine is available.
      if (effective.ignored) return;
      const sources: LeafSource[] = [];
      let fill = node.fill;
      const collect = (current: SvgDocNode): void => {
        if (current.kind === 'shape') {
          // A piece leaves the body only when it is excluded from the model («Игнорировать») or is
          // hidden in the source; «Скрыть» is a view flag and does not touch the merged body.
          const partIgnored = settings[current.id]?.ignored === true || current.hidden;
          if (partIgnored) return;
          const contours = applyMatrixToContours(current.subpaths, mapping.matrix);
          if (contours.length === 0) return;
          if (fill === 'none' && current.fill !== 'none') fill = current.fill;
          const mask = maskOf(current);
          sources.push({ contours, fillRule: current.fillRule, ...(mask ? { mask } : {}) });
          return;
        }
        for (const child of orderedChildren(current, settings)) collect(child);
      };
      for (const child of orderedChildren(node, settings)) collect(child);
      const [primary, ...extra] = sources;
      if (!primary) return;
      emitLeaf(node.id, node.name, primary, settingsColor(own.colorOverride, fill), extra);
      return;
    }

    if (node.kind === 'shape') {
      const contours = applyMatrixToContours(node.subpaths, mapping.matrix);
      if (contours.length === 0) return;
      const mask = maskOf(node);
      emitLeaf(
        node.id,
        node.name,
        { contours, fillRule: node.fillRule, ...(mask ? { mask } : {}) },
        settingsColor(own.colorOverride, node.fill),
      );
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
      message: t('warn.noLeaves'),
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
