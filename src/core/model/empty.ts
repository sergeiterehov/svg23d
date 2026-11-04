import type { Project, SvgDocNode, SvgDocument } from './types';
import { PROJECT_VERSION } from './types';
import { DEFAULT_GLOBAL_SETTINGS } from './defaults';
import { EMPTY_TREE_EDIT } from './treeEdit';

/**
 * A project exists from the very first second: it is simply empty (no shapes). That keeps every
 * panel and action meaningful — the project can be named, saved and configured before a file is
 * imported, and the import only replaces the document and renames the project.
 */

export const UNTITLED_PROJECT_NAME = 'Безымянный';

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

export function createEmptyDocument(fileName = UNTITLED_PROJECT_NAME): SvgDocument {
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
  return {
    version: PROJECT_VERSION,
    fileName: UNTITLED_PROJECT_NAME,
    source: '',
    document: createEmptyDocument(),
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
