import type { ViewSettings } from '@core/model/types';

/**
 * Application settings, kept **outside** the projects (ADR-0031): how the user looks at the model
 * is a property of the person, not of the artwork. Everything that affects geometry lives in the
 * project itself.
 *
 * A small synchronous store is enough here — localStorage is available before the first paint, so
 * the view mode does not flash from 3D to 2D while IndexedDB opens.
 */

export interface AppSettings {
  viewMode: '2d' | '3d';
  view: ViewSettings;
}

const SETTINGS_KEY = 'svg23d:settings';
const LAST_PROJECT_KEY = 'svg23d:last-project';

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // Private mode or a full quota: settings are a convenience, never a reason to break the app.
  }
}

export function loadAppSettings(): AppSettings | null {
  const raw = read(SETTINGS_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    if (!parsed.view || typeof parsed.view !== 'object') return null;
    return {
      viewMode: parsed.viewMode === '2d' ? '2d' : '3d',
      view: parsed.view as ViewSettings,
    };
  } catch {
    return null;
  }
}

export function saveAppSettings(settings: AppSettings): void {
  write(SETTINGS_KEY, JSON.stringify(settings));
}

export function loadLastProjectId(): string | null {
  return read(LAST_PROJECT_KEY);
}

export function saveLastProjectId(id: string | null): void {
  write(LAST_PROJECT_KEY, id);
}
