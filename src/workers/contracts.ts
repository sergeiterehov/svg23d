import type { BuildStats, DocumentWarning, PartMesh, ResolvedLeaf } from '@core/model/types';

/** Worker protocol (ADR-0010). */

export interface BuildRequestMessage {
  type: 'build';
  jobId: number;
  leaves: ResolvedLeaf[];
}

export interface CancelRequestMessage {
  type: 'cancel';
  jobId: number;
}

export type WorkerRequest = BuildRequestMessage | CancelRequestMessage;

export interface BuildResponse {
  jobId: number;
  parts: PartMesh[];
  stats: BuildStats;
  warnings: DocumentWarning[];
}

export type WorkerResponse =
  | { type: 'ready' }
  | { type: 'result'; jobId: number; parts: PartMesh[]; stats: BuildStats; warnings: DocumentWarning[] }
  | { type: 'error'; jobId: number; message: string }
  | { type: 'progress'; jobId: number; stage: string; ratio: number };
