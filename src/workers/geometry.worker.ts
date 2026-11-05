/// <reference lib="webworker" />
import Module from 'manifold-3d';
import type { ManifoldToplevel } from 'manifold-3d';
import wasmUrl from 'manifold-3d/manifold.wasm?url';
import {
  buildModel,
  type BuildCache,
  type BuildStage,
  type CachedPart,
} from '@core/solver/buildModel';
import { setLocale } from '@i18n';
import type { WorkerRequest, WorkerResponse } from './contracts';

/**
 * Geometry worker. Owns a single Manifold WASM instance and rebuilds the model on demand.
 * Stale jobs are dropped: every response carries the jobId it belongs to.
 */

interface WorkerScope {
  postMessage(message: WorkerResponse, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
}

const scope = self as unknown as WorkerScope;

let apiPromise: Promise<ManifoldToplevel> | null = null;
let latestJobId = 0;

function loadApi(): Promise<ManifoldToplevel> {
  if (!apiPromise) {
    apiPromise = Module({ locateFile: () => wasmUrl }).then((module) => {
      module.setup();
      return module;
    });
  }
  return apiPromise;
}

function post(message: WorkerResponse, transfer?: Transferable[]): void {
  scope.postMessage(message, transfer);
}

/**
 * Finished parts survive between jobs (ADR-0039): editing one element re-cuts only the parts that
 * depend on it. The limit keeps the memory of a long session bounded — the oldest entry goes first.
 */
const PART_CACHE_LIMIT = 64;
const partCache = new Map<string, CachedPart>();
const cache: BuildCache = {
  get(key) {
    const entry = partCache.get(key);
    if (entry) {
      // Refresh the recency: Map keeps insertion order.
      partCache.delete(key);
      partCache.set(key, entry);
    }
    return entry;
  },
  set(key, value) {
    partCache.set(key, value);
    while (partCache.size > PART_CACHE_LIMIT) {
      const oldest = partCache.keys().next().value;
      if (oldest === undefined) break;
      partCache.delete(oldest);
    }
  },
};

async function handleBuild(
  jobId: number,
  leaves: Parameters<typeof buildModel>[0]['leaves'],
): Promise<void> {
  const api = await loadApi();
  if (jobId !== latestJobId) return;

  // The worker thread is busy during the build, but the messages reach the main thread right away.
  let lastStage: BuildStage | null = null;
  let lastRatio = -1;
  let lastAt = 0;
  const onProgress = (stage: BuildStage, ratio: number): void => {
    const now = Date.now();
    const ratioStep = ratio - lastRatio;
    const worthSending =
      stage !== lastStage || ratioStep >= 0.02 || now - lastAt >= 250 || ratio >= 1;
    if (!worthSending || (now - lastAt < 40 && ratio < 1)) return;
    lastStage = stage;
    lastRatio = ratio;
    lastAt = now;
    post({ type: 'progress', jobId, stage, ratio });
  };

  const started = Date.now();
  const result = buildModel({ api, leaves, cache, onProgress });
  if (jobId !== latestJobId) return;

  const transfer: Transferable[] = [];
  // A part without hidden leaves is the same object in both lists, so buffers are deduplicated:
  // transferring one buffer twice throws.
  const buffers = new Set<ArrayBufferLike>();
  for (const part of [...result.parts, ...result.displayParts]) {
    if (buffers.has(part.positions.buffer)) continue;
    buffers.add(part.positions.buffer);
    buffers.add(part.indices.buffer);
  }
  transfer.push(...(buffers as Set<ArrayBuffer>));

  post(
    {
      type: 'result',
      jobId,
      parts: result.parts,
      displayParts: result.displayParts,
      stats: { ...result.stats, durationMs: Date.now() - started },
      leafStats: result.leafStats,
      warnings: result.warnings,
    },
    transfer,
  );
}

scope.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const message = event.data;
  if (message.type === 'cancel') {
    latestJobId = Math.max(latestJobId, message.jobId);
    return;
  }
  if (message.type === 'build') {
    latestJobId = message.jobId;
    // The warnings are built in the worker: it has to speak the language the UI is showing.
    setLocale(message.locale);
    handleBuild(message.jobId, message.leaves).catch((error: unknown) => {
      post({
        type: 'error',
        jobId: message.jobId,
        message: error instanceof Error ? error.message : String(error),
      });
    });
  }
};

post({ type: 'ready' });
