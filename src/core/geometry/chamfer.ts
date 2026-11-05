import type { ManifoldApi, Section, Solid } from './section';

/**
 * A 45° chamfer as a true loft (ADR-0040).
 *
 * The stepped build (a stack of thin prisms) represents the slope as a staircase: a 1 mm chamfer
 * needed 40 layers and ~310 thousand triangles for one part, and the boolean union of the layers
 * took seconds. Here the slope is a ruled surface between two cross-sections — one ring of
 * geometry instead of forty.
 *
 * The mesh is assembled by hand and handed to `Manifold.ofMesh`: two caps (triangulated by
 * Manifold itself on a thin slab of the same polygon) and the walls as strips between consecutive
 * rings. Rings come from `CrossSection.offset`, so no vertex correspondence is assumed: a strip is
 * triangulated like a zipper, by arc length.
 *
 * Returns `null` when the shape cannot be lofted safely (a contour disappears at the inset, the
 * mesh is not manifold, …) — the caller then falls back to the stepped build.
 */

type Ring = Array<[number, number]>;

export interface LoftOptions {
  zFrom: number;
  zTo: number;
  /** 45° chamfer size at the bottom, mm. */
  bottom: number;
  /** 45° chamfer size at the top, mm. */
  top: number;
}

/** Vertex welding tolerance, mm: the caps come through a `Float32Array`, the rings stay `number`. */
const WELD = 1e-4;
/** Height of the temporary slab used to get a cap triangulation from Manifold, mm. */
const SLAB = 1e-3;

interface MeshBuilder {
  positions: number[];
  triangles: number[];
  index: Map<string, number>;
  vertex(x: number, y: number, z: number): number;
}

function createBuilder(): MeshBuilder {
  const index = new Map<string, number>();
  const positions: number[] = [];
  const triangles: number[] = [];
  return {
    positions,
    triangles,
    index,
    vertex(x, y, z) {
      const key = `${Math.round(x / WELD)},${Math.round(y / WELD)},${Math.round(z / WELD)}`;
      const found = index.get(key);
      if (found !== undefined) return found;
      const id = positions.length / 3;
      positions.push(x, y, z);
      index.set(key, id);
      return id;
    },
  };
}

/** Normalised cumulative arc length; `t[i]` for i in [0, n], `t[n] = 1`. */
function parameters(ring: Ring): number[] {
  const t = [0];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    t.push(t[i] + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  const total = t[t.length - 1] || 1;
  return t.map((value) => value / total);
}

/** Point of the ring at parameter `t` (linear along the polygon's edge). */
function sampleAt(ring: Ring, t: number[], at: number): [number, number] {
  const n = ring.length;
  let index = 0;
  while (index + 1 < n && t[index + 1] < at) index++;
  const a = ring[index];
  const b = ring[(index + 1) % n];
  const t0 = t[index];
  const t1 = index + 1 < n ? t[index + 1] : 1;
  const f = t1 > t0 ? (at - t0) / (t1 - t0) : 0;
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
}

/** Rotates a ring so that it starts next to `reference[0]`: offset rings come back rotated. */
function alignRing(ring: Ring, reference: Ring): Ring {
  const [x, y] = reference[0];
  let best = 0;
  let bestDistance = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const distance = Math.hypot(ring[i][0] - x, ring[i][1] - y);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = i;
    }
  }
  if (best === 0) return ring;
  return [...ring.slice(best), ...ring.slice(0, best)];
}

/**
 * Samples every ring at the union of their vertex parameters: the original vertices stay exactly
 * where they were, and all rings get the same number of points, so the strips are plain quads
 * instead of long thin triangles — the exact boolean engine crawls on slivers. The rings are
 * rotated to a common start first, otherwise the same parameter means different places.
 */
function matchRings(rings: Ring[]): Ring[] {
  const aligned = rings.map((ring, index) => (index === 0 ? ring : alignRing(ring, rings[0])));
  const params = aligned.map(parameters);
  const merged: number[] = [];
  for (const t of params) {
    for (let i = 0; i + 1 < t.length; i++) merged.push(t[i]);
  }
  merged.sort((a, b) => a - b);
  const values: number[] = [];
  for (const t of merged) {
    if (values.length === 0 || t - values[values.length - 1] > 1e-9) values.push(t);
  }
  return aligned.map((ring, index) => values.map((t) => sampleAt(ring, params[index], t)));
}

/** Quad strip between two equally sampled rings. */
function addStrip(
  mesh: MeshBuilder,
  lower: Ring,
  upper: Ring,
  zLower: number,
  zUpper: number,
): void {
  const n = lower.length;
  if (n < 3 || upper.length !== n) return;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const a0 = mesh.vertex(lower[i][0], lower[i][1], zLower);
    const a1 = mesh.vertex(lower[j][0], lower[j][1], zLower);
    const b1 = mesh.vertex(upper[j][0], upper[j][1], zUpper);
    const b0 = mesh.vertex(upper[i][0], upper[i][1], zUpper);
    mesh.triangles.push(a0, a1, b1, a0, b1, b0);
  }
}

/**
 * Appends the triangulation of `rings` at height `z`. Manifold triangulates the polygon on a thin
 * slab, so its own robust triangulator is reused; the slab is thrown away immediately. The slab's
 * vertices are snapped back to the ring vertices, so the cap and the walls share exact indices.
 */
function addCap(api: ManifoldApi, mesh: MeshBuilder, rings: Ring[], z: number, up: boolean): void {
  if (rings.length === 0) return;
  const polygons = rings.map((ring) => ring.map(([x, y]) => [x, y] as [number, number]));
  const section = new api.CrossSection(polygons, 'NonZero');
  const slab = section.extrude(SLAB);
  section.delete();
  const meshData = slab.getMesh();
  slab.delete();

  const stride = meshData.numProp ?? 3;
  const vertexAt = (index: number): [number, number, number] => [
    meshData.vertProperties[index * stride],
    meshData.vertProperties[index * stride + 1],
    meshData.vertProperties[index * stride + 2],
  ];

  // Snap by (x, y) to the ring vertices: the slab is a float32 round-trip, the rings are not.
  const grid = new Map<string, Array<[number, number]>>();
  const CELL = 0.05;
  const keyOf = (ix: number, iy: number): string => `${ix},${iy}`;
  for (const ring of rings) {
    for (const point of ring) {
      const key = keyOf(Math.floor(point[0] / CELL), Math.floor(point[1] / CELL));
      const list = grid.get(key);
      if (list) list.push(point);
      else grid.set(key, [point]);
    }
  }
  const snap = (x: number, y: number): [number, number] | null => {
    const ix = Math.floor(x / CELL);
    const iy = Math.floor(y / CELL);
    let best: [number, number] | null = null;
    let bestDistance = 1e-2;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const list = grid.get(keyOf(ix + dx, iy + dy));
        if (!list) continue;
        for (const point of list) {
          const distance = Math.hypot(point[0] - x, point[1] - y);
          if (distance < bestDistance) {
            bestDistance = distance;
            best = point;
          }
        }
      }
    }
    return best;
  };

  const top = SLAB * 0.5;
  for (let t = 0; t + 2 < meshData.triVerts.length; t += 3) {
    const ids = [meshData.triVerts[t], meshData.triVerts[t + 1], meshData.triVerts[t + 2]];
    const points = ids.map(vertexAt);
    const isTop = points.every((point) => point[2] > top);
    if (isTop !== up) continue;
    const snapped = points.map((point) => snap(point[0], point[1]));
    if (snapped.some((point) => point === null)) continue;
    const [a, b, c] = snapped as Array<[number, number]>;
    const ia = mesh.vertex(a[0], a[1], z);
    const ib = mesh.vertex(b[0], b[1], z);
    const ic = mesh.vertex(c[0], c[1], z);
    if (ia === ib || ib === ic || ia === ic) continue;
    mesh.triangles.push(ia, ib, ic);
  }
}

/** The polygons of a section, or `null` when the inset makes a contour disappear. */
function ringOf(section: Section, delta: number): Ring[] | null {
  if (delta < 1e-6) return section.toPolygons() as Ring[];
  const offset = section.offset(-delta, 'Miter', 2, 16);
  const rings = offset.toPolygons() as Ring[];
  offset.delete();
  return rings.length > 0 ? rings : null;
}

/** True when every ring has the same number of contours — a strip is paired contour by contour. */
function sameTopology(a: Ring[], b: Ring[]): boolean {
  return a.length === b.length;
}

export function buildLoftedPrism(
  api: ManifoldApi,
  section: Section,
  options: LoftOptions,
): Solid | null {
  const { zFrom, zTo } = options;
  const bottom = Math.max(0, options.bottom);
  const top = Math.max(0, options.top);
  if (!(bottom > 1e-6) && !(top > 1e-6)) return null;

  const full = section.toPolygons() as Ring[];
  if (full.length === 0) return null;
  const lowRing = bottom > 1e-6 ? ringOf(section, bottom) : full;
  const highRing = top > 1e-6 ? ringOf(section, top) : full;
  if (!lowRing || !highRing) return null;
  if (!sameTopology(full, lowRing) || !sameTopology(full, highRing)) return null;

  const mesh = createBuilder();
  const zLow = zFrom;
  const zMiddleLow = zFrom + bottom;
  const zMiddleHigh = zTo - top;
  const zHigh = zTo;

  const lowMatched: Ring[] = [];
  const highMatched: Ring[] = [];

  // Walls: chamfer, vertical band, chamfer. All three rings of a contour share one sampling.
  for (let i = 0; i < full.length; i++) {
    const [low, middle, high] = matchRings([lowRing[i], full[i], highRing[i]]);
    lowMatched.push(low);
    highMatched.push(high);
    if (bottom > 1e-6) addStrip(mesh, low, middle, zLow, zMiddleLow);
    if (zMiddleHigh - zMiddleLow > 1e-6) {
      addStrip(mesh, middle, middle, zMiddleLow, zMiddleHigh);
    }
    if (top > 1e-6) addStrip(mesh, middle, high, zMiddleHigh, zHigh);
  }

  // Caps: the bottom face looks down, the top face looks up.
  addCap(api, mesh, lowMatched, zLow, false);
  addCap(api, mesh, highMatched, zHigh, true);

  if (mesh.triangles.length === 0) return null;

  try {
    const input = new api.Mesh({
      numProp: 3,
      vertProperties: new Float32Array(mesh.positions),
      triVerts: new Uint32Array(mesh.triangles),
    });
    const solid = api.Manifold.ofMesh(input);
    if (solid.status() !== 'NoError' || solid.isEmpty()) {
      solid.delete();
      return null;
    }
    return solid;
  } catch {
    return null;
  }
}
