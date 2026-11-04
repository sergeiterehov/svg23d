// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_GLOBAL_SETTINGS } from '@core/model/defaults';
import { projectNameFromFile, useProjectStore } from '@app/store/useProjectStore';
import { deleteProject, listProjects } from '@app/storage/projectsDb';
import { loadAppSettings, saveAppSettings } from '@app/storage/appSettings';
import { startAutosave } from '@app/storage/persistence';

/**
 * The browser library (ADR-0031): projects live in IndexedDB keyed by guid, display settings live
 * apart from them, and the last project is reopened on the next start.
 */

const svg = (fill: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
    <rect id="plate" x="10" y="10" width="60" height="60" fill="${fill}"/>
  </svg>`;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Simulates a page reload: the in-memory state is thrown away, the storage is kept. */
async function reload(): Promise<void> {
  useProjectStore.getState().reset();
  useProjectStore.setState({ library: [], hydrated: false });
  await useProjectStore.getState().hydrate();
}

beforeEach(async () => {
  for (const item of await listProjects()) await deleteProject(item.id);
  window.localStorage.clear();
  useProjectStore.getState().reset();
  useProjectStore.setState({ library: [], hydrated: false });
});

describe('project names', () => {
  it('drops the extension and never comes back empty', () => {
    expect(projectNameFromFile('logo.svg')).toBe('logo');
    expect(projectNameFromFile('a.b.svg')).toBe('a.b');
    expect(projectNameFromFile('.svg')).toBe('Безымянный');
  });
});

describe('library', () => {
  it('stores an import and reopens it on the next start', async () => {
    useProjectStore.getState().importSvg(svg('#ff0000'), 'logo.svg');
    await useProjectStore.getState().persist();

    const stored = await listProjects();
    expect(stored).toHaveLength(1);
    expect(stored[0].name).toBe('logo');
    const id = useProjectStore.getState().projectId;
    const source = useProjectStore.getState().project?.source;

    await reload();

    expect(useProjectStore.getState().hydrated).toBe(true);
    expect(useProjectStore.getState().projectId).toBe(id);
    expect(useProjectStore.getState().projectName).toBe('logo');
    expect(useProjectStore.getState().project?.source).toBe(source);
  });

  it('starts a new import from the factory defaults, not from the open project', async () => {
    useProjectStore.getState().importSvg(svg('#ff0000'), 'one.svg');
    useProjectStore
      .getState()
      .updateGlobal({ defaultZTo: 55, fitSizeMm: 120, defaultClearance: 0.5, flatness: 0.005 });
    expect(useProjectStore.getState().project?.global.defaultZTo).toBe(55);

    useProjectStore.getState().importSvg(svg('#00ff00'), 'two.svg');
    const global = useProjectStore.getState().project?.global;
    expect(global?.defaultZTo).toBe(DEFAULT_GLOBAL_SETTINGS.defaultZTo);
    expect(global?.defaultZFrom).toBe(DEFAULT_GLOBAL_SETTINGS.defaultZFrom);
    expect(global?.fitSizeMm).toBe(DEFAULT_GLOBAL_SETTINGS.fitSizeMm);
    expect(global?.defaultClearance).toBe(DEFAULT_GLOBAL_SETTINGS.defaultClearance);
    expect(global?.flatness).toBe(DEFAULT_GLOBAL_SETTINGS.flatness);
    // Per-element settings of the previous project do not follow the new file either.
    expect(Object.keys(useProjectStore.getState().project?.settings ?? {})).toHaveLength(0);
  });

  it('keeps the display settings across an import', () => {
    const view = {
      ...DEFAULT_GLOBAL_SETTINGS.view,
      lighting: 'flat' as const,
      mode2d: 'asis' as const,
    };
    saveAppSettings({ viewMode: '2d', view });

    useProjectStore.getState().importSvg(svg('#ff0000'), 'one.svg');
    const global = useProjectStore.getState().project?.global;
    expect(global?.view.lighting).toBe('flat');
    expect(global?.view.mode2d).toBe('asis');
  });

  it('asks before importing a file whose name is already in the history', async () => {
    useProjectStore.getState().importSvg(svg('#ff0000'), 'logo.svg');
    await useProjectStore.getState().persist();
    const firstId = useProjectStore.getState().projectId;

    useProjectStore.getState().importSvg(svg('#00ff00'), 'logo.svg');
    expect(useProjectStore.getState().pendingImport?.existingId).toBe(firstId);
    expect(await listProjects()).toHaveLength(1);

    useProjectStore.getState().resolveImport('new');
    await useProjectStore.getState().persist();
    const stored = await listProjects();
    expect(stored).toHaveLength(2);
    expect(stored.every((item) => item.name === 'logo')).toBe(true);
    expect(new Set(stored.map((item) => item.id)).size).toBe(2);
  });

  it('opens the existing project instead of importing a duplicate', async () => {
    useProjectStore.getState().importSvg(svg('#ff0000'), 'logo.svg');
    await useProjectStore.getState().persist();
    const firstId = useProjectStore.getState().projectId;
    const source = useProjectStore.getState().project?.source;

    useProjectStore.getState().importSvg(svg('#00ff00'), 'mark.svg');
    await useProjectStore.getState().persist();
    useProjectStore.getState().importSvg(svg('#00ff00'), 'logo.svg');
    useProjectStore.getState().resolveImport('existing');
    await sleep(0);

    expect(useProjectStore.getState().projectId).toBe(firstId);
    expect(useProjectStore.getState().project?.source).toBe(source);
    expect(await listProjects()).toHaveLength(2);
  });

  it('lists the most recently edited first and renames in place', async () => {
    useProjectStore.getState().importSvg(svg('#ff0000'), 'one.svg');
    await useProjectStore.getState().persist();
    const firstId = useProjectStore.getState().projectId;

    await sleep(5);
    useProjectStore.getState().importSvg(svg('#00ff00'), 'two.svg');
    await useProjectStore.getState().persist();
    const secondId = useProjectStore.getState().projectId;

    let stored = await listProjects();
    expect(stored.map((item) => item.id)).toEqual([secondId, firstId]);

    useProjectStore.getState().renameProject('Второй');
    await useProjectStore.getState().persist();
    stored = await listProjects();
    expect(stored.find((item) => item.id === secondId)?.name).toBe('Второй');
  });

  it('does not touch the edit date when a project is only opened', async () => {
    const stop = startAutosave();
    try {
      useProjectStore.getState().importSvg(svg('#ff0000'), 'one.svg');
      await useProjectStore.getState().persist();
      const first = (await listProjects())[0];

      await sleep(10);
      useProjectStore.getState().importSvg(svg('#00ff00'), 'two.svg');
      await useProjectStore.getState().persist();
      expect(useProjectStore.getState().projectId).not.toBe(first.id);

      // Opening the older project must not count as an edit — even after the autosave debounce.
      await useProjectStore.getState().openLibraryProject(first.id);
      await sleep(900);

      const restored = (await listProjects()).find((item) => item.id === first.id);
      expect(restored?.updatedAt).toBe(first.updatedAt);
    } finally {
      stop();
    }
  });

  it('saves a rename of the open project without any other edit', async () => {
    const stop = startAutosave();
    try {
      useProjectStore.getState().importSvg(svg('#ff0000'), 'one.svg');
      await useProjectStore.getState().persist();

      useProjectStore.getState().renameProject('Новый');
      await sleep(900);

      expect((await listProjects())[0].name).toBe('Новый');
    } finally {
      stop();
    }
  });

  it('deletes a project and falls back to the next one', async () => {
    useProjectStore.getState().importSvg(svg('#ff0000'), 'one.svg');
    await useProjectStore.getState().persist();
    const firstId = useProjectStore.getState().projectId as string;

    await sleep(5);
    useProjectStore.getState().importSvg(svg('#00ff00'), 'two.svg');
    await useProjectStore.getState().persist();
    const secondId = useProjectStore.getState().projectId;

    await useProjectStore.getState().deleteLibraryProject(firstId);
    expect(useProjectStore.getState().library.map((item) => item.id)).toEqual([secondId]);

    // Deleting the open project closes it: the history is empty, the editor goes back to "nothing".
    await useProjectStore.getState().deleteLibraryProject(secondId as string);
    expect(useProjectStore.getState().library).toHaveLength(0);
    expect(useProjectStore.getState().projectId).toBeNull();
    expect(useProjectStore.getState().status).toBe('empty');
  });
});

describe('app settings', () => {
  it('are stored apart from the projects', () => {
    const view = { ...DEFAULT_GLOBAL_SETTINGS.view, lighting: 'flat' as const };
    saveAppSettings({ viewMode: '2d', view });
    expect(loadAppSettings()).toEqual({ viewMode: '2d', view });
    expect(useProjectStore.getState().project?.global.view.lighting).not.toBe('flat');
  });

  it('win over the view stored in the project when it is reopened', async () => {
    useProjectStore.getState().importSvg(svg('#ff0000'), 'logo.svg');
    await useProjectStore.getState().persist();
    saveAppSettings({ viewMode: '2d', view: DEFAULT_GLOBAL_SETTINGS.view });

    await reload();
    expect(useProjectStore.getState().viewMode).toBe('2d');
  });
});
