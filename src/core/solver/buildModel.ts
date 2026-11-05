import type {
  BBox,
  BBox3,
  BuildStats,
  Contour,
  DocumentWarning,
  LeafSource,
  LeafStats,
  PartMesh,
  ResolvedLeaf,
} from '../model/types';
import { emptyBBox3 } from '../model/types';
import {
  bboxOfContours,
  bboxIntersects,
  isEmptyBBox,
  leafContours,
  padBBox,
} from '../model/defaults';
import { buildPrism } from '../geometry/extrude';
import { meshFromSolid } from '../geometry/mesh';
import { getLocale, t } from '@i18n';
import {
  offsetSection,
  sectionFromContours,
  unionSections,
  unionSolids,
  type ManifoldApi,
  type Section,
  type Solid,
} from '../geometry/section';

/**
 * Assembly solver (ADR-0003, ADR-0004, ADR-0005).
 *
 * 1. Every leaf becomes a chamfered prism.
 * 2. A leaf subtracts the "ghost" of every *higher* leaf that belongs to a *different* part —
 *    the ghost is the same shape, offset outwards by the upper leaf's clearance and chamfered
 *    the same way, so the socket follows the real printed part.
 * 3. Leaves of the same part are simply unioned: a part is one printed object.
 */

/** Stages of a build, in the order they run; the UI translates them (ADR-0039). */
export type BuildStage = 'sections' | 'prisms' | 'merge';

/** A finished part, kept between builds so that unchanged parts skip the boolean cuts (ADR-0039). */
export interface CachedPart {
  part: PartMesh;
  /**
   * What the view draws: `undefined` — the same mesh as `part` (nothing is hidden), `null` — the
   * part has no visible leaves at all, a mesh — the body without its hidden leaves.
   */
  display?: PartMesh | null;
  leafStats: Record<string, LeafStats>;
  warnings: DocumentWarning[];
}

/** Per-part cache owned by the caller: it decides how long an entry lives. */
export interface BuildCache {
  get(key: string): CachedPart | undefined;
  set(key: string, value: CachedPart): void;
}

export interface BuildOptions {
  api: ManifoldApi;
  leaves: ResolvedLeaf[];
  /** Optional cache of finished parts — the expensive boolean cuts are skipped on a hit. */
  cache?: BuildCache;
  /** Reports the stage and the overall ratio in [0, 1]. */
  onProgress?: (stage: BuildStage, ratio: number) => void;
}

export interface BuildOutput {
  /** The printed model: every leaf, including the ones hidden in the view. */
  parts: PartMesh[];
  /** What the 3D view draws: the same parts without the hidden leaves (ADR-0035). */
  displayParts: PartMesh[];
  stats: BuildStats;
  leafStats: Record<string, LeafStats>;
  warnings: DocumentWarning[];
}

interface Entry {
  leaf: ResolvedLeaf;
  section: Section;
  bbox: BBox;
  /** Everything that changes this leaf's geometry or its sockets — the cache key ingredient. */
  signature: string;
}

/** Share of the progress bar taken by each stage; a UI heuristic, not a measurement. */
const SECTIONS_SHARE = 0.35;
const PRISMS_SHARE = 0.6;

export function buildModel({ api, leaves, cache, onProgress }: BuildOptions): BuildOutput {
  const startedAt = Date.now();
  const warnings: DocumentWarning[] = [];
  const leafStats: Record<string, LeafStats> = {};
  const total = Math.max(leaves.length, 1);
  const report = (stage: BuildStage, ratio: number): void => {
    onProgress?.(stage, Math.min(1, Math.max(0, ratio)));
  };

  // 1. Sections. Cheap next to the boolean cuts, but every socket is offset from one, so they are
  //    computed for all leaves even when the part itself comes from the cache.
  const entries: Entry[] = [];
  for (let i = 0; i < leaves.length; i++) {
    const leaf = leaves[i];
    // Zero (or negative) thickness is allowed by the UI: such an element simply is not printed.
    if (leaf.zTo - leaf.zFrom > 1e-6) {
      const section = leafSection(api, leaf);
      if (!section || section.isEmpty()) {
        section?.delete();
        warnings.push({
          nodeId: leaf.id,
          code: 'empty-shape',
          message: t('warn.leafEmpty', { name: leaf.name }),
        });
      } else {
        entries.push({
          leaf,
          section,
          bbox: bboxOfContours(leafContours(leaf)),
          signature: leafSignature(leaf),
        });
      }
    }
    report('sections', (SECTIONS_SHARE * (i + 1)) / total);
  }

  const ghostCache = new Map<string, Solid | null>();

  const ghostFor = (entry: Entry): Solid | null => {
    const cached = ghostCache.get(entry.leaf.id);
    if (cached !== undefined) return cached;

    const { leaf } = entry;
    let ghostSection: Section | null = null;
    try {
      ghostSection = offsetSection(entry.section, leaf.clearance);
      if (ghostSection.isEmpty()) {
        ghostCache.set(leaf.id, null);
        return null;
      }
      const solid = buildPrism(api, ghostSection, {
        zFrom: leaf.zFrom,
        zTo: leaf.zTo,
        chamferBottom: leaf.chamferBottom,
        chamferTop: leaf.chamferTop,
      });
      ghostCache.set(leaf.id, solid);
      return solid;
    } catch (error) {
      warnings.push({
        nodeId: leaf.id,
        code: 'empty-shape',
        message: t('warn.socketFailed', { name: leaf.name, error: (error as Error).message }),
      });
      ghostCache.set(leaf.id, null);
      return null;
    } finally {
      if (ghostSection && ghostSection !== entry.section) ghostSection.delete();
    }
  };

  const groups = new Map<string, Entry[]>();
  for (const entry of entries) {
    const list = groups.get(entry.leaf.partId);
    if (list) list.push(entry);
    else groups.set(entry.leaf.partId, [entry]);
  }

  const parts: PartMesh[] = [];
  // What the viewer draws. «Скрыть» is a view flag: the model keeps the leaf, so the part has to be
  // rebuilt once more without it. A part without hidden leaves is shared, so the usual case costs
  // nothing extra.
  const displayParts: PartMesh[] = [];
  let finished = 0;

  for (const [partId, items] of groups) {
    const meta = items[0].leaf;
    const name = meta.partName ?? partId;
    const color = meta.color ?? '#cccccc';
    const key = partKey(partId, items, entries);
    const cached = cache?.get(key);

    if (cached) {
      const part: PartMesh = { ...clonePart(cached.part), partId, name, color };
      parts.push(part);
      if (cached.display === null) {
        // Every leaf of this part is hidden in the view.
      } else if (cached.display) {
        displayParts.push({ ...clonePart(cached.display), partId, name, color });
      } else {
        displayParts.push(part);
      }
      Object.assign(leafStats, cached.leafStats);
      warnings.push(...cached.warnings);
    } else {
      const partWarnings: DocumentWarning[] = [];
      const ownStats: Record<string, LeafStats> = {};
      const solids: Array<{ solid: Solid; hidden: boolean }> = [];

      /** Prism of one leaf with the sockets of every higher leaf of another part cut out of it. */
      const buildLeafSolid = (entry: Entry, onCut?: (fraction: number) => void): Solid | null => {
        const { leaf } = entry;
        let solid: Solid;
        try {
          solid = buildPrism(api, entry.section, {
            zFrom: leaf.zFrom,
            zTo: leaf.zTo,
            chamferBottom: leaf.chamferBottom,
            chamferTop: leaf.chamferTop,
          });
        } catch (error) {
          partWarnings.push({
            nodeId: leaf.id,
            code: 'empty-shape',
            message: t('warn.partFailed', { name: leaf.name, error: (error as Error).message }),
          });
          return null;
        }

        // One boolean per higher leaf — the longest part of a build, so it drives the progress bar.
        const totalCuts = Math.max(entries.length, 1);
        let isCut = false;
        for (let otherIndex = 0; otherIndex < entries.length; otherIndex++) {
          const other = entries[otherIndex];
          if (cuts(entry, other)) {
            const ghost = ghostFor(other);
            if (ghost) {
              const next: Solid = solid.subtract(ghost);
              solid.delete();
              solid = next;
              isCut = true;
            }
          }
          onCut?.((otherIndex + 1) / totalCuts);
          if (solid.isEmpty()) break;
        }

        if (solid.isEmpty()) {
          solid.delete();
          if (isCut) {
            partWarnings.push({
              nodeId: leaf.id,
              code: 'fully-cut',
              message: t('warn.fullyCut', { name: leaf.name }),
            });
          }
          return null;
        }
        return solid;
      };

      for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
        const entry = items[itemIndex];
        const solid = buildLeafSolid(entry, (cutFraction) => {
          const within = (itemIndex + cutFraction) / items.length;
          report('prisms', SECTIONS_SHARE + PRISMS_SHARE * ((finished + within) / groups.size));
        });
        if (!solid) continue;
        solids.push({ solid, hidden: entry.leaf.hidden });
        const box = solid.boundingBox();
        ownStats[entry.leaf.id] = {
          volume: Math.abs(solid.volume()),
          triangleCount: solid.numTri(),
          bbox: {
            min: [box.min[0], box.min[1], box.min[2]],
            max: [box.max[0], box.max[1], box.max[2]],
          },
        };
      }

      const hiddenItems = solids.filter((item) => item.hidden);
      const visibleItems = solids.filter((item) => !item.hidden);

      let visiblePart: PartMesh | null = null;
      let toMerge = solids.map((item) => item.solid);
      if (hiddenItems.length > 0) {
        toMerge = hiddenItems.map((item) => item.solid);
        if (visibleItems.length > 0) {
          const visibleSolid = unionSolids(visibleItems.map((item) => item.solid));
          if (visibleSolid && !visibleSolid.isEmpty()) {
            visiblePart = { partId, name, color, ...meshFromSolid(visibleSolid) };
            toMerge = [visibleSolid, ...toMerge];
          } else {
            visibleSolid?.delete();
          }
        }
      }

      const merged = unionSolids(toMerge);
      Object.assign(leafStats, ownStats);
      warnings.push(...partWarnings);
      if (merged && !merged.isEmpty()) {
        const mesh = meshFromSolid(merged);
        merged.delete();
        const part: PartMesh = { partId, name, color, ...mesh };
        parts.push(part);
        if (hiddenItems.length === 0) displayParts.push(part);
        else if (visiblePart) displayParts.push(visiblePart);
        cache?.set(key, {
          part: clonePart(part),
          display:
            hiddenItems.length === 0 ? undefined : visiblePart ? clonePart(visiblePart) : null,
          leafStats: ownStats,
          warnings: partWarnings,
        });
      } else {
        merged?.delete();
      }
    }

    finished++;
    report('prisms', SECTIONS_SHARE + PRISMS_SHARE * (finished / groups.size));
  }
  report('merge', 1);

  for (const ghost of ghostCache.values()) ghost?.delete();
  for (const entry of entries) entry.section.delete();

  const bbox: BBox3 = emptyBBox3();
  let triangleCount = 0;
  let volume = 0;
  for (const part of parts) {
    triangleCount += part.triangleCount;
    volume += part.volume;
    const { positions } = part;
    for (let i = 0; i < positions.length; i += 3) {
      const x = positions[i];
      const y = positions[i + 1];
      const z = positions[i + 2];
      if (x < bbox.min[0]) bbox.min[0] = x;
      if (y < bbox.min[1]) bbox.min[1] = y;
      if (z < bbox.min[2]) bbox.min[2] = z;
      if (x > bbox.max[0]) bbox.max[0] = x;
      if (y > bbox.max[1]) bbox.max[1] = y;
      if (z > bbox.max[2]) bbox.max[2] = z;
    }
  }
  if (parts.length === 0) {
    bbox.min = [0, 0, 0];
    bbox.max = [0, 0, 0];
  }

  return {
    parts,
    displayParts,
    leafStats,
    warnings,
    stats: {
      leafCount: entries.length,
      partCount: parts.length,
      triangleCount,
      volume,
      bbox,
      durationMs: Date.now() - startedAt,
    },
  };
}

/** Does `other` cut a socket into `entry`? A higher leaf of another part that overlaps it. */
function cuts(entry: Entry, other: Entry): boolean {
  if (other === entry) return false;
  const target = entry.leaf;
  const cutter = other.leaf;
  if (cutter.partId === target.partId) return false;
  if (cutter.order <= target.order) return false;
  if (cutter.zFrom >= target.zTo || target.zFrom >= cutter.zTo) return false;
  return bboxIntersects(padBBox(entry.bbox, cutter.clearance + 0.01), other.bbox);
}

/**
 * Identifies everything a finished part depends on: its own leaves and every socket cut into them.
 * A cached part is reused only when both lists are identical (ADR-0039).
 */
function partKey(partId: string, items: Entry[], all: Entry[]): string {
  const own = items.map((entry) => `${entry.leaf.id}:${entry.signature}`).join(',');
  const cutters = new Set<string>();
  for (const entry of items) {
    for (const other of all) {
      if (!cuts(entry, other)) continue;
      // The clearance belongs to the ghost this leaf cuts, not to the leaf's own body.
      const clearance = other.leaf.clearance.toFixed(3);
      cutters.add(`${other.leaf.id}:${other.signature}:c${clearance}`);
    }
  }
  return `${getLocale()}|${partId}|${own}|${[...cutters].sort().join(',')}`;
}

/** Everything that changes the solid of a leaf or the socket it cuts in lower parts. */
function leafSignature(leaf: ResolvedLeaf): string {
  const sources = (leaf.unionSources ?? [])
    .map((source) => `${contoursHash(source.contours)}:${source.fillRule}:${maskHash(source.mask)}`)
    .join('+');
  return [
    contoursHash(leaf.contours),
    leaf.fillRule,
    maskHash(leaf.mask),
    sources,
    leaf.zFrom.toFixed(3),
    leaf.zTo.toFixed(3),
    leaf.chamferTop.toFixed(3),
    leaf.chamferBottom.toFixed(3),
    leaf.hidden ? 'hidden' : 'shown',
  ].join('|');
}

function maskHash(mask: LeafSource['mask']): string {
  if (!mask) return '-';
  return `${contoursHash(mask.include)}/${contoursHash(mask.exclude)}`;
}

/**
 * Two independent FNV-1a streams over the coordinates, so a cache key collision is far below the
 * probability of a hardware fault. Coordinates are quantised to 1e-6 mm first.
 */
function contoursHash(contours: Contour[]): string {
  let first = 0x811c9dc5;
  let second = 0x01000193;
  const mix = (value: number): void => {
    const v = Math.round(value * 1e6) | 0;
    first = Math.imul(first ^ v, 0x01000193);
    second = Math.imul(second ^ v, 0x85ebca6b);
  };
  mix(contours.length);
  for (const contour of contours) {
    mix(contour.length);
    for (const point of contour) {
      mix(point.x);
      mix(point.y);
    }
  }
  return `${(first >>> 0).toString(36)}-${(second >>> 0).toString(36)}`;
}

/** The cache keeps its own copy: the meshes handed to the caller are transferred to the main thread. */
function clonePart(part: PartMesh): PartMesh {
  return { ...part, positions: part.positions.slice(), indices: part.indices.slice() };
}

/** Exported for tests: true when two leaves overlap in Z. */
export function zOverlaps(a: ResolvedLeaf, b: ResolvedLeaf): boolean {
  return a.zFrom < b.zTo && b.zFrom < a.zTo;
}

/**
 * The 2D body of a leaf: one section per contour set, unioned together. A plain element has a single
 * set; a union object (ADR-0028) has several, and this is where they become one body — before any
 * extrusion, so the printed part has no internal walls and no sockets between its pieces.
 */
function leafSection(api: ManifoldApi, leaf: ResolvedLeaf): Section | null {
  const sources: LeafSource[] = [
    { contours: leaf.contours, fillRule: leaf.fillRule, ...(leaf.mask ? { mask: leaf.mask } : {}) },
    ...(leaf.unionSources ?? []),
  ];
  const sections: Section[] = [];
  for (const source of sources) {
    const raw = sectionFromContours(api, source.contours, source.fillRule);
    const masked = applyMask(api, raw, source.mask);
    if (masked !== raw) raw.delete();
    if (masked.isEmpty()) masked.delete();
    else sections.push(masked);
  }
  return unionSections(sections);
}

/**
 * Applies an SVG mask (ADR-0015): the area is intersected with the "include" coverage and the
 * "exclude" coverage is removed. Reuses the same 2D boolean engine as the rest of the solver.
 */
function applyMask(api: ManifoldApi, section: Section, mask: ResolvedLeaf['mask']): Section {
  if (!mask || (mask.include.length === 0 && mask.exclude.length === 0)) return section;

  let result = section;
  const replace = (next: Section): void => {
    if (result !== section) result.delete();
    result = next;
  };

  if (mask.include.length > 0) {
    const include = sectionFromContours(api, mask.include, 'nonzero');
    const next = result.intersect(include);
    include.delete();
    replace(next);
  }
  if (mask.exclude.length > 0) {
    const exclude = sectionFromContours(api, mask.exclude, 'nonzero');
    const next = result.subtract(exclude);
    exclude.delete();
    replace(next);
  }
  return result;
}

export { isEmptyBBox };
