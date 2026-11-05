import { useSyncExternalStore } from 'react';
import {
  getLocale,
  resolveLocale,
  setLocale,
  subscribeLocale,
  t,
  type Locale,
  type LocalePreference,
} from '@i18n';

/**
 * Subscribes the component to the language. `t` itself reads the module-level locale, so a
 * component only has to call this hook once per render to be updated on a switch.
 */
export function useLocale(): Locale {
  return useSyncExternalStore(subscribeLocale, getLocale, getLocale);
}

/** The translator, plus a subscription: every component that renders strings uses this. */
export function useT(): typeof t {
  useLocale();
  return t;
}

/**
 * Applies a stored or picked language. The document language and the page title follow the UI, so
 * screen readers and the browser tab speak the same language as the interface (ADR-0037).
 */
export function applyLocalePreference(preference: LocalePreference): Locale {
  const locale = resolveLocale(preference);
  setLocale(locale);
  if (typeof document !== 'undefined') {
    document.documentElement.lang = locale;
    document.title = t('app.title');
  }
  return locale;
}
