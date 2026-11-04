import type { ResolvedLeaf } from '@core/model/types';
import type { BuildResponse, WorkerRequest, WorkerResponse } from './contracts';

/** Error thrown when a build is superseded by a newer one. */
export class BuildCancelledError extends Error {
  constructor() {
    super('Построение отменено');
    this.name = 'BuildCancelledError';
  }
}

interface Pending {
  jobId: number;
  resolve: (value: BuildResponse) => void;
  reject: (error: Error) => void;
}

/** Main-thread facade over the geometry worker. */
export class GeometryClient {
  private worker: Worker | null = null;
  private jobCounter = 0;
  private pending: Pending | null = null;
  private ready: Promise<void>;
  private readyResolve: (() => void) | null = null;

  constructor() {
    this.ready = new Promise((resolve) => {
      this.readyResolve = resolve;
    });
    this.worker = new Worker(new URL('./geometry.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => this.handleMessage(event.data);
    this.worker.onerror = (event) => {
      this.failAll(new Error(event.message || 'Ошибка геометрического воркера'));
    };
  }

  /** Rebuilds the model. Any in-flight build is cancelled. */
  async build(leaves: ResolvedLeaf[]): Promise<BuildResponse> {
    await this.ready;
    this.cancelPending();

    const jobId = ++this.jobCounter;
    const message: WorkerRequest = { type: 'build', jobId, leaves };

    return new Promise<BuildResponse>((resolve, reject) => {
      this.pending = { jobId, resolve, reject };
      this.worker?.postMessage(message);
    });
  }

  cancelPending(): void {
    if (!this.pending) return;
    const pending = this.pending;
    this.pending = null;
    this.worker?.postMessage({ type: 'cancel', jobId: this.jobCounter } satisfies WorkerRequest);
    pending.reject(new BuildCancelledError());
  }

  dispose(): void {
    this.failAll(new Error('Клиент геометрии закрыт'));
    this.worker?.terminate();
    this.worker = null;
  }

  private handleMessage(message: WorkerResponse): void {
    if (message.type === 'ready') {
      this.readyResolve?.();
      this.readyResolve = null;
      return;
    }
    if (message.type === 'progress') return;
    const pending = this.pending;
    if (!pending || pending.jobId !== message.jobId) return;
    this.pending = null;
    if (message.type === 'result') {
      pending.resolve({
        jobId: message.jobId,
        parts: message.parts,
        displayParts: message.displayParts,
        stats: message.stats,
        leafStats: message.leafStats,
        warnings: message.warnings,
      });
    } else {
      pending.reject(new Error(message.message));
    }
  }

  private failAll(error: Error): void {
    const pending = this.pending;
    this.pending = null;
    pending?.reject(error);
  }
}
