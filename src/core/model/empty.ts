import type { Project, SvgDocNode, SvgDocument } from './types';
import { PROJECT_VERSION } from './types';
import { DEFAULT_GLOBAL_SETTINGS } from './defaults';
import { EMPTY_TREE_EDIT } from './treeEdit';
import { t } from '@i18n';

/**
 * A project exists from the very first second: it is simply empty (no shapes). That keeps every
 * panel and action meaningful — the project can be named, saved and configured before a file is
 * imported, and the import only replaces the document and renames the project.
 */

/** Localised at the moment a project is created: a name, not a fixed label (ADR-0037). */
export function untitledProjectName(): string {
  return t('project.untitled');
}

function emptyRoot(name: string): SvgDocNode {
  return {
    id: 'root',
    tag: 'svg',
    kind: 'group',
    name,
    fill: 'none',
    fillRule: 'nonzero',
    hidden: false,
    depth: 0,
    children: [],
    subpaths: [],
    warnings: [],
  };
}

export function createEmptyDocument(fileName = untitledProjectName()): SvgDocument {
  return {
    fileName,
    root: emptyRoot(fileName),
    viewBox: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
    contentBox: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
    declaredSizeMm: null,
    warnings: [],
    hash: 'empty',
    paintOrder: [],
  };
}

export function createEmptyProject(): Project {
  const fileName = untitledProjectName();
  return {
    version: PROJECT_VERSION,
    fileName,
    source: '',
    document: createEmptyDocument(fileName),
    tree: EMPTY_TREE_EDIT,
    settings: {},
    global: {
      ...DEFAULT_GLOBAL_SETTINGS,
      view: { ...DEFAULT_GLOBAL_SETTINGS.view },
    },
  };
}

/** An empty document has no shapes, so there is nothing to build. */
export function isEmptyDocument(document: SvgDocument): boolean {
  return document.paintOrder.length === 0;
}
