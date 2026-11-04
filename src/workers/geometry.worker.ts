/// <reference lib="webworker" />
import Module from 'manifold-3d';
import type { ManifoldToplevel } from 'manifold-3d';
import wasmUrl from 'manifold-3d/manifold.wasm?url';
import { buildModel } from '@core/solver/buildModel';
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

async function handleBuild(jobId: number, leaves: Parameters<typeof buildModel>[0]['leaves']): Promise<void> {
  const api = await loadApi();
  if (jobId !== latestJobId) return;

  post({ type: 'progress', jobId, stage: 'Построение тел', ratio: 0.1 });

  const started = Date.now();
  const result = buildModel({ api, leaves });
  if (jobId !== latestJobId) return;

  const transfer: Transferable[] = [];
  for (const part of result.parts) {
    transfer.push(part.positions.buffer, part.indices.buffer);
  }

  post(
    {
      type: 'result',
      jobId,
      parts: result.parts,
      stats: { ...result.stats, durationMs: Date.now() - started },
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
