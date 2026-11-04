import { create } from 'zustand';
import { DEFAULT_GLOBAL_SETTINGS } from '@core/model/defaults';
import {
  PROJECT_VERSION,
  type BuildStats,
  type DocumentWarning,
  type GlobalSettings,
  type LeafStats,
  type NodeSettings,
  type PartMesh,
  type Project,
  type ResolvedLeaf,
  type ViewSettings,
} from '@core/model/types';
import {
  PROJECT_FILE_EXTENSION,
  PROJECT_MIME,
  parseProjectFile,
  serializeProject,
} from '@core/model/project';
import { parseSvg, SvgParseError } from '@core/svg/parseSvg';
import { createEmptyDocument, createEmptyProject, isEmptyDocument } from '@core/model/empty';
import { constrainGlobalPatch, constrainNodePatch } from '@core/model/limits';
import { resolveLeaves, type PartInfo } from '@core/solver/resolveLeaves';
import { findNode } from '@core/solver/resolveLeaves';
import { findPartRoots } from '@core/solver/resolveLeaves';
import { effectiveSettingsFor } from '@core/solver/inheritance';
import { findParent, shiftChildOrder } from '@core/solver/order';
import { distributeLayers } from '@core/solver/distribute';
import { writeThreeMf } from '@core/export/threemf';
import { writeBinaryStl } from '@core/export/stl';
import { baseName, downloadBytes } from '@core/export/download';
import { BuildCancelledError, GeometryClient } from '@workers/geometryClient';
import sampleSvg from '../../../samples/html5.svg?raw';
import landscapeSvg from '../../../samples/landscape.svg?raw';
import nameSvg from '../../../samples/name.svg?raw';

export type ViewMode = '2d' | '3d';
export type Status = 'empty' | 'building' | 'ready' | 'error';
export type ExampleId = 'html5' | 'landscape' | 'name';

export const EXAMPLES: Record<
  ExampleId,
  { fileName: string; source: string; label: string; description: string }
> = {
  html5: {
    fileName: 'html5.svg',
    source: sampleSvg,
    label: 'HTML5',
    description: 'Логотип HTML5',
  },
  landscape: {
    fileName: 'landscape.svg',
    source: landscapeSvg,
    label: 'Пейзаж',
    description: 'Пейзаж со слоями',
  },
  name: {
    fileName: 'name.svg',
    source: nameSvg,
    label: 'Текст',
    description: 'Текст с обводкой',
  },
};

const REBUILD_DEBOUNCE_MS = 140;
/** Step of the height arrows drawn on the model, in mm. */
export const HEIGHT_STEP_MM = 0.5;
const HISTORY_LIMIT = 60;
/** Consecutive edits of the same field within this window form one undo step. */
const HISTORY_COALESCE_MS = 800;

interface Snapshot {
  settings: Record<string, NodeSettings>;
  global: GlobalSettings;
}

let client: GeometryClient | null = null;
let rebuildTimer: ReturnType<typeof setTimeout> | null = null;
/** A build is running in the worker; `rebuildQueued` collapses all newer requests into one. */
let buildInFlight = false;
let rebuildQueued = false;
let lastCommit: { key: string; time: number } | null = null;

function getClient(): GeometryClient {
  if (!client) client = new GeometryClient();
  return client;
}

export interface BuildResultState {
  parts: PartMesh[];
  stats: BuildStats;
  leafStats: Record<string, LeafStats>;
  warnings: DocumentWarning[];
}

interface AppState {
  project: Project | null;
  leaves: ResolvedLeaf[];
  parts: PartInfo[];
  modelSize: { widthMm: number; heightMm: number } | null;
  warnings: DocumentWarning[];
  result: BuildResultState | null;
  status: Status;
  error: string | null;
  selectedIds: string[];
  hoveredId: string | null;
  viewMode: ViewMode;
  exporting: boolean;
  past: Snapshot[];
  future: Snapshot[];

  loadSvgText: (text: string, fileName: string) => void;
  loadExample: (id: ExampleId) => void;
  openProject: (text: string) => void;
  saveProject: () => void;
  undo: () => void;
  redo: () => void;
  shiftNode: (nodeId: string, direction: 1 | -1) => void;
  distributeZ: () => void;
  updateSettings: (nodeId: string, patch: NodeSettings) => void;
  /** Applies per-node patches as one undo step (multi-selection editing). */
  updateSettingsBatch: (
    patches: Record<string, NodeSettings>,
    options?: { immediate?: boolean },
  ) => void;
  /** Height arrows: shift «от»/«до» of the selection by `delta`; `immediate` skips the rebuild debounce. */
  nudgeHeight: (key: 'zFrom' | 'zTo', delta: number, immediate?: boolean) => void;
  updateGlobal: (patch: Partial<GlobalSettings>) => void;
  /** Display-only settings: never schedule a rebuild. */
  updateView: (patch: Partial<ViewSettings>) => void;
  /** Replaces the selection with a single node (`null` clears it). */
  select: (nodeId: string | null) => void;
  /** Adds or removes one node from the selection (⌘/Ctrl-click). */
  toggleSelected: (nodeId: string) => void;
  /** Replaces the selection with the given nodes (Shift-click range in the tree). */
  selectMany: (nodeIds: string[]) => void;
  /** Selects every printable part (⌘/Ctrl+A). */
  selectAll: () => void;
  hover: (nodeId: string | null) => void;
  setViewMode: (mode: ViewMode) => void;
  rebuild: () => void;
  exportThreeMf: () => void;
  exportStl: () => void;
  reset: () => void;
}

export const useProjectStore = create<AppState>()((set, get) => ({
  project: createEmptyProject(),
  leaves: [],
  parts: [],
  modelSize: null,
  warnings: [],
  result: null,
  status: 'empty',
  error: null,
  selectedIds: [],
  hoveredId: null,
  viewMode: '3d',
  exporting: false,
  past: [],
  future: [],

  loadSvgText: (text, fileName) => {
    try {
      // Project defaults set before the import survive it: they describe the machine and the
      // material, not the document.
      const global = { ...(get().project?.global ?? DEFAULT_GLOBAL_SETTINGS) };
      const document = parseSvg(text, { fileName, global });
      const project: Project = {
        version: PROJECT_VERSION,
        fileName,
        source: text,
        document,
        settings: {},
        global,
      };
      lastCommit = null;
      set({
        project,
        selectedIds: [],
        hoveredId: null,
        result: null,
        error: null,
        status: isEmptyDocument(document) ? 'empty' : 'building',
        past: [],
        future: [],
      });
      scheduleRebuild(set, get, 0);
    } catch (error) {
      const message =
        error instanceof SvgParseError
          ? error.message
          : `Не удалось прочитать файл: ${String(error)}`;
      // Keep the current project: a broken file must not throw away the work in progress.
      set({ status: 'error', error: message });
    }
  },

  openProject: (text) => {
    try {
      const file = parseProjectFile(text);
      const document = file.source.trim()
        ? parseSvg(file.source, { fileName: file.fileName, global: file.global })
        : createEmptyDocument(file.fileName);
      const project: Project = {
        version: PROJECT_VERSION,
        fileName: file.fileName,
        source: file.source,
        document,
        settings: file.settings,
        global: file.global,
      };
      lastCommit = null;
      set({
        project,
        selectedIds: [],
        hoveredId: null,
        result: null,
        error: null,
        status: isEmptyDocument(document) ? 'empty' : 'building',
        past: [],
        future: [],
      });
      scheduleRebuild(set, get, 0);
    } catch (error) {
      set({ status: 'error', error: (error as Error).message });
    }
  },

  saveProject: () => {
    const { project } = get();
    if (!project) return;
    const json = serializeProject(project);
    downloadBytes(
      new TextEncoder().encode(json),
      `${baseName(project.fileName)}.${PROJECT_FILE_EXTENSION}`,
      PROJECT_MIME,
    );
  },

  undo: () => {
    const { project, past, future } = get();
    if (!project || past.length === 0) return;
    const previous = past[past.length - 1];
    lastCommit = null;
    set({
      project: { ...project, settings: previous.settings, global: previous.global },
      past: past.slice(0, -1),
      future: [{ settings: project.settings, global: project.global }, ...future],
    });
    scheduleRebuild(set, get, 0);
  },

  redo: () => {
    const { project, past, future } = get();
    if (!project || future.length === 0) return;
    const next = future[0];
    lastCommit = null;
    set({
      project: { ...project, settings: next.settings, global: next.global },
      past: [...past, { settings: project.settings, global: project.global }],
      future: future.slice(1),
    });
    scheduleRebuild(set, get, 0);
  },

  /** Moves a node one step up/down in the cut order (its parent's manual child order). */
  shiftNode: (nodeId, direction) => {
    const { project } = get();
    if (!project) return;
    const parent = findParent(project.document.root, nodeId);
    if (!parent) return;
    const next = shiftChildOrder(parent, nodeId, direction, project.settings);
    if (!next) return;

    pushHistory(set, get, `order:${parent.id}`);
    set({
      project: {
        ...project,
        settings: {
          ...project.settings,
          [parent.id]: { ...(project.settings[parent.id] ?? {}), childOrder: next },
        },
      },
    });
    scheduleRebuild(set, get, 0);
  },

  loadExample: (id) => {
    const example = EXAMPLES[id];
    get().loadSvgText(example.source, example.fileName);
  },

  /** Stacks the parts in Z with a small overlap so upper parts cut sockets in lower ones. */
  distributeZ: () => {
    const { project } = get();
    if (!project) return;
    const settings = distributeLayers(project.document.root, project.settings, project.global);
    pushHistory(set, get, 'distribute');
    set({ project: { ...project, settings } });
    scheduleRebuild(set, get, 0);
  },

  nudgeHeight: (key, delta, immediate = false) => {
    const { project, selectedIds } = get();
    if (!project) return;
    const nodes = selectedIds
      .map((id) => findNode(project.document.root, id))
      .filter((node): node is NonNullable<typeof node> => node !== null);
    // The arrows only exist while something is selected.
    if (nodes.length === 0) return;

    const patches: Record<string, NodeSettings> = {};
    for (const node of nodes) {
      const effective = effectiveSettingsFor(
        project.document.root,
        project.settings,
        project.global,
        node.id,
      );
      if (!effective) continue;
      patches[node.id] = { [key]: roundToStep(effective[key] + delta) };
    }
    get().updateSettingsBatch(patches, { immediate });
  },

  updateSettingsBatch: (patches, batchOptions) => {
    const { project } = get();
    if (!project || Object.keys(patches).length === 0) return;
    pushHistory(set, get, 'settings:batch');
    set({ project: { ...project, settings: mergePatches(project, patches) } });
    scheduleRebuild(set, get, batchOptions?.immediate ? 0 : REBUILD_DEBOUNCE_MS);
  },

  updateSettings: (nodeId, patch) => {
    const { project } = get();
    if (!project) return;
    pushHistory(set, get, `${nodeId}:${Object.keys(patch).sort().join(',')}`);
    set({ project: { ...project, settings: mergePatches(project, { [nodeId]: patch }) } });
    scheduleRebuild(set, get, REBUILD_DEBOUNCE_MS);
  },

  updateGlobal: (patch) => {
    const { project } = get();
    if (!project) return;
    pushHistory(set, get, `global:${Object.keys(patch).sort().join(',')}`);
    set({
      project: {
        ...project,
        global: { ...project.global, ...constrainGlobalPatch(patch, project.global) },
      },
    });
    // Nothing to rebuild while the document is empty; the values apply to the next import.
    if (!isEmptyDocument(project.document)) scheduleRebuild(set, get, REBUILD_DEBOUNCE_MS);
  },

  updateView: (patch) => {
    const { project } = get();
    if (!project) return;
    pushHistory(set, get, `view:${Object.keys(patch).sort().join(',')}`);
    set({
      project: {
        ...project,
        global: { ...project.global, view: { ...project.global.view, ...patch } },
      },
    });
  },

  select: (nodeId) => set({ selectedIds: nodeId ? [nodeId] : [] }),

  toggleSelected: (nodeId) => {
    const { selectedIds } = get();
    set({
      selectedIds: selectedIds.includes(nodeId)
        ? selectedIds.filter((id) => id !== nodeId)
        : [...selectedIds, nodeId],
    });
  },

  selectMany: (nodeIds) => set({ selectedIds: nodeIds }),

  selectAll: () => {
    const { project } = get();
    if (!project) return;
    set({ selectedIds: findPartRoots(project.document.root, project.settings) });
  },

  hover: (nodeId) => set({ hoveredId: nodeId }),
  setViewMode: (mode) => set({ viewMode: mode }),

  rebuild: () => scheduleRebuild(set, get, 0),

  exportThreeMf: () => {
    const { result, project } = get();
    if (!result || !project) return;
    const bytes = writeThreeMf(result.parts, { title: project.document.fileName });
    downloadBytes(bytes, `${baseName(project.document.fileName)}.3mf`, 'model/3mf');
  },

  exportStl: () => {
    const { result, project } = get();
    if (!result || !project) return;
    const bytes = writeBinaryStl(result.parts);
    downloadBytes(bytes, `${baseName(project.document.fileName)}.stl`, 'model/stl');
  },

  reset: () => {
    set({
      project: createEmptyProject(),
      leaves: [],
      parts: [],
      modelSize: null,
      warnings: [],
      result: null,
      status: 'empty',
      error: null,
      selectedIds: [],
      past: [],
      future: [],
    });
  },
}));

type SetState = (partial: Partial<AppState>) => void;
type GetState = () => AppState;

/** Applies per-node patches with the parameter limits, as one undo step. */
function mergePatches(
  project: Project,
  patches: Record<string, NodeSettings>,
): Record<string, NodeSettings> {
  const settings: Record<string, NodeSettings> = { ...project.settings };
  for (const [nodeId, patch] of Object.entries(patches)) {
    const effective = effectiveSettingsFor(
      project.document.root,
      project.settings,
      project.global,
      nodeId,
    );
    const constrained = effective ? constrainNodePatch(patch, effective) : patch;
    const next: NodeSettings = { ...(settings[nodeId] ?? {}) };
    for (const [key, value] of Object.entries(constrained) as Array<
      [keyof NodeSettings, unknown]
    >) {
      if (value === undefined || value === null) {
        delete next[key];
      } else {
        (next as Record<string, unknown>)[key] = value;
      }
    }
    settings[nodeId] = next;
  }
  return settings;
}

function pushHistory(set: SetState, get: GetState, key: string): void {
  const project = get().project;
  if (!project) return;

  const now = Date.now();
  if (lastCommit && lastCommit.key === key && now - lastCommit.time < HISTORY_COALESCE_MS) {
    lastCommit.time = now;
    return;
  }
  lastCommit = { key, time: now };

  const { past } = get();
  set({
    past: [...past, { settings: project.settings, global: project.global }].slice(-HISTORY_LIMIT),
    future: [],
  });
}

function scheduleRebuild(set: SetState, get: GetState, delay: number): void {
  if (rebuildTimer) clearTimeout(rebuildTimer);
  rebuildTimer = setTimeout(() => {
    rebuildTimer = null;
    // Only one job may run at a time: while the worker is busy, newer requests collapse into a
    // single pending rebuild that starts as soon as the current one finishes.
    if (buildInFlight) {
      rebuildQueued = true;
      return;
    }
    void runRebuild(set, get);
  }, delay);
}

async function runRebuild(set: SetState, get: GetState): Promise<void> {
  buildInFlight = true;
  try {
    await performRebuild(set, get);
  } finally {
    buildInFlight = false;
    if (rebuildQueued) {
      rebuildQueued = false;
      void runRebuild(set, get);
    }
  }
}

async function performRebuild(set: SetState, get: GetState): Promise<void> {
  const project = get().project;
  if (!project) return;

  // Empty project: nothing to resolve, and the units of an empty document are meaningless.
  if (isEmptyDocument(project.document)) {
    set({
      leaves: [],
      parts: [],
      warnings: [],
      modelSize: null,
      result: null,
      status: 'empty',
      error: null,
    });
    return;
  }

  const resolved = resolveLeaves({
    document: project.document,
    settings: project.settings,
    global: project.global,
  });

  set({
    leaves: resolved.leaves,
    parts: resolved.parts,
    warnings: [...project.document.warnings, ...resolved.warnings],
    modelSize: { widthMm: resolved.widthMm, heightMm: resolved.heightMm },
    status: 'building',
    error: null,
  });

  if (resolved.leaves.length === 0) {
    set({ status: 'ready', result: null });
    return;
  }

  try {
    const response = await getClient().build(resolved.leaves);
    set({
      result: {
        parts: response.parts,
        stats: response.stats,
        leafStats: response.leafStats,
        warnings: response.warnings,
      },
      warnings: [...project.document.warnings, ...resolved.warnings, ...response.warnings],
      status: 'ready',
      error: null,
    });
  } catch (error) {
    if (error instanceof BuildCancelledError) return;
    set({ status: 'error', error: error instanceof Error ? error.message : String(error) });
  }
}

/** Heights are edited in 0.5 mm steps, so trim float noise from repeated nudges. */
export function roundToStep(value: number): number {
  return Math.round(value * 100) / 100;
}
