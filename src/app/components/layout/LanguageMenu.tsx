import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { LOCALE_PREFERENCES, type LocalePreference } from '@i18n';
import { useProjectStore } from '../../store/useProjectStore';
import { useLocale, useT } from '../../i18n';
import { CheckIcon, GlobeIcon } from '../common/Icon';

/**
 * Language picker in the status bar (ADR-0037): «auto» follows the browser, an explicit choice
 * wins. The menu opens upwards because the status bar sits at the bottom of the window.
 *
 * The language names are written in their own language on purpose — a user who opened the app in
 * the wrong language can always find their own.
 */
export function LanguageMenu() {
  const t = useT();
  const locale = useLocale();
  const preference = useProjectStore((s) => s.localePreference);
  const setLocalePreference = useProjectStore((s) => s.setLocalePreference);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent): void => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const labelOf = (value: LocalePreference): string => {
    if (value === 'auto') return t('language.auto');
    return t(value === 'ru' ? 'language.ru' : 'language.en');
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('language.label')}
        title={t('language.label')}
        onClick={() => setOpen((value) => !value)}
        className={clsx(
          'flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wider transition',
          open
            ? 'bg-slate-800 text-slate-200'
            : 'text-slate-500 hover:bg-slate-800 hover:text-slate-100',
        )}
      >
        <GlobeIcon className="h-3 w-3" />
        {locale}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute bottom-full right-0 z-30 mb-1 w-44 overflow-hidden rounded-md border border-slate-700 bg-slate-900 py-1 text-[11px] shadow-xl"
        >
          {LOCALE_PREFERENCES.map((value) => {
            const active = value === preference;
            return (
              <button
                key={value}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                data-locale-option={value}
                onClick={() => {
                  setLocalePreference(value);
                  setOpen(false);
                }}
                className={clsx(
                  'flex w-full items-center gap-2 px-3 py-1.5 text-left transition',
                  active ? 'text-sky-200' : 'text-slate-300 hover:bg-slate-800 hover:text-white',
                )}
              >
                <span className="truncate">{labelOf(value)}</span>
                {value === 'auto' && (
                  <span className="text-[10px] uppercase tracking-wider text-slate-500">
                    {locale}
                  </span>
                )}
                {active && <CheckIcon className="ml-auto h-3.5 w-3.5 shrink-0 text-sky-400" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
