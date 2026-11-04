import type {
  BBox,
  BBox3,
  BuildStats,
  DocumentWarning,
  LeafStats,
  PartMesh,
  ResolvedLeaf,
} from '../model/types';
import { emptyBBox3 } from '../model/types';
import { bboxOfContours, bboxIntersects, isEmptyBBox, padBBox } from '../model/defaults';
import { buildPrism } from '../geometry/extrude';
import { meshFromSolid } from '../geometry/mesh';
import {
  offsetSection,
  sectionFromContours,
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

export interface BuildOptions {
  api: ManifoldApi;
  leaves: ResolvedLeaf[];
}

export interface BuildOutput {
  parts: PartMesh[];
  stats: BuildStats;
  leafStats: Record<string, LeafStats>;
  warnings: DocumentWarning[];
}

interface Entry {
  leaf: ResolvedLeaf;
  section: Section;
  bbox: BBox;
}

export function buildModel({ api, leaves }: BuildOptions): BuildOutput {
  const startedAt = Date.now();
  const warnings: DocumentWarning[] = [];
  const leafStats: Record<string, LeafStats> = {};

  const entries: Entry[] = [];
  for (const leaf of leaves) {
    // Zero (or negative) thickness is allowed by the UI: such an element simply is not printed.
    if (!(leaf.zTo - leaf.zFrom > 1e-6)) continue;

    const rawSection = sectionFromContours(api, leaf.contours, leaf.fillRule);
    const section = applyMask(api, rawSection, leaf.mask);
    if (rawSection !== section) rawSection.delete();

    if (section.isEmpty()) {
      section.delete();
      warnings.push({
        nodeId: leaf.id,
        code: 'empty-shape',
        message: `Элемент «${leaf.name}» пуст после разрешения контуров`,
      });
      continue;
    }
    entries.push({ leaf, section, bbox: bboxOfContours(leaf.contours) });
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
        message: `Не удалось построить гнездо для «${leaf.name}»: ${(error as Error).message}`,
      });
      ghostCache.set(leaf.id, null);
      return null;
    } finally {
      if (ghostSection && ghostSection !== entry.section) ghostSection.delete();
    }
  };

  const partSolids = new Map<string, Solid[]>();
  const partMeta = new Map<string, ResolvedLeaf>();

  for (const entry of entries) {
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
      warnings.push({
        nodeId: leaf.id,
        code: 'empty-shape',
        message: `Не удалось построить «${leaf.name}»: ${(error as Error).message}`,
      });
      continue;
    }

    let isCut = false;
    for (const other of entries) {
      if (other === entry) continue;
      if (other.leaf.partId === leaf.partId) continue;
      if (other.leaf.order <= leaf.order) continue;
      if (other.leaf.zFrom >= leaf.zTo || leaf.zFrom >= other.leaf.zTo) continue;
      if (!bboxIntersects(padBBox(entry.bbox, other.leaf.clearance + 0.01), other.bbox)) {
        continue;
      }

      const ghost = ghostFor(other);
      if (!ghost) continue;

      const next: Solid = solid.subtract(ghost);
      solid.delete();
      solid = next;
      isCut = true;
      if (solid.isEmpty()) break;
    }

    if (solid.isEmpty()) {
      solid.delete();
      if (isCut) {
        warnings.push({
          nodeId: leaf.id,
          code: 'fully-cut',
          message: `Элемент «${leaf.name}» полностью перекрыт более высокими элементами: поднимите его в списке слоёв или измените высоты`,
        });
      }
      continue;
    }

    const list = partSolids.get(leaf.partId) ?? [];
    list.push(solid);
    partSolids.set(leaf.partId, list);
    if (!partMeta.has(leaf.partId)) partMeta.set(leaf.partId, leaf);

    const box = solid.boundingBox();
    leafStats[leaf.id] = {
      volume: Math.abs(solid.volume()),
      triangleCount: solid.numTri(),
      bbox: {
        min: [box.min[0], box.min[1], box.min[2]],
        max: [box.max[0], box.max[1], box.max[2]],
      },
    };
  }

  const parts: PartMesh[] = [];
  for (const [partId, solids] of partSolids) {
    const merged = unionSolids(solids);
    if (!merged || merged.isEmpty()) {
      merged?.delete();
      continue;
    }
    const mesh = meshFromSolid(merged);
    merged.delete();

    const meta = partMeta.get(partId);
    parts.push({
      partId,
      name: meta?.partName ?? partId,
      color: meta?.color ?? '#cccccc',
      ...mesh,
    });
  }

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

/** Exported for tests: true when two leaves overlap in Z. */
export function zOverlaps(a: ResolvedLeaf, b: ResolvedLeaf): boolean {
  return a.zFrom < b.zTo && b.zFrom < a.zTo;
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
