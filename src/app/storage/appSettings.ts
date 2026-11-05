import type { LocalePreference } from '@i18n';
import type { ViewSettings } from '@core/model/types';

/**
 * Application settings, kept **outside** the projects (ADR-0031): how the user looks at the model
 * and which language the interface speaks is a property of the person, not of the artwork.
 * Everything that affects geometry lives in the project itself.
 *
 * A small synchronous store is enough here — localStorage is available before the first paint, so
 * neither the view mode nor the language flashes while IndexedDB opens.
 */

export interface AppSettings {
  viewMode: '2d' | '3d';
  view: ViewSettings;
  /** «auto» follows the browser; an explicit language wins (ADR-0037). */
  locale: LocalePreference;
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

function readSettings(): Partial<AppSettings> | null {
  const raw = read(SETTINGS_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Partial<AppSettings>;
  } catch {
    return null;
  }
}

export function loadAppSettings(): AppSettings | null {
  const parsed = readSettings();
  if (!parsed) return null;
  if (!parsed.view || typeof parsed.view !== 'object') return null;
  return {
    viewMode: parsed.viewMode === '2d' ? '2d' : '3d',
    view: parsed.view as ViewSettings,
    locale: parsed.locale === 'ru' || parsed.locale === 'en' ? parsed.locale : 'auto',
  };
}

/** The language is readable on its own: picking one does not depend on the stored view mode. */
export function loadLocalePreference(): LocalePreference {
  const parsed = readSettings();
  return parsed?.locale === 'ru' || parsed?.locale === 'en' ? parsed.locale : 'auto';
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
