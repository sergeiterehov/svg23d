import { afterEach, describe, expect, it } from 'vitest';
import {
  detectLocale,
  en,
  formatNumber,
  getLocale,
  resolveLocale,
  ru,
  setLocale,
  t,
  type MessageKey,
} from '@i18n';

/**
 * The key set is already checked by the type system; these tests cover the runtime behaviour that
 * types cannot: placeholder parity, empty translations, detection and switching (ADR-0037).
 */

function placeholders(text: string): string[] {
  return [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
}

describe('i18n dictionary', () => {
  const keys = Object.keys(ru) as MessageKey[];

  it('translates every key into both languages', () => {
    expect(keys.length).toBeGreaterThan(100);
    for (const key of keys) {
      expect(ru[key].trim(), key).not.toBe('');
      expect(en[key].trim(), key).not.toBe('');
    }
  });

  it('keeps the placeholders identical between the languages', () => {
    for (const key of keys) {
      expect(placeholders(en[key]), key).toEqual(placeholders(ru[key]));
    }
  });
});

describe('language selection', () => {
  afterEach(() => setLocale('ru'));

  it('follows the first supported browser language', () => {
    expect(detectLocale(['ru-RU', 'en-US'])).toBe('ru');
    expect(detectLocale(['en-GB'])).toBe('en');
    expect(detectLocale(['de-DE', 'ru'])).toBe('ru');
  });

  it('falls back to English for languages the app does not speak', () => {
    expect(detectLocale(['de-DE', 'fr-FR'])).toBe('en');
    expect(detectLocale([])).toBe('en');
  });

  it('lets an explicit choice win over the browser', () => {
    expect(resolveLocale('ru', ['en-US'])).toBe('ru');
    expect(resolveLocale('en', ['ru-RU'])).toBe('en');
    expect(resolveLocale('auto', ['ru-RU'])).toBe('ru');
  });

  it('switches the translator and the number format', () => {
    setLocale('en');
    expect(t('status.empty')).toBe('Empty project');
    expect(formatNumber(12345)).toBe('12,345');
    setLocale('ru');
    expect(getLocale()).toBe('ru');
    expect(t('status.empty')).toBe('Проект пуст');
    expect(formatNumber(12345).replace(/\s/g, ' ')).toBe('12 345');
  });

  it('fills placeholders and leaves unknown ones alone', () => {
    setLocale('ru');
    expect(t('status.warnings', { count: 3 })).toBe('предупреждений: 3');
    setLocale('en');
    expect(t('status.stats', { parts: 2, triangles: '1,000', volume: '3.50' })).toBe(
      '2 parts · 1,000 tris · 3.50 cm³',
    );
  });
});
