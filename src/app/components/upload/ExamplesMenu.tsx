import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { EXAMPLES, useProjectStore, type ExampleId } from '../../store/useProjectStore';
import { useT } from '../../i18n';
import { ChevronDownIcon } from '../common/Icon';

const EXAMPLE_IDS = Object.keys(EXAMPLES) as ExampleId[];

/**
 * Dropdown with the bundled examples. Used by the empty-state upload panel (opens downwards) and
 * by the status bar (opens upwards, because it sits at the bottom of the window).
 */
export function ExamplesMenu({
  direction = 'down',
  triggerClassName,
}: {
  direction?: 'up' | 'down';
  triggerClassName?: string;
}) {
  const t = useT();
  const loadExample = useProjectStore((s) => s.loadExample);
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

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className={clsx(
          'flex items-center gap-1 transition',
          triggerClassName ??
            'rounded-md border border-slate-700 px-2.5 py-1.5 text-xs text-slate-300 hover:border-slate-500 hover:text-white',
        )}
      >
        {t('examples.title')}
        <ChevronDownIcon className={clsx('h-3 w-3 transition', open && 'rotate-180')} />
      </button>

      {open && (
        <div
          role="menu"
          className={clsx(
            'absolute left-0 z-30 w-52 overflow-hidden rounded-md border border-slate-700 bg-slate-900 py-1 text-left shadow-xl',
            direction === 'up' ? 'bottom-full mb-1' : 'top-full mt-1',
          )}
        >
          {EXAMPLE_IDS.map((id) => (
            <button
              key={id}
              type="button"
              role="menuitem"
              onClick={() => {
                loadExample(id);
                setOpen(false);
              }}
              className="block w-full px-3 py-1.5 text-left text-xs text-slate-300 hover:bg-slate-800 hover:text-white"
            >
              {t(EXAMPLES[id].descriptionKey)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
