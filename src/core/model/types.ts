/**
 * Core domain types. These are UI-agnostic: no React, no DOM, no three.js.
 * All geometry that reaches the solver is expressed in millimetres (see ADR-0009).
 */

export interface Vec2 {
  x: number;
  y: number;
}

/** A closed polygon ring. Holes are represented by separate rings + fill rule. */
export type Contour = Vec2[];

export interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export type FillRule = 'nonzero' | 'evenodd';

export type NodeKind = 'group' | 'shape';

/** A node of the SVG document tree, with transforms already baked in (user units). */
export interface SvgDocNode {
  id: string;
  tag: string;
  kind: NodeKind;
  name: string;
  /** Normalised colour: `#rrggbb`, or `'none'`. */
  fill: string;
  fillRule: FillRule;
  /** `display:none` / `visibility:hidden` at import time. */
  hidden: boolean;
  depth: number;
  children: SvgDocNode[];
  /** Closed contours in SVG user units, ancestor transforms applied. Shapes only. */
  subpaths: Contour[];
  /** Bounding box of `subpaths` in user units (undefined for empty shapes). */
  bbox?: BBox;
  /** Mask coverage (user units, transforms applied): visible inside `include`, hidden inside `exclude`. */
  maskInclude?: Contour[];
  maskExclude?: Contour[];
  warnings: string[];
}

export interface DocumentWarning {
  nodeId: string | null;
  code: WarningCode;
  message: string;
}

export type WarningCode =
  | 'unsupported-element'
  | 'unsupported-attribute'
  | 'empty-shape'
  | 'fully-cut'
  | 'unresolved-use'
  | 'invalid-path'
  | 'no-shapes'
  | 'invalid-svg';

/** Parsed SVG source, ready for the solver. */
export interface SvgDocument {
  fileName: string;
  root: SvgDocNode;
  /** Content area from `viewBox` (falls back to the root width/height). */
  viewBox: BBox;
  /** Union of all shape bounding boxes (user units) — used for fitting the model size. */
  contentBox: BBox;
  /** Physical size declared by the SVG in mm, if it declared absolute units. */
  declaredSizeMm: { width: number; height: number } | null;
  warnings: DocumentWarning[];
  /** Stable hash of the source markup; used to invalidate caches. */
  hash: string;
  /** Shape node ids in paint order (depth-first, document order). */
  paintOrder: string[];
}

/** Per-node overrides. Everything is optional: unset means "inherit". */
export interface NodeSettings {
  zFrom?: number;
  zTo?: number;
  /** Clearance per side, in mm (see ADR-0005). */
  clearance?: number;
  chamferTop?: number;
  chamferBottom?: number;
  /** Marks the start of a new printed part. */
  isPart?: boolean;
  /** Soft hide: excluded from the model but kept in the project. */
  hidden?: boolean;
  colorOverride?: string;
  enabled?: boolean;
  /** Manual paint order override for this node's children (ids). */
  childOrder?: string[];
}

export interface GlobalSettings {
  /** Target extent of the model along the fitted axis, in mm. */
  fitSizeMm: number;
  /** Which axis to fit: width, height, or the larger of the two. */
  fit: 'width' | 'height' | 'max';
  defaultZFrom: number;
  defaultZTo: number;
  defaultClearance: number;
  defaultChamferTop: number;
  defaultChamferBottom: number;
  /** Curve flattening tolerance in mm. Smaller = more triangles. */
  flatness: number;
}

export const PROJECT_VERSION = 1;

export interface Project {
  version: number;
  fileName: string;
  /** Raw SVG markup, embedded in `.svg23d.json` so the project can be reopened. */
  source: string;
  document: SvgDocument;
  settings: Record<string, NodeSettings>;
  global: GlobalSettings;
}

/** Fully resolved leaf, ready for geometry. All values in mm. */
export interface ResolvedLeaf {
  id: string;
  name: string;
  partId: string;
  partName: string;
  /** Global paint index; larger = higher = cuts into lower leaves. */
  order: number;
  contours: Contour[];
  fillRule: FillRule;
  color: string;
  zFrom: number;
  zTo: number;
  clearance: number;
  chamferTop: number;
  chamferBottom: number;
  /** Optional mask: the extruded area is intersected with `include` and `exclude` is subtracted. */
  mask?: { include: Contour[]; exclude: Contour[] };
}

export interface MeshData {
  /** Flat xyz triples. */
  positions: Float32Array;
  indices: Uint32Array;
  triangleCount: number;
  volume: number;
}

/** Per-element numbers, collected before leaves are merged into parts. */
export interface LeafStats {
  volume: number;
  triangleCount: number;
  bbox: BBox3;
}

export interface PartMesh extends MeshData {
  partId: string;
  name: string;
  color: string;
}

export interface BuildStats {
  leafCount: number;
  partCount: number;
  triangleCount: number;
  volume: number;
  bbox: BBox3;
  durationMs: number;
}

export interface BBox3 {
  min: [number, number, number];
  max: [number, number, number];
}

export interface BuildResult {
  parts: PartMesh[];
  stats: BuildStats;
  leafStats: Record<string, LeafStats>;
  warnings: DocumentWarning[];
}

export function emptyBBox3(): BBox3 {
  return {
    min: [Infinity, Infinity, Infinity],
    max: [-Infinity, -Infinity, -Infinity],
  };
}

export function isEmptyBBox3(b: BBox3): boolean {
  return !(b.min[0] <= b.max[0]);
}
