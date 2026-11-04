/**
 * Palette reduction: fewer colours for the model while staying as close as possible to the original
 * ones (see ADR-0024).
 *
 * The set of colours really used by the model is small (one per shape, dozens at most) and weighted by
 * the area each colour covers, so **weighted k-means** on that set is both fast and meaningful: it
 * minimises the same sum of squared deviations the eye cares about, only not in sRGB.
 *
 * Distances are measured in **OKLab**, a perceptually uniform space: two colours that differ by the
 * same amount in OKLab look equally different, which is not true in sRGB (green differs far more than
 * blue for the same numeric delta). Centroids are averaged in OKLab too.
 *
 * The result is deterministic: seeding is "farthest point first" from the heaviest colour, plus a few
 * restarts from the other heavy colours, and the run with the smallest deviation wins.
 */

export interface PaletteEntry {
  /** Normalised `#rrggbb` colour. */
  color: string;
  /** How much of the model carries this colour — the footprint area in mm². */
  weight: number;
}

/**
 * Colours actually used by the model, each weighted by the area it covers (footprint bounding box in
 * mm²). A colour seen on a larger area is the one the eye notices, so it weighs more in k-means.
 */
export function paletteUsage(
  leaves: ReadonlyArray<{
    color: string;
    contours: ReadonlyArray<ReadonlyArray<{ x: number; y: number }>>;
  }>,
): PaletteEntry[] {
  const usage = new Map<string, number>();
  for (const leaf of leaves) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const contour of leaf.contours) {
      for (const point of contour) {
        if (point.x < minX) minX = point.x;
        if (point.y < minY) minY = point.y;
        if (point.x > maxX) maxX = point.x;
        if (point.y > maxY) maxY = point.y;
      }
    }
    const area = Number.isFinite(minX) ? Math.max(maxX - minX, 0) * Math.max(maxY - minY, 0) : 0;
    usage.set(leaf.color, (usage.get(leaf.color) ?? 0) + Math.max(area, 1e-6));
  }
  return [...usage.entries()].map(([color, weight]) => ({ color, weight }));
}

export interface PaletteCluster {
  color: string;
  weight: number;
}

export interface PaletteReduction {
  /** Original colour → the colour of its cluster. Colours that cannot be parsed map to themselves. */
  mapping: Map<string, string>;
  /** Cluster colours with their total weight, heaviest first. */
  palette: PaletteCluster[];
  /** Weighted sum of squared OKLab distances from the originals to their clusters. */
  deviation: number;
}

type Lab = [number, number, number];

const MAX_ITERATIONS = 64;
const MAX_RESTARTS = 12;

function srgbToLinear(value: number): number {
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function linearToSrgb(value: number): number {
  return value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055;
}

/** `#rrggbb` → OKLab. `null` for anything that is not a plain hex colour (e.g. `none`). */
export function hexToOklab(hex: string): Lab | null {
  const match = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return null;
  const value = Number.parseInt(match[1] as string, 16);
  const r = srgbToLinear(((value >> 16) & 0xff) / 255);
  const g = srgbToLinear(((value >> 8) & 0xff) / 255);
  const b = srgbToLinear((value & 0xff) / 255);

  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);

  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/** OKLab → `#rrggbb`, clamped to the sRGB gamut. */
export function oklabToHex([L, a, b]: Lab): string {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;

  const channels = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map((channel) => {
    const byte = Math.round(linearToSrgb(Math.min(Math.max(channel, 0), 1)) * 255);
    return Math.min(Math.max(byte, 0), 255).toString(16).padStart(2, '0');
  });

  return `#${channels.join('')}`;
}

function distanceSquared(a: Lab, b: Lab): number {
  const dL = a[0] - b[0];
  const da = a[1] - b[1];
  const db = a[2] - b[2];
  return dL * dL + da * da + db * db;
}

interface Point {
  color: string;
  lab: Lab;
  weight: number;
}

/** Weighted mean of the assigned points. */
function centroid(points: Point[], members: number[]): Lab {
  let sum = 0;
  let l = 0;
  let a = 0;
  let b = 0;
  for (const index of members) {
    const point = points[index] as Point;
    sum += point.weight;
    l += point.lab[0] * point.weight;
    a += point.lab[1] * point.weight;
    b += point.lab[2] * point.weight;
  }
  if (sum <= 0) return [0, 0, 0];
  return [l / sum, a / sum, b / sum];
}

/** Assigns every point to its nearest centroid and returns both the clusters and the deviation. */
function assign(points: Point[], centroids: Lab[]): { members: number[][]; deviation: number } {
  const members: number[][] = centroids.map(() => []);
  let deviation = 0;
  points.forEach((point, index) => {
    let best = 0;
    let bestDistance = Infinity;
    centroids.forEach((centroidLab, cluster) => {
      const distance = distanceSquared(point.lab, centroidLab);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = cluster;
      }
    });
    (members[best] as number[]).push(index);
    deviation += bestDistance * point.weight;
  });
  return { members, deviation };
}

/** One Lloyd run: assign, move each centroid to the mean of its cluster, repeat until it settles. */
function lloyd(points: Point[], seeds: Lab[]): { centroids: Lab[]; deviation: number } {
  let centroids = seeds;
  let result = assign(points, centroids);
  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration += 1) {
    const next = centroids.map((centroidLab, cluster) => {
      const members = result.members[cluster] as number[];
      return members.length > 0 ? centroid(points, members) : centroidLab;
    });
    const assigned = assign(points, next);
    const settled = assigned.deviation >= result.deviation - 1e-12;
    centroids = next;
    result = assigned;
    if (settled) break;
  }
  return { centroids, deviation: result.deviation };
}

/** Farthest-point seeding: every next seed is the colour furthest from the ones already picked. */
function farthestFirst(points: Point[], k: number, first: number): Lab[] {
  const seeds: Lab[] = [points[first]!.lab];
  while (seeds.length < k) {
    let bestIndex = -1;
    let bestDistance = -1;
    points.forEach((point, index) => {
      const nearest = Math.min(...seeds.map((seed) => distanceSquared(point.lab, seed)));
      if (nearest > bestDistance) {
        bestDistance = nearest;
        bestIndex = index;
      }
    });
    if (bestIndex < 0) break;
    seeds.push(points[bestIndex]!.lab);
  }
  return seeds;
}

/**
 * Reduces the palette to at most `limit` colours.
 *
 * @param entries colours used by the model with their weights (area in mm²)
 * @param limit maximum number of colours to keep (1…)
 */
export function reducePalette(entries: PaletteEntry[], limit: number): PaletteReduction {
  const mapping = new Map<string, string>();
  const byColor = new Map<string, Point>();

  for (const entry of entries) {
    const lab = hexToOklab(entry.color);
    if (!lab) {
      // Not a plain hex colour (`none`, a pattern, …): it keeps its own value.
      mapping.set(entry.color, entry.color);
      continue;
    }
    const weight = Math.max(entry.weight, 0);
    const existing = byColor.get(entry.color);
    if (existing) existing.weight += weight;
    else byColor.set(entry.color, { color: entry.color, lab, weight });
  }

  const points = [...byColor.values()];
  const target = Math.max(1, Math.min(Math.round(limit), points.length));

  if (points.length === 0) return { mapping, palette: [], deviation: 0 };
  if (target >= points.length) {
    for (const point of points) mapping.set(point.color, point.color);
    return {
      mapping,
      palette: points
        .map((point) => ({ color: point.color, weight: point.weight }))
        .sort((a, b) => b.weight - a.weight),
      deviation: 0,
    };
  }

  // Heaviest first: the eye notices a colour that covers a large area, and the seeding follows that.
  const order = points
    .map((point, index) => ({ point, index }))
    .sort((a, b) => b.point.weight - a.point.weight || a.index - b.index)
    .map((item) => item.index);

  let best: { centroids: Lab[]; deviation: number } | null = null;
  for (const seed of order.slice(0, Math.min(order.length, MAX_RESTARTS))) {
    const candidate = lloyd(points, farthestFirst(points, target, seed));
    if (!best || candidate.deviation < best.deviation - 1e-12) best = candidate;
  }
  if (!best) return { mapping, palette: [], deviation: 0 };

  const centroids = best.centroids.map((lab) => oklabToHex(lab));
  const palette = new Map<string, number>();
  points.forEach((point) => {
    let bestCluster = 0;
    let bestDistance = Infinity;
    best.centroids.forEach((centroidLab, cluster) => {
      const distance = distanceSquared(point.lab, centroidLab);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestCluster = cluster;
      }
    });
    const hex = centroids[bestCluster] as string;
    mapping.set(point.color, hex);
    palette.set(hex, (palette.get(hex) ?? 0) + point.weight);
  });

  return {
    mapping,
    palette: [...palette.entries()]
      .map(([color, weight]) => ({ color, weight }))
      .sort((a, b) => b.weight - a.weight),
    deviation: best.deviation,
  };
}
