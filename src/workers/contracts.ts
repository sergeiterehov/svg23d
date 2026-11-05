import type {
  BuildStats,
  DocumentWarning,
  LeafStats,
  PartMesh,
  ResolvedLeaf,
} from '@core/model/types';
import type { Locale } from '@i18n';

/** Worker protocol (ADR-0010). */

export interface BuildRequestMessage {
  type: 'build';
  jobId: number;
  leaves: ResolvedLeaf[];
  /** The worker has its own module state, so the language travels with every job (ADR-0037). */
  locale: Locale;
}

export interface CancelRequestMessage {
  type: 'cancel';
  jobId: number;
}

export type WorkerRequest = BuildRequestMessage | CancelRequestMessage;

export interface BuildResponse {
  jobId: number;
  parts: PartMesh[];
  displayParts: PartMesh[];
  stats: BuildStats;
  leafStats: Record<string, LeafStats>;
  warnings: DocumentWarning[];
}

export type WorkerResponse =
  | { type: 'ready' }
  | {
      type: 'result';
      jobId: number;
      parts: PartMesh[];
      displayParts: PartMesh[];
      stats: BuildStats;
      leafStats: Record<string, LeafStats>;
      warnings: DocumentWarning[];
    }
  | { type: 'error'; jobId: number; message: string }
  | { type: 'progress'; jobId: number; stage: string; ratio: number };
