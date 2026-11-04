import { create } from 'zustand';
import { DEFAULT_GLOBAL_SETTINGS, leafContours } from '@core/model/defaults';
import {
  PROJECT_VERSION,
  type BuildStats,
  type Contour,
  type DocumentWarning,
  type GlobalSettings,
  type LeafStats,
  type NodeSettings,
  type PartMesh,
  type Project,
  type ResolvedLeaf,
  type SvgDocument,
  type ViewSettings,
} from '@core/model/types';
import {
  PROJECT_FILE_EXTENSION,
  PROJECT_MIME,
  parseProjectFile,
  projectFileOf,
  serializeProject,
} from '@core/model/project';
import {
  deleteProject as deleteProjectRecord,
  getProject as getProjectRecord,
  listProjects,
  putProject,
  type ProjectRecord,
  type ProjectSummary,
} from '../storage/projectsDb';
import {
  loadAppSettings,
  loadLastProjectId,
  saveLastProjectId,
  type AppSettings,
} from '../storage/appSettings';
import { parseSvg, SvgParseError } from '@core/svg/parseSvg';
import {
  UNTITLED_PROJECT_NAME,
  createEmptyDocument,
  createEmptyProject,
  isEmptyDocument,
} from '@core/model/empty';
import { constrainGlobalPatch, constrainNodePatch } from '@core/model/limits';
import { resolveLeaves, type PartInfo } from '@core/solver/resolveLeaves';
import { findNode } from '@core/solver/resolveLeaves';
import { findPartRoots } from '@core/solver/resolveLeaves';
import { effectiveSettingsFor } from '@core/solver/inheritance';
import { orderedChildren } from '@core/solver/order';
import {
  EMPTY_TREE_EDIT,
  applyTreeEdit,
  orderKeyFor,
  createGroup,
  markUnions,
  ungroupInTree,
  moveNodesInTree,
  removeFromTree,
  renameInTree,
  type TreeEdit,
} from '@core/model/treeEdit';
import { distributeLayers } from '@core/solver/distribute';
import { reducePalette, paletteUsage, type PaletteEntry } from '@core/color/palette';
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
  tree: TreeEdit;
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

/**
 * An SVG import that collides with a project of the same name (ADR-0031): the user chooses between
 * a new project and the existing one.
 */
export interface PendingImport {
  text: string;
  fileName: string;
  existingId: string;
  existingName: string;
}

export interface BuildResultState {
  parts: PartMesh[];
  stats: BuildStats;
  leafStats: Record<string, LeafStats>;
  warnings: DocumentWarning[];
}

interface AppState {
  project: Project | null;
  /** Parsed markup the structural overlay is applied to; recomputed on import, never saved. */
  baseDocument: SvgDocument;
  /**
   * Quality/size the current `baseDocument` was flattened with. Curves are flattened once, when the
   * SVG is parsed, so a different «качество кривых» or model size has to re-parse the source.
   */
  parsedSignature: string | null;
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
  /** Projects kept in the browser, most recently edited first. */
  library: ProjectSummary[];
  /** Guid of the open project; `null` for a project that has never been stored. */
  projectId: string | null;
  /** Editable display name of the open project. */
  projectName: string;
  projectCreatedAt: number;
  /** False until the browser storage has been read: the app waits before painting the workspace. */
  hydrated: boolean;
  pendingImport: PendingImport | null;

  /** Reads the library and opens the last project (once, at startup). */
  hydrate: () => Promise<void>;
  /** Imports an SVG; if a project with the same name exists, asks first. */
  importSvg: (text: string, fileName: string) => void;
  /** Answers that question: a new project or the existing one. */
  resolveImport: (choice: 'new' | 'existing') => void;
  cancelImport: () => void;
  openLibraryProject: (id: string) => Promise<void>;
  renameProject: (name: string) => void;
  /** Renames an entry of the history without opening it. */
  renameLibraryProject: (id: string, name: string) => Promise<void>;
  deleteLibraryProject: (id: string) => Promise<void>;
  /** Writes the open project into the browser library. */
  persist: () => Promise<void>;
  /** Kept for the import path only: always stores into a fresh record. */
  loadSvgText: (text: string, fileName: string) => void;
  loadExample: (id: ExampleId) => void;
  openProject: (text: string) => void;
  saveProject: () => void;
  undo: () => void;
  redo: () => void;
  /** Wraps the selection in a new group (⌘G) and selects it. */
  groupSelected: () => void;
  /**
   * Makes one printed object out of the selection: the shapes are unioned on the 2D level and the
   * settings of the parts are ignored (ADR-0028).
   */
  unionSelected: () => void;
  /** Turns a union made by the tool back into a plain group. */
  ununionSelected: () => void;
  /** Dissolves the selected group: its children take its place (⌘⇧G is not bound: browsers use it). */
  ungroupSelected: () => void;
  /** Folds or unfolds a group row. Not an edit: no undo step, no rebuild — only the tree changes. */
  toggleCollapsed: (nodeId: string) => void;
  /** Renames an element or a group; empty names are ignored. */
  renameNode: (nodeId: string, name: string) => void;
  /** Drag & drop: puts `nodeId` next to `targetId` or inside it when it is a group. */
  moveNodes: (nodeIds: string[], targetId: string, position: 'before' | 'after' | 'inside') => void;
  /** Deletes the selected elements and their subtrees. */
  removeSelected: () => void;
  distributeZ: () => void;
  /** Colours actually used by the model, each with the area it covers in mm² (ADR-0024). */
  paletteUsage: () => PaletteEntry[];
  /** Reduces the palette to at most `count` colours; returns how many colours are left. */
  limitPalette: (count: number) => number;
  /** Drops every per-element colour override, going back to the colours of the SVG. */
  resetPalette: () => void;
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
  // The parsed markup the structural edits are applied to (never part of the project file).
  baseDocument: createEmptyDocument(),
  parsedSignature: null,
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
  library: [],
  projectId: null,
  projectName: UNTITLED_PROJECT_NAME,
  projectCreatedAt: 0,
  hydrated: false,
  pendingImport: null,

  hydrate: async () => {
    const settings = loadAppSettings();
    if (settings) set({ viewMode: settings.viewMode });
    try {
      // Storage that does not answer must not leave the app on the splash screen.
      const library = await withTimeout(listProjects(), []);
      set({ library });
      const lastId = loadLastProjectId();
      const target = library.find((item) => item.id === lastId) ?? library[0];
      if (target) await withTimeout(get().openLibraryProject(target.id), undefined);
      else if (settings) applyAppView(set, get, settings);
    } catch {
      // Without IndexedDB the editor works as before, only the history is missing.
    }
    set({ hydrated: true });
  },

  importSvg: (text, fileName) => {
    const name = projectNameFromFile(fileName);
    const existing = get().library.find((item) => item.name.toLowerCase() === name.toLowerCase());
    if (existing) {
      set({
        pendingImport: {
          text,
          fileName,
          existingId: existing.id,
          existingName: existing.name,
        },
      });
      return;
    }
    get().loadSvgText(text, fileName);
  },

  resolveImport: (choice) => {
    const pending = get().pendingImport;
    if (!pending) return;
    set({ pendingImport: null });
    if (choice === 'existing') void get().openLibraryProject(pending.existingId);
    else get().loadSvgText(pending.text, pending.fileName);
  },

  cancelImport: () => set({ pendingImport: null }),

  openLibraryProject: async (id) => {
    // Already open: a click on the current row must not reload it (and must not touch the edit date).
    if (get().projectId === id) return;
    const record = await getProjectRecord(id);
    if (!record) return;
    lastCommit = null;

    const next = projectStateFrom({
      source: record.source,
      fileName: record.fileName,
      name: record.name,
      id: record.id,
      tree: record.tree,
      settings: record.settings,
      global: record.global,
      createdAt: record.createdAt,
    });
    // Display settings belong to the person, not to the project: they win over the stored view.
    // They are merged into the same update, so "opening" is a single change of identity — and the
    // autosave (which keys on the project id) leaves the edit date alone.
    const settings = loadAppSettings();
    if (settings) {
      const project = next.project as Project;
      next.project = {
        ...project,
        global: { ...project.global, view: { ...project.global.view, ...settings.view } },
      };
      next.viewMode = settings.viewMode;
    }

    set(next);
    saveLastProjectId(record.id);
    scheduleRebuild(set, get, 0);
  },

  renameProject: (name) => {
    const trimmed = name.trim();
    if (trimmed === '' || trimmed === get().projectName) return;
    set({ projectName: trimmed });
  },

  renameLibraryProject: async (id, name) => {
    const trimmed = name.trim();
    if (trimmed === '') return;
    if (get().projectId === id) {
      get().renameProject(trimmed);
      return;
    }
    const record = await getProjectRecord(id);
    if (!record || record.name === trimmed) return;
    await putProject({ ...record, name: trimmed });
    set({ library: await listProjects() });
  },

  deleteLibraryProject: async (id) => {
    await deleteProjectRecord(id);
    const library = await listProjects();
    set({ library });
    if (get().projectId !== id) return;
    const next = library[0];
    if (next) await get().openLibraryProject(next.id);
    else {
      get().reset();
      saveLastProjectId(null);
    }
  },

  persist: async () => {
    const { project, projectId, projectName, projectCreatedAt } = get();
    // An empty document is not a project worth keeping: it is the "nothing opened" state.
    if (!project || !projectId || project.source.trim() === '') return;
    const now = Date.now();
    const record: ProjectRecord = {
      ...projectFileOf(project),
      id: projectId,
      name: projectName,
      createdAt: projectCreatedAt || now,
      updatedAt: now,
    };
    try {
      await putProject(record);
      set({ library: await listProjects() });
      saveLastProjectId(projectId);
    } catch {
      // The history is a convenience: the project can still be downloaded as a file.
    }
  },

  loadSvgText: (text, fileName) => {
    try {
      // An import starts a **new** project, so geometry defaults are the factory ones — heights,
      // size, tolerance and quality of whatever was open do not travel with the file (ADR-0032).
      // Only the view is kept: how the user looks at the model belongs to the person, not the artwork.
      const view =
        loadAppSettings()?.view ?? get().project?.global.view ?? DEFAULT_GLOBAL_SETTINGS.view;
      const global: GlobalSettings = { ...DEFAULT_GLOBAL_SETTINGS, view };
      lastCommit = null;
      set(
        projectStateFrom({
          source: text,
          fileName,
          name: projectNameFromFile(fileName),
          id: newProjectId(),
          tree: EMPTY_TREE_EDIT,
          settings: {},
          global,
          createdAt: Date.now(),
        }),
      );
      scheduleRebuild(set, get, 0);
      void get().persist();
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
      lastCommit = null;
      // A downloaded file is a copy: it gets its own guid so both can live in the history.
      set(
        projectStateFrom({
          source: file.source,
          fileName: file.fileName,
          name: projectNameFromFile(file.fileName),
          id: newProjectId(),
          tree: file.tree,
          settings: file.settings,
          global: file.global,
          createdAt: Date.now(),
        }),
      );
      scheduleRebuild(set, get, 0);
      void get().persist();
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
    const previous = past[past.length - 1] as Snapshot;
    lastCommit = null;
    set({
      project: {
        ...project,
        settings: previous.settings,
        global: previous.global,
        tree: previous.tree,
        document: applyTreeEdit(get().baseDocument, previous.tree),
      },
      past: past.slice(0, -1),
      future: [
        { settings: project.settings, global: project.global, tree: project.tree },
        ...future,
      ],
    });
    // Undoing a quality change has to bring the old flattening back too.
    syncParsedDocument(set, get);
    scheduleRebuild(set, get, 0);
  },

  redo: () => {
    const { project, past, future } = get();
    if (!project || future.length === 0) return;
    const next = future[0] as Snapshot;
    lastCommit = null;
    set({
      project: {
        ...project,
        settings: next.settings,
        global: next.global,
        tree: next.tree,
        document: applyTreeEdit(get().baseDocument, next.tree),
      },
      past: [...past, { settings: project.settings, global: project.global, tree: project.tree }],
      future: future.slice(1),
    });
    syncParsedDocument(set, get);
    scheduleRebuild(set, get, 0);
  },

  groupSelected: () => {
    const { selectedIds } = get();
    if (selectedIds.length === 0) return;
    wrapSelection(set, get, selectedIds, false);
  },

  unionSelected: () => {
    const { project, selectedIds } = get();
    if (!project || selectedIds.length === 0) return;

    // One node: union it in place. A group of shapes becomes one body; a lone shape already is one.
    if (selectedIds.length === 1) {
      const node = findNode(project.document.root, selectedIds[0]);
      if (!node || node.kind === 'shape') return;
      const tree = markUnions(project.tree, [node.id]);
      if (!tree) return;
      pushHistory(set, get, 'union');
      set({
        project: {
          ...project,
          tree,
          document: applyTreeEdit(get().baseDocument, tree),
          // A fresh union opens folded: its parts are implementation details.
          settings: {
            ...project.settings,
            [node.id]: { ...(project.settings[node.id] ?? {}), collapsed: true },
          },
        },
      });
      scheduleRebuild(set, get, 0);
      return;
    }
    wrapSelection(set, get, selectedIds, true);
  },

  ungroupSelected: () => {
    const { selectedIds } = get();
    if (selectedIds.length !== 1) return;
    dissolve(set, get, selectedIds[0], 'ungroup');
  },

  ununionSelected: () => {
    const { project, selectedIds } = get();
    if (!project || selectedIds.length !== 1) return;
    const node = findNode(project.document.root, selectedIds[0]);
    if (node?.union !== true) return;
    dissolve(set, get, node.id, 'ununion');
  },

  toggleCollapsed: (nodeId) => {
    const { project } = get();
    if (!project) return;
    // Only containers can be folded; leaves have nothing to hide.
    const node = findNode(project.document.root, nodeId);
    if (!node || node.kind !== 'group' || node.children.length === 0) return;
    const current = project.settings[nodeId] ?? {};
    const next: NodeSettings = { ...current };
    if (current.collapsed === true) delete next.collapsed;
    else next.collapsed = true;
    const settings = { ...project.settings };
    if (Object.keys(next).length === 0) delete settings[nodeId];
    else settings[nodeId] = next;
    set({ project: { ...project, settings } });
  },

  renameNode: (nodeId, name) => {
    const { project } = get();
    if (!project) return;
    const tree = renameInTree(project.document, project.tree, nodeId, name);
    if (!tree) return;
    pushHistory(set, get, `rename:${nodeId}`);
    set({ project: { ...project, tree, document: applyTreeEdit(get().baseDocument, tree) } });
    scheduleRebuild(set, get, 0);
  },

  moveNodes: (nodeIds, targetId, position) => {
    const { project } = get();
    if (!project) return;
    const result = moveNodesInTree(project.document, project.tree, nodeIds, targetId, position);
    if (!result) return;
    const parent =
      result.parentId === ''
        ? project.document.root
        : findNode(project.document.root, result.parentId);
    if (!parent) return;
    const moving = new Set(result.movedIds);
    const siblings = orderedChildren(parent, project.settings)
      .map((child) => child.id)
      .filter((id) => !moving.has(id));
    const targetIndex = siblings.indexOf(targetId);
    const index =
      position === 'inside' || targetIndex < 0
        ? siblings.length
        : position === 'before'
          ? targetIndex
          : targetIndex + 1;
    const order = [...siblings];
    // The block keeps its internal order (bottom → top).
    order.splice(index, 0, ...result.movedIds);

    const parentKey = orderKeyFor(project.document, result.parentId);
    pushHistory(set, get, 'move');
    set({
      project: {
        ...project,
        tree: result.edit,
        document: applyTreeEdit(get().baseDocument, result.edit),
        settings: {
          ...project.settings,
          [parentKey]: { ...(project.settings[parentKey] ?? {}), childOrder: order },
        },
      },
    });
    scheduleRebuild(set, get, 0);
  },

  removeSelected: () => {
    const { project, selectedIds } = get();
    if (!project || selectedIds.length === 0) return;
    const tree = removeFromTree(project.tree, selectedIds);
    if (!tree) return;
    pushHistory(set, get, 'remove');
    set({
      project: { ...project, tree, document: applyTreeEdit(get().baseDocument, tree) },
      selectedIds: [],
      hoveredId: null,
    });
    scheduleRebuild(set, get, 0);
  },

  loadExample: (id) => {
    const example = EXAMPLES[id];
    get().importSvg(example.source, example.fileName);
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

  paletteUsage: () => {
    return paletteUsage(withAllContours(get().leaves));
  },

  limitPalette: (count) => {
    const { project } = get();
    if (!project) return 0;
    const usage = paletteUsage(withAllContours(get().leaves));
    const { mapping, palette } = reducePalette(usage, count);
    const patches: Record<string, NodeSettings> = {};
    for (const leaf of get().leaves) {
      const next = mapping.get(leaf.color);
      if (!next || next === leaf.color) continue;
      patches[leaf.id] = { colorOverride: next };
    }
    if (Object.keys(patches).length === 0) return palette.length;
    pushHistory(set, get, 'palette');
    set({ project: { ...project, settings: mergePatches(project, patches) } });
    scheduleRebuild(set, get, 0);
    return palette.length;
  },

  resetPalette: () => {
    const { project } = get();
    if (!project) return;
    const patches: Record<string, NodeSettings> = {};
    for (const [nodeId, settings] of Object.entries(project.settings)) {
      if (settings.colorOverride !== undefined) patches[nodeId] = { colorOverride: undefined };
    }
    if (Object.keys(patches).length === 0) return;
    pushHistory(set, get, 'palette-reset');
    set({ project: { ...project, settings: mergePatches(project, patches) } });
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
    // «Качество кривых» and the model size change the flattening tolerance, which is applied when the
    // source is parsed: without a re-parse the setting would only move numbers in the panel.
    syncParsedDocument(set, get);
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
      baseDocument: createEmptyDocument(),
      parsedSignature: null,
      projectId: null,
      projectName: UNTITLED_PROJECT_NAME,
      projectCreatedAt: 0,
      pendingImport: null,
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

/** Display name of an import: the file name without its extension. */
export function projectNameFromFile(fileName: string): string {
  const name = fileName.replace(/\.[^.]+$/, '').trim();
  return name === '' ? UNTITLED_PROJECT_NAME : name;
}

/** Resolves with `fallback` if the promise takes too long: IndexedDB can block, the app cannot. */
function withTimeout<T>(promise: Promise<T>, fallback: T, ms = 3000): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

function newProjectId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

interface OpenStateInput {
  source: string;
  fileName: string;
  name: string;
  id: string | null;
  tree: TreeEdit;
  settings: Record<string, NodeSettings>;
  global: GlobalSettings;
  createdAt: number;
}

/** Everything a freshly opened project replaces in the store (ADR-0031). */
function projectStateFrom(input: OpenStateInput): Partial<AppState> {
  const base = input.source.trim()
    ? parseSvg(input.source, { fileName: input.fileName, global: input.global })
    : createEmptyDocument(input.fileName);
  const document = applyTreeEdit(base, input.tree);
  const project: Project = {
    version: PROJECT_VERSION,
    fileName: input.fileName,
    source: input.source,
    document,
    tree: input.tree,
    settings: input.settings,
    global: input.global,
  };
  return {
    project,
    baseDocument: base,
    parsedSignature: parseSignature(input.global),
    projectId: input.id,
    projectName: input.name,
    projectCreatedAt: input.createdAt,
    selectedIds: [],
    hoveredId: null,
    result: null,
    error: null,
    status: isEmptyDocument(document) ? 'empty' : 'building',
    past: [],
    future: [],
  };
}

/** App-wide display settings live apart from the projects and win over the project's own view. */
function applyAppView(set: SetState, get: GetState, settings: AppSettings): void {
  const project = get().project;
  set({
    viewMode: settings.viewMode,
    ...(project
      ? {
          project: {
            ...project,
            global: { ...project.global, view: { ...project.global.view, ...settings.view } },
          },
        }
      : {}),
  });
}

/**
 * Dissolves a container (a plain group or a union) into its place: the children take the spot the
 * container occupied, keep their own settings, and the container itself disappears with its settings.
 * For a union this is what «Разъединить» does — no group is left behind, the pieces are simply
 * separate elements again.
 */
function dissolve(set: SetState, get: GetState, nodeId: string, label: string): void {
  const { project } = get();
  if (!project) return;
  const result = ungroupInTree(project.document, project.tree, nodeId);
  if (!result) return;

  const parent =
    result.parentId === ''
      ? project.document.root
      : findNode(project.document.root, result.parentId);
  const siblings = parent ? orderedChildren(parent, project.settings).map((child) => child.id) : [];
  const position = siblings.indexOf(nodeId);
  const order = siblings.filter((id) => id !== nodeId);
  order.splice(position < 0 ? order.length : position, 0, ...result.movedIds);

  const parentKey = orderKeyFor(project.document, result.parentId);
  const settings = {
    ...project.settings,
    [parentKey]: { ...(project.settings[parentKey] ?? {}), childOrder: order },
  };
  // The container is gone: its own settings go with it, the children keep theirs.
  delete settings[nodeId];

  pushHistory(set, get, label);
  set({
    project: {
      ...project,
      tree: result.edit,
      document: applyTreeEdit(get().baseDocument, result.edit),
      settings,
    },
    selectedIds: result.movedIds,
  });
  scheduleRebuild(set, get, 0);
}

/** Name of a group created by «Объединить». */
const UNION_NAME = 'Объединение';

/**
 * Wraps the selection in a new group and puts it where the least nested, highest selected element
 * was (`createGroup` explains the rule). A union group is also marked in the overlay (ADR-0028).
 */
function wrapSelection(set: SetState, get: GetState, ids: string[], union: boolean): void {
  const { project } = get();
  if (!project || ids.length === 0) return;

  const result = createGroup(project.document, project.tree, ids, union ? UNION_NAME : '');
  if (!result) return;

  const parent =
    result.parentId === ''
      ? project.document.root
      : findNode(project.document.root, result.parentId);
  const siblings = parent ? orderedChildren(parent, project.settings).map((child) => child.id) : [];
  const moved = new Set(result.movedIds);
  const anchorIndex = siblings.indexOf(result.anchorId);
  const before = siblings.slice(0, Math.max(anchorIndex, 0)).filter((id) => !moved.has(id)).length;
  const order = siblings.filter((id) => !moved.has(id));
  order.splice(Math.min(before, order.length), 0, result.groupId);

  const parentKey = orderKeyFor(project.document, result.parentId);
  const tree = union ? (markUnions(result.edit, [result.groupId]) ?? result.edit) : result.edit;
  pushHistory(set, get, union ? 'union' : 'group');
  set({
    project: {
      ...project,
      tree,
      document: applyTreeEdit(get().baseDocument, tree),
      settings: {
        ...project.settings,
        [parentKey]: { ...(project.settings[parentKey] ?? {}), childOrder: order },
        // A new group opens folded: the place it takes was one row before, so the tree stays calm.
        [result.groupId]: { ...(project.settings[result.groupId] ?? {}), collapsed: true },
      },
    },
    selectedIds: [result.groupId],
  });
  scheduleRebuild(set, get, 0);
}

/** Leaves with every contour set of a union object, so the palette weights the whole body. */
function withAllContours(leaves: ResolvedLeaf[]): Array<{ color: string; contours: Contour[] }> {
  return leaves.map((leaf) => ({ color: leaf.color, contours: leafContours(leaf) }));
}

/** Everything that changes the flattening tolerance of a parse: quality, target size, fit axis. */
function parseSignature(global: GlobalSettings): string {
  return `${global.flatness}|${global.fitSizeMm}|${global.fit}`;
}

/**
 * Curves are flattened when the SVG is parsed, not when the model is built (ADR-0030). The parsed
 * document is therefore rebuilt whenever the tolerance inputs no longer match the ones it was parsed
 * with — this is what makes «качество кривых» actually change the triangle count.
 */
function syncParsedDocument(set: SetState, get: GetState): void {
  const { project, parsedSignature } = get();
  if (!project || project.source.trim() === '') return;
  const signature = parseSignature(project.global);
  if (signature === parsedSignature) return;

  try {
    const base = parseSvg(project.source, { fileName: project.fileName, global: project.global });
    set({
      baseDocument: base,
      parsedSignature: signature,
      project: { ...project, document: applyTreeEdit(base, project.tree) },
    });
  } catch (error) {
    set({ status: 'error', error: (error as Error).message });
  }
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
    past: [
      ...past,
      { settings: project.settings, global: project.global, tree: project.tree },
    ].slice(-HISTORY_LIMIT),
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
