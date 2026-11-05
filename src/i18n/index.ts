import { en } from './en';
import { ru, type MessageKey, type MessageParams } from './ru';

export type { MessageKey, MessageParams };
export { ru, en };

/** Languages the interface is translated into. */
export type Locale = 'ru' | 'en';
/** What the user picked: an explicit language, or «follow the system». */
export type LocalePreference = 'auto' | Locale;

export const LOCALE_PREFERENCES: readonly LocalePreference[] = ['auto', 'ru', 'en'];

const MESSAGES: Record<Locale, Record<MessageKey, string>> = { ru, en };

/** Listeners re-render the UI (and redraw the nav cube) when the language changes. */
const listeners = new Set<() => void>();

/**
 * Russian is the fallback for everything that runs before the stored preference is read — and for
 * the tests, which assert on the Russian texts.
 */
let locale: Locale = 'ru';

/** BCP 47 tag for `Intl` and `toLocaleString`. */
export function localeTag(value: Locale = locale): string {
  return value === 'ru' ? 'ru-RU' : 'en-US';
}

export function getLocale(): Locale {
  return locale;
}

/**
 * First language of the browser that the app speaks; English for anything else. `navigator` is
 * absent in the worker-less test environment, hence the guard.
 */
export function detectLocale(languages?: readonly string[]): Locale {
  const list =
    languages ??
    (typeof navigator !== 'undefined'
      ? navigator.languages && navigator.languages.length > 0
        ? navigator.languages
        : [navigator.language]
      : ['en']);
  for (const raw of list) {
    const language = raw.toLowerCase();
    if (language.startsWith('ru')) return 'ru';
    if (language.startsWith('en')) return 'en';
  }
  return 'en';
}

/** An explicit choice wins; «auto» asks the browser. */
export function resolveLocale(preference: LocalePreference, languages?: readonly string[]): Locale {
  return preference === 'auto' ? detectLocale(languages) : preference;
}

/**
 * Sets the effective language. Called by the app for both the stored preference and the worker,
 * which gets the language with every job (ADR-0037).
 */
export function setLocale(next: Locale): void {
  if (next === locale) return;
  locale = next;
  for (const listener of listeners) listener();
}

export function subscribeLocale(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Fills `{name}` placeholders. Unknown keys cannot be passed: the type is the key set. */
export function t(key: MessageKey, params?: MessageParams): string {
  const template = MESSAGES[locale][key];
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });
}

/** `12 345` in Russian, `12,345` in English. */
export function formatNumber(value: number): string {
  return value.toLocaleString(localeTag());
}

export function formatDate(timestamp: number, options: Intl.DateTimeFormatOptions): string {
  return new Date(timestamp).toLocaleDateString(localeTag(), options);
}
