import type { ManifoldToplevel } from 'manifold-3d';
import type { Contour, FillRule } from '../model/types';

/** The initialised Manifold module (WASM). Passed explicitly — no singletons in the core. */
export type ManifoldApi = ManifoldToplevel;

export type Section = InstanceType<ManifoldApi['CrossSection']>;
export type Solid = InstanceType<ManifoldApi['Manifold']>;

/** Contours (mm) → Clipper-compatible polygons. */
export function toPolygons(contours: Contour[]): Array<Array<[number, number]>> {
  const polygons: Array<Array<[number, number]>> = [];
  for (const contour of contours) {
    if (contour.length < 3) continue;
    polygons.push(contour.map((p) => [p.x, p.y] as [number, number]));
  }
  return polygons;
}

/**
 * Builds a CrossSection: this is where self-intersections, holes and winding are resolved
 * according to the SVG fill rule (ADR-0011).
 */
export function sectionFromContours(
  api: ManifoldApi,
  contours: Contour[],
  fillRule: FillRule,
): Section {
  const polygons = toPolygons(contours);
  const rule = fillRule === 'evenodd' ? 'EvenOdd' : 'NonZero';
  return new api.CrossSection(polygons, rule);
}

/** Grows (positive delta) or shrinks (negative delta) a section. */
export function offsetSection(section: Section, delta: number): Section {
  if (Math.abs(delta) < 1e-9) return section;
  // Miter joins keep sharp corners intact; the limit prevents extreme spikes.
  return section.offset(delta, 'Miter', 2, 16);
}

/** Union of sections, consuming (deleting) all inputs. */
export function unionSections(sections: Section[]): Section | null {
  if (sections.length === 0) return null;
  let accumulator = sections[0];
  for (let i = 1; i < sections.length; i++) {
    const next = accumulator.add(sections[i]);
    accumulator.delete();
    sections[i].delete();
    accumulator = next;
  }
  return accumulator;
}

/** Union of solids, consuming (deleting) all inputs. */
export function unionSolids(solids: Solid[]): Solid | null {
  if (solids.length === 0) return null;
  let accumulator = solids[0];
  for (let i = 1; i < solids.length; i++) {
    const next = accumulator.add(solids[i]);
    accumulator.delete();
    solids[i].delete();
    accumulator = next;
  }
  return accumulator;
}

export function sectionArea(section: Section): number {
  return section.area();
}
