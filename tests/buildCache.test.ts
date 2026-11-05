import { beforeAll, describe, expect, it } from 'vitest';
import type { ManifoldToplevel } from 'manifold-3d';
import { loadManifold } from './helpers/manifold';
import {
  buildModel,
  type BuildCache,
  type BuildStage,
  type CachedPart,
} from '@core/solver/buildModel';
import type { Contour, ResolvedLeaf } from '@core/model/types';

const square = (size: number, offsetX = 0, offsetY = 0): Contour[] => [
  [
    { x: offsetX, y: offsetY },
    { x: offsetX + size, y: offsetY },
    { x: offsetX + size, y: offsetY + size },
    { x: offsetX, y: offsetY + size },
  ],
];

function makeLeaf(overrides: Partial<ResolvedLeaf> & { id: string }): ResolvedLeaf {
  return {
    name: overrides.id,
    partId: overrides.id,
    partName: overrides.id,
    order: 0,
    contours: square(100),
    fillRule: 'nonzero',
    color: '#ff0000',
    zFrom: 0,
    zTo: 2,
    clearance: 0,
    chamferTop: 0,
    chamferBottom: 0,
    hidden: false,
    ...overrides,
  };
}

interface CountingCache extends BuildCache {
  hits: number;
  misses: number;
}

function countingCache(): CountingCache {
  const entries = new Map<string, CachedPart>();
  const cache: CountingCache = {
    hits: 0,
    misses: 0,
    get(key) {
      const entry = entries.get(key);
      if (entry) cache.hits++;
      else cache.misses++;
      return entry;
    },
    set(key, value) {
      entries.set(key, value);
    },
  };
  return cache;
}

let api: ManifoldToplevel;

beforeAll(async () => {
  api = await loadManifold();
});

/** A plate and a pin of another part sitting on it: the pin cuts a socket in the plate. */
function plateAndPin(): ResolvedLeaf[] {
  return [
    makeLeaf({ id: 'plate', partId: 'A', order: 0 }),
    makeLeaf({
      id: 'pin',
      partId: 'B',
      order: 1,
      contours: square(20, 40, 40),
      clearance: 0.2,
    }),
  ];
}

describe('part cache (ADR-0039)', () => {
  it('reuses every part when nothing changed', () => {
    const cache = countingCache();
    const leaves = plateAndPin();

    const first = buildModel({ api, leaves, cache });
    expect(cache.misses).toBe(2);
    expect(cache.hits).toBe(0);
    expect(first.parts).toHaveLength(2);

    const second = buildModel({ api, leaves, cache });
    expect(cache.hits).toBe(2);
    expect(cache.misses).toBe(2);
    for (let i = 0; i < first.parts.length; i++) {
      expect(second.parts[i].partId).toBe(first.parts[i].partId);
      expect(second.parts[i].volume).toBeCloseTo(first.parts[i].volume, 3);
      expect(second.parts[i].triangleCount).toBe(first.parts[i].triangleCount);
      expect(second.parts[i].positions.length).toBe(first.parts[i].positions.length);
    }
    // Cached meshes are copies: the ones handed out can be transferred to the main thread.
    expect(second.parts[0].positions).not.toBe(first.parts[0].positions);
  });

  it('rebuilds only the part whose own geometry changed', () => {
    const cache = countingCache();
    buildModel({ api, leaves: plateAndPin(), cache });
    const missesAfterFirst = cache.misses;
    const hitsAfterFirst = cache.hits;

    // The plate is the lowest element: nothing it does affects the pin.
    const leaves = plateAndPin();
    leaves[0] = { ...leaves[0], zTo: 1.5 };
    buildModel({ api, leaves, cache });
    expect(cache.misses).toBe(missesAfterFirst + 1);
    expect(cache.hits).toBe(hitsAfterFirst + 1);
  });

  it('rebuilds the socket owner when a cutter clearance changes', () => {
    const cache = countingCache();
    buildModel({ api, leaves: plateAndPin(), cache });
    const missesAfterFirst = cache.misses;

    // A wider socket changes the plate, not the pin itself.
    const leaves = plateAndPin();
    leaves[1] = { ...leaves[1], clearance: 0.4 };
    buildModel({ api, leaves, cache });
    expect(cache.misses).toBe(missesAfterFirst + 1);
  });

  it('keeps the colour out of the cache key', () => {
    const cache = countingCache();
    buildModel({ api, leaves: plateAndPin(), cache });
    const hitsAfterFirst = cache.hits;

    const leaves = plateAndPin();
    leaves[1] = { ...leaves[1], color: '#00ff00' };
    const result = buildModel({ api, leaves, cache });
    expect(cache.hits).toBe(hitsAfterFirst + 2);
    expect(result.parts.find((part) => part.partId === 'B')?.color).toBe('#00ff00');
  });

  it('keeps a fully hidden part out of the display set on a hit', () => {
    const cache = countingCache();
    const leaves = plateAndPin();
    leaves[1] = { ...leaves[1], hidden: true };

    const first = buildModel({ api, leaves, cache });
    const second = buildModel({ api, leaves, cache });
    expect(second.parts).toHaveLength(2);
    expect(first.displayParts.map((part) => part.partId)).toEqual(['A']);
    expect(second.displayParts.map((part) => part.partId)).toEqual(['A']);
  });
});

describe('build progress (ADR-0039)', () => {
  it('reports the stages in order and ends at 100 %', () => {
    const seen: Array<{ stage: BuildStage; ratio: number }> = [];
    buildModel({
      api,
      leaves: plateAndPin(),
      onProgress: (stage, ratio) => seen.push({ stage, ratio }),
    });

    expect(seen.length).toBeGreaterThan(3);
    expect(seen[0].stage).toBe('sections');
    expect(seen.at(-1)).toEqual({ stage: 'merge', ratio: 1 });

    const order: BuildStage[] = ['sections', 'prisms', 'merge'];
    let lastIndex = 0;
    let lastRatio = -1;
    for (const item of seen) {
      const index = order.indexOf(item.stage);
      expect(index).toBeGreaterThanOrEqual(lastIndex);
      lastIndex = index;
      expect(item.ratio).toBeGreaterThanOrEqual(lastRatio);
      expect(item.ratio).toBeLessThanOrEqual(1);
      lastRatio = item.ratio;
    }
  });

  it('still reaches 100 % when every part comes from the cache', () => {
    const cache = countingCache();
    buildModel({ api, leaves: plateAndPin(), cache });
    const seen: number[] = [];
    buildModel({
      api,
      leaves: plateAndPin(),
      cache,
      onProgress: (_stage, ratio) => seen.push(ratio),
    });
    expect(seen.at(-1)).toBe(1);
  });
});
