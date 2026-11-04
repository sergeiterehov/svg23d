import type { GlobalSettings, NodeSettings, Project } from './types';
import { PROJECT_VERSION } from './types';
import { DEFAULT_GLOBAL_SETTINGS } from './defaults';
import type { TreeEdit } from './treeEdit';

/**
 * Project file (`*.svg23d.json`): the source SVG plus user settings.
 *
 * The raw SVG source is embedded instead of the parsed tree so that a project survives parser
 * improvements: on load the source is re-parsed and the settings (keyed by stable node ids) are
 * applied on top. Node ids come from element `id`s or document paths, so they stay stable.
 */

export interface ProjectFile {
  app: 'svg23d';
  version: number;
  fileName: string;
  source: string;
  global: GlobalSettings;
  settings: Record<string, NodeSettings>;
  /** Groups, moves, renames and deletions on top of the source SVG (ADR-0026). */
  tree: TreeEdit;
}

export const PROJECT_FILE_EXTENSION = 'svg23d.json';
export const PROJECT_MIME = 'application/json';

export function serializeProject(project: Project): string {
  const file: ProjectFile = {
    app: 'svg23d',
    version: PROJECT_VERSION,
    fileName: project.fileName,
    source: project.source,
    global: project.global,
    settings: project.settings,
    tree: project.tree,
  };
  return JSON.stringify(file, null, 2);
}

export function parseProjectFile(text: string): ProjectFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('Файл проекта повреждён: это не JSON');
  }
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('Файл проекта повреждён');
  }
  const candidate = raw as Partial<ProjectFile>;
  if (candidate.app !== 'svg23d') {
    throw new Error('Это не файл проекта svg23d');
  }
  if (typeof candidate.version !== 'number' || candidate.version > PROJECT_VERSION) {
    throw new Error(
      `Версия проекта ${String(candidate.version)} не поддерживается (максимум ${PROJECT_VERSION})`,
    );
  }
  if (typeof candidate.source !== 'string') {
    throw new Error('В файле проекта нет исходного SVG');
  }
  if (!candidate.global || typeof candidate.global !== 'object') {
    throw new Error('В файле проекта нет настроек проекта');
  }

  return {
    app: 'svg23d',
    version: candidate.version,
    fileName: candidate.fileName ?? 'project.svg',
    source: candidate.source,
    global: mergeGlobal(candidate.global as Partial<GlobalSettings>),
    settings: (candidate.settings ?? {}) as Record<string, NodeSettings>,
    tree: mergeTree(candidate.tree),
  };
}

/** Structural edits are optional: files saved before they existed simply have none. */
function mergeTree(raw: Partial<TreeEdit> | undefined): TreeEdit {
  return {
    names: raw?.names ?? {},
    parents: raw?.parents ?? {},
    groups: raw?.groups ?? [],
    removed: raw?.removed ?? [],
  };
}

/** Fills in settings that older project files did not have (e.g. the `view` block). */
function mergeGlobal(raw: Partial<GlobalSettings> | undefined): GlobalSettings {
  const base = DEFAULT_GLOBAL_SETTINGS;
  const rawView = (raw?.view ?? {}) as Partial<GlobalSettings['view']> & { opaque2d?: boolean };
  // Projects saved before the mode existed stored a boolean; true meant "no transparency".
  const mode2d = rawView.mode2d ?? (rawView.opaque2d === true ? 'asis' : base.view.mode2d);

  return {
    ...base,
    ...raw,
    view: {
      mode2d,
      lighting: rawView.lighting ?? base.view.lighting,
      material: rawView.material ?? base.view.material,
      projection: rawView.projection ?? base.view.projection,
    },
  };
}
