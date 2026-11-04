import { useProjectStore } from '../store/useProjectStore';
import { saveAppSettings } from './appSettings';

/**
 * Session lifecycle (ADR-0031): before the first paint the library and the last project are read
 * from the browser, then the open project and the display settings are written back while the user
 * works.
 */

/** Typing in a field is one edit, not ten: writes are grouped. */
const SAVE_DEBOUNCE_MS = 600;

let booted = false;

/** Reads the stored library, opens the last project and starts autosaving. Safe to call twice. */
export function bootstrap(): void {
  if (booted) return;
  booted = true;
  void useProjectStore.getState().hydrate();
  startAutosave();
}

/**
 * Starts the two autosave channels and returns a stopper (used by the tests). Display settings are
 * saved on their own, apart from the projects; the open project is saved after a short pause.
 */
export function startAutosave(): () => void {
  const unsubscribeSettings = useProjectStore.subscribe((state, previous) => {
    if (!state.project) return;
    if (
      state.viewMode === previous.viewMode &&
      state.project.global.view === previous.project?.global.view
    ) {
      return;
    }
    saveAppSettings({ viewMode: state.viewMode, view: state.project.global.view });
  });

  let timer: number | null = null;
  const flush = (): void => {
    if (timer !== null) {
      window.clearTimeout(timer);
      timer = null;
    }
    void useProjectStore.getState().persist();
  };

  const unsubscribeProject = useProjectStore.subscribe((state, previous) => {
    // Switching to another project is not an edit — the id change says so. A new import saves
    // itself right away, so it never passes through here either.
    if (state.projectId !== previous.projectId) return;
    // Renaming changes only the name, editing changes only the project; both are worth saving.
    if (state.project === previous.project && state.projectName === previous.projectName) return;
    if (timer !== null) window.clearTimeout(timer);
    timer = window.setTimeout(flush, SAVE_DEBOUNCE_MS);
  });

  // Closing the tab must not lose the last seconds of work (best effort: the write is async).
  const onVisibility = (): void => {
    if (document.visibilityState === 'hidden') flush();
  };
  window.addEventListener('beforeunload', flush);
  document.addEventListener('visibilitychange', onVisibility);

  return () => {
    unsubscribeSettings();
    unsubscribeProject();
    window.removeEventListener('beforeunload', flush);
    document.removeEventListener('visibilitychange', onVisibility);
    if (timer !== null) window.clearTimeout(timer);
  };
}
