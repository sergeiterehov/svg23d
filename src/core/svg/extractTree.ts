import type {
  BBox,
  Contour,
  DocumentWarning,
  SvgDocNode,
  SvgDocument,
  WarningCode,
} from '../model/types';
import { bboxOfContours, contentBBoxOf, isEmptyBBox } from '../model/defaults';
import { dedupeRings, flattenPathDataSubpaths, type FlatSubpath } from './flatten';
import { shapeToContours } from './shapes';
import { strokeToContours } from './stroke';
import {
  applyMatrix,
  applyMatrixToContours,
  multiply,
  parseTransform,
  type Matrix,
} from './transforms';
import { resolveElementStyle, parseCssRules, type CssRule, type StyleState, ROOT_STYLE } from './styles';
import { userUnitTolerance, type UnitMapping } from './units';

/**
 * Walks the SVG DOM and produces the application's document tree (ADR-0004, ADR-0011).
 * Node ids are stable: the element's own `id` when present, otherwise a path key such as
 * `s0.2.1`, so that user settings survive re-parsing.
 */

const GROUP_TAGS = new Set(['svg', 'g', 'a', 'switch']);
const SHAPE_TAGS = new Set(['path', 'rect', 'circle', 'ellipse', 'polygon', 'polyline', 'line']);
/** Never rendered directly; `<symbol>`/`<defs>` содержимое подключается только через `use`. */
const SKIP_TAGS = new Set([
  'defs',
  'style',
  'title',
  'desc',
  'metadata',
  'symbol',
  'clipPath',
  'mask',
  'marker',
  'pattern',
  'filter',
  'linearGradient',
  'radialGradient',
  'stop',
  'font',
]);
const UNSUPPORTED_TAGS = new Set([
  'text',
  'tspan',
  'textPath',
  'image',
  'foreignObject',
  'video',
  'audio',
  'iframe',
  'canvas',
]);

const UNSUPPORTED_ATTRIBUTES: Array<[string, string]> = [
  ['clip-path', 'clip-path не поддерживается: обрезка не применяется'],
  ['filter', 'filter не поддерживается: эффект не применяется'],
  ['stroke-dasharray', 'Пунктир (stroke-dasharray) не поддерживается: обводка будет сплошной'],
];

const MAX_USE_DEPTH = 8;

interface Context {
  rules: CssRule[];
  tolerance: number;
  idLookup: Map<string, Element>;
  usedIds: Set<string>;
  warnings: DocumentWarning[];
  paintOrder: string[];
  useDepth: number;
  maskDepth: number;
}

interface WalkInput {
  element: Element;
  parentStyle: StyleState;
  parentMatrix: Matrix;
  depth: number;
  pathKey: string;
  /** `use` may render `<symbol>`/`<defs>` content. */
  allowSkipped?: boolean;
}

interface NodeBuild {
  id: string;
  tag: string;
  name: string;
  style: StyleState;
  depth: number;
}

export interface ExtractOptions {
  fileName: string;
  mapping: UnitMapping;
  flatnessMm: number;
}

export function extractDocument(svgRoot: Element, options: ExtractOptions): SvgDocument {
  const context: Context = {
    rules: collectCssRules(svgRoot),
    tolerance: userUnitTolerance(options.flatnessMm, options.mapping),
    idLookup: collectIdLookup(svgRoot),
    usedIds: new Set(),
    warnings: [],
    paintOrder: [],
    useDepth: 0,
    maskDepth: 0,
  };

  const viewBox = readViewBox(svgRoot);
  const declaredSizeMm = readDeclaredSizeMm(svgRoot);

  const children: SvgDocNode[] = [];
  const rootStyle = resolveElementStyle(svgRoot, ROOT_STYLE, context.rules);
  Array.from(svgRoot.children).forEach((child, index) => {
    const nodes = walkElement(
      {
        element: child,
        parentStyle: rootStyle,
        parentMatrix: parseTransform(svgRoot.getAttribute('transform')),
        depth: 1,
        pathKey: String(index),
      },
      context,
    );
    children.push(...nodes);
  });

  const root: SvgDocNode = {
    id: uniqueId(svgRoot.getAttribute('id') ?? 'root', context),
    tag: 'svg',
    kind: 'group',
    name: options.fileName,
    fill: rootStyle.fill,
    fillRule: rootStyle.fillRule,
    hidden: !rootStyle.visible,
    depth: 0,
    children,
    subpaths: [],
    warnings: [],
  };

  if (context.paintOrder.length === 0) {
    context.warnings.push({
      nodeId: null,
      code: 'no-shapes',
      message: 'В документе не найдено залитых фигур. Проверьте, что элементы имеют fill.',
    });
  }

  return {
    fileName: options.fileName,
    root,
    viewBox,
    contentBox: contentBBoxOf(root),
    declaredSizeMm,
    warnings: context.warnings,
    hash: '',
    paintOrder: context.paintOrder,
  };
}

function walkElement(input: WalkInput, context: Context): SvgDocNode[] {
  const { element, parentStyle, parentMatrix, depth, pathKey, allowSkipped } = input;
  const tag = element.tagName.toLowerCase();

  if (SKIP_TAGS.has(tag) && !allowSkipped) return [];

  if (UNSUPPORTED_TAGS.has(tag)) {
    warn(context, element, 'unsupported-element', `<${tag}> не поддерживается и пропущен`);
    return [];
  }

  const style = resolveElementStyle(element, parentStyle, context.rules);
  const matrix = multiply(parentMatrix, parseTransform(element.getAttribute('transform')));
  const id = uniqueId(element.getAttribute('id') ?? `s${pathKey}`, context);
  const name = displayName(element, tag, pathKey);
  const build: NodeBuild = { id, tag, name, style, depth };

  for (const [attribute, message] of UNSUPPORTED_ATTRIBUTES) {
    if (element.hasAttribute(attribute)) {
      warn(context, element, 'unsupported-attribute', message, build.id);
    }
  }

  if (tag === 'use') {
    return resolveUse(element, build, style, matrix, depth, context);
  }

  if (GROUP_TAGS.has(tag)) {
    if (element.hasAttribute('mask')) {
      warn(
        context,
        element,
        'unsupported-attribute',
        'Маска на группе не поддерживается — задайте её элементам внутри',
        id,
      );
    }
    const children: SvgDocNode[] = [];
    Array.from(element.children).forEach((child, index) => {
      children.push(
        ...walkElement(
          {
            element: child,
            parentStyle: style,
            parentMatrix: matrix,
            depth: depth + 1,
            pathKey: `${pathKey}.${index}`,
          },
          context,
        ),
      );
    });

    if (children.length === 0) return [];
    return [
      {
        id,
        tag,
        kind: 'group',
        name,
        fill: style.fill,
        fillRule: style.fillRule,
        hidden: !style.visible,
        depth,
        children,
        subpaths: [],
        warnings: [],
      },
    ];
  }

  if (!SHAPE_TAGS.has(tag)) {
    warn(context, element, 'unsupported-element', `<${tag}> не поддерживается и пропущен`, id);
    return [];
  }

  const mask = resolveMask(element, matrix, depth, pathKey, context);
  return buildShapeNodes(element, build, style, matrix, context, mask);
}

interface MaskData {
  include: Contour[];
  exclude: Contour[];
}

/**
 * Resolves `mask="url(#id)"` into coverage areas (ADR-0015): shapes painted light add coverage,
 * dark shapes punch holes. The result is applied later as `intersect(include)` and `- exclude`.
 */
function resolveMask(
  element: Element,
  matrix: Matrix,
  depth: number,
  pathKey: string,
  context: Context,
): MaskData | null {
  const raw = element.getAttribute('mask');
  if (!raw) return null;
  const nodeId = element.getAttribute('id') ?? undefined;

  const id = /url\(\s*['"]?#([^'")]+)/.exec(raw)?.[1];
  if (!id) {
    warn(context, element, 'unsupported-attribute', 'mask: не удалось прочитать ссылку', nodeId);
    return null;
  }
  const maskElement = context.idLookup.get(id);
  if (!maskElement) {
    warn(context, element, 'unsupported-attribute', `mask: маска «${id}» не найдена`, nodeId);
    return null;
  }
  if (context.maskDepth >= 2) return null;

  const maskStyle = resolveElementStyle(maskElement, ROOT_STYLE, context.rules);
  const maskMatrix = multiply(matrix, parseTransform(maskElement.getAttribute('transform')));

  const include: Contour[] = [];
  const exclude: Contour[] = [];

  const regionX = Number.parseFloat(maskElement.getAttribute('x') ?? '') || 0;
  const regionY = Number.parseFloat(maskElement.getAttribute('y') ?? '') || 0;
  const regionWidth = Number.parseFloat(maskElement.getAttribute('width') ?? '') || 0;
  const regionHeight = Number.parseFloat(maskElement.getAttribute('height') ?? '') || 0;
  if (regionWidth > 0 && regionHeight > 0) {
    include.push(rectContour(regionX, regionY, regionWidth, regionHeight, maskMatrix));
  }

  const paintMark = context.paintOrder.length;
  context.maskDepth++;
  try {
    for (const child of Array.from(maskElement.children)) {
      const nodes = walkElement(
        {
          element: child,
          parentStyle: maskStyle,
          parentMatrix: maskMatrix,
          depth: depth + 1,
          pathKey: `${pathKey}~mask`,
          allowSkipped: true,
        },
        context,
      );
      for (const node of nodes) collectMaskGeometry(node, include, exclude);
    }
  } finally {
    context.maskDepth--;
    // Mask content is coverage, not geometry: it must not enter the paint order.
    context.paintOrder.length = paintMark;
  }

  if (include.length === 0) {
    warn(
      context,
      element,
      'unsupported-attribute',
      'Маска полностью скрывает элемент — он будет пропущен',
      nodeId,
    );
  }

  return { include, exclude };
}

function collectMaskGeometry(node: SvgDocNode, include: Contour[], exclude: Contour[]): void {
  if (node.kind === 'shape') {
    if (relativeLuminance(node.fill) >= 0.5) include.push(...node.subpaths);
    else exclude.push(...node.subpaths);
    return;
  }
  for (const child of node.children) collectMaskGeometry(child, include, exclude);
}

function relativeLuminance(color: string): number {
  if (color === 'none') return 0;
  const hex = color.replace('#', '');
  if (hex.length < 6) return 0;
  const r = Number.parseInt(hex.slice(0, 2), 16) / 255;
  const g = Number.parseInt(hex.slice(2, 4), 16) / 255;
  const b = Number.parseInt(hex.slice(4, 6), 16) / 255;
  if (![r, g, b].every(Number.isFinite)) return 0;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function rectContour(
  x: number,
  y: number,
  width: number,
  height: number,
  matrix: Matrix,
): Contour {
  const points = [
    { x, y },
    { x: x + width, y },
    { x: x + width, y: y + height },
    { x, y: y + height },
  ];
  return points.map((point) => applyMatrix(matrix, point));
}

/**
 * A shape may yield two nodes: the filled area and, separately, its stroke outline — so the stroke
 * can have its own height, clearance, colour and place in the cut order (ADR-0014).
 */
function buildShapeNodes(
  element: Element,
  build: NodeBuild,
  style: StyleState,
  matrix: Matrix,
  context: Context,
  mask: MaskData | null,
): SvgDocNode[] {
  const tag = build.tag;
  let subpaths: FlatSubpath[];
  const localWarnings: string[] = [];

  if (tag === 'path') {
    const flattened = flattenPathSafe(element.getAttribute('d') ?? '', context.tolerance);
    subpaths = flattened.subpaths;
    if (flattened.warning) localWarnings.push(flattened.warning);
  } else {
    const geometry = shapeToContours(
      tag,
      (attribute) => element.getAttribute(attribute),
      context.tolerance,
    );
    subpaths = geometry.contours.map((points) => ({ points, closed: true }));
    localWarnings.push(...geometry.warnings);
  }

  const hidden = !style.visible || style.opacity < 0.02;
  const nodes: SvgDocNode[] = [];

  if (style.fill !== 'none') {
    const contours = dedupeRings(subpaths.map((subpath) => subpath.points));
    const transformed = applyMatrixToContours(contours, matrix);
    const bbox = bboxOfContours(transformed);
    if (transformed.length > 0 && !isEmptyBBox(bbox)) {
      nodes.push({
        id: build.id,
        tag,
        kind: 'shape',
        name: build.name,
        fill: style.fill,
        fillRule: style.fillRule,
        hidden,
        depth: build.depth,
        children: [],
        subpaths: transformed,
        bbox,
        ...(mask ? { maskInclude: mask.include, maskExclude: mask.exclude } : {}),
        warnings: localWarnings,
      });
    }
  }

  if (style.hasStroke && subpaths.length > 0) {
    const strokeContours = strokeToContours(subpaths, {
      width: style.strokeWidth,
      linecap: style.linecap,
      linejoin: style.linejoin,
      tolerance: context.tolerance,
    });
    const transformed = applyMatrixToContours(strokeContours, matrix);
    const bbox = bboxOfContours(transformed);
    if (transformed.length > 0 && !isEmptyBBox(bbox)) {
      nodes.push({
        id: `${build.id}#stroke`,
        tag,
        kind: 'shape',
        name: `${build.name} · обводка`,
        fill: style.stroke,
        fillRule: 'nonzero',
        hidden,
        depth: build.depth,
        children: [],
        subpaths: transformed,
        bbox,
        ...(mask ? { maskInclude: mask.include, maskExclude: mask.exclude } : {}),
        warnings: [],
      });
    }
  }

  if (nodes.length === 0) {
    const reason =
      style.fill === 'none' && !style.hasStroke
        ? 'Нет заливки и обводки — фигура пропущена'
        : 'Фигура пустая и пропущена';
    warn(context, element, 'empty-shape', reason, build.id);
    return [];
  }

  if (localWarnings.length > 0 && nodes[0]) {
    for (const message of localWarnings) {
      warn(context, element, 'empty-shape', message, build.id);
    }
  }

  for (const node of nodes) context.paintOrder.push(node.id);
  return nodes;
}

function resolveUse(
  element: Element,
  build: NodeBuild,
  style: StyleState,
  matrix: Matrix,
  depth: number,
  context: Context,
): SvgDocNode[] {
  const href =
    element.getAttribute('href') ??
    element.getAttributeNS('http://www.w3.org/1999/xlink', 'href') ??
    element.getAttribute('xlink:href') ??
    '';
  if (!href.startsWith('#')) {
    warn(context, element, 'unresolved-use', 'use ссылается на внешний документ — не поддерживается', build.id);
    return [];
  }
  const target = context.idLookup.get(href.slice(1));
  if (!target) {
    warn(context, element, 'unresolved-use', `use: не найден элемент ${href}`, build.id);
    return [];
  }
  if (context.useDepth >= MAX_USE_DEPTH) {
    warn(context, element, 'unresolved-use', 'Слишком глубокая цепочка use — пропущено', build.id);
    return [];
  }

  const x = Number.parseFloat(element.getAttribute('x') ?? '0') || 0;
  const y = Number.parseFloat(element.getAttribute('y') ?? '0') || 0;
  const offsetMatrix: Matrix = multiply(matrix, [1, 0, 0, 1, x, y]);

  context.useDepth++;
  try {
    const nodes = walkElement(
      {
        element: target,
        parentStyle: style,
        parentMatrix: offsetMatrix,
        depth: depth + 1,
        pathKey: `${build.id}__`,
        allowSkipped: true,
      },
      context,
    );
    if (nodes.length === 0) return [];
    return [
      {
        id: build.id,
        tag: 'use',
        kind: 'group',
        name: build.name,
        fill: style.fill,
        fillRule: style.fillRule,
        hidden: !style.visible,
        depth,
        children: nodes,
        subpaths: [],
        warnings: [],
      },
    ];
  } finally {
    context.useDepth--;
  }
}

function flattenPathSafe(
  d: string,
  tolerance: number,
): { subpaths: FlatSubpath[]; warning?: string } {
  if (!d.trim()) return { subpaths: [] };
  try {
    return { subpaths: flattenPathDataSubpaths(d, tolerance) };
  } catch (error) {
    return { subpaths: [], warning: `Не удалось разобрать path: ${(error as Error).message}` };
  }
}

function warn(
  context: Context,
  element: Element,
  code: WarningCode,
  message: string,
  nodeId?: string,
): void {
  context.warnings.push({
    nodeId: nodeId ?? element.getAttribute('id') ?? null,
    code,
    message,
  });
}

function uniqueId(base: string, context: Context): string {
  let id = base.trim() || 'node';
  let suffix = 2;
  while (context.usedIds.has(id)) {
    id = `${base.trim()}-${suffix++}`;
  }
  context.usedIds.add(id);
  return id;
}

function displayName(element: Element, tag: string, pathKey: string): string {
  const label =
    element.getAttribute('data-name') ??
    element.getAttribute('inkscape:label') ??
    element.getAttribute('id');
  if (label && label.trim().length > 0) return label.trim();
  const index = Number.parseInt(pathKey.split('.').pop() ?? '', 10);
  return Number.isFinite(index) ? `${tag} ${index + 1}` : tag;
}

export function collectCssRules(root: Element | Document): CssRule[] {
  const styleElements = Array.from(root.getElementsByTagName('style'));
  return styleElements.flatMap((el) => parseCssRules(el.textContent ?? ''));
}

function collectIdLookup(root: Element): Map<string, Element> {
  const map = new Map<string, Element>();
  const doc = root.ownerDocument ?? root;
  const all = doc.getElementsByTagName('*');
  for (let i = 0; i < all.length; i++) {
    const element = all[i];
    const id = element.getAttribute('id');
    if (id && !map.has(id)) map.set(id, element);
  }
  return map;
}

export function readViewBox(svgRoot: Element): BBox {
  const raw = svgRoot.getAttribute('viewBox');
  if (raw) {
    const numbers = raw
      .split(/[\s,]+/)
      .map((part) => Number.parseFloat(part))
      .filter((value) => Number.isFinite(value));
    if (numbers.length === 4 && numbers[2] > 0 && numbers[3] > 0) {
      const [minX, minY, width, height] = numbers;
      return { minX, minY, maxX: minX + width, maxY: minY + height };
    }
  }
  const width = readLengthMm(svgRoot.getAttribute('width')) ?? 100;
  const height = readLengthMm(svgRoot.getAttribute('height')) ?? 100;
  return { minX: 0, minY: 0, maxX: width, maxY: height };
}

const UNIT_TO_MM: Record<string, number> = {
  mm: 1,
  cm: 10,
  in: 25.4,
  pt: 25.4 / 72,
  pc: 25.4 / 6,
  px: 25.4 / 96,
  '': 25.4 / 96,
};

export function readLengthMm(raw: string | null): number | null {
  if (!raw) return null;
  const match = /^\s*([-+]?[\d.]+)\s*(mm|cm|in|pt|pc|px)?\s*$/i.exec(raw);
  if (!match) return null;
  const value = Number.parseFloat(match[1]);
  if (!Number.isFinite(value)) return null;
  const factor = UNIT_TO_MM[(match[2] ?? '').toLowerCase()];
  return value * (factor ?? UNIT_TO_MM['']);
}

function readDeclaredSizeMm(svgRoot: Element): { width: number; height: number } | null {
  const width = readLengthMm(svgRoot.getAttribute('width'));
  const height = readLengthMm(svgRoot.getAttribute('height'));
  if (!svgRoot.getAttribute('width') || !svgRoot.getAttribute('height')) return null;
  if (width === null || height === null) return null;
  return { width, height };
}
