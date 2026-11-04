import { useEffect, useRef, useState } from 'react';
import { useProjectStore } from '../../store/useProjectStore';
import { HammerIcon, WrenchIcon } from '../common/Icon';
import { IconButton } from '../common/IconButton';
import { LAYER_MM, SINK_MM } from '@core/solver/distribute';

/**
 * Tools menu of the layers panel. It lives in the panel header because its actions operate on the
 * whole stack of parts, not on the selected element or the project settings.
 */
export function LayerTools() {
  const distributeZ = useProjectStore((s) => s.distributeZ);
  const isEmpty = useProjectStore((s) => s.leaves.length === 0);
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
    <div ref={containerRef} className="relative ml-auto normal-case tracking-normal">
      <IconButton
        label="Инструменты"
        active={open}
        onClick={() => setOpen((value) => !value)}
        className={
          open
            ? 'h-6 w-6 bg-slate-800 text-sky-300'
            : 'h-6 w-6 text-slate-500 hover:bg-slate-800 hover:text-slate-100'
        }
      >
        <span className="flex items-center gap-px">
          <WrenchIcon className="h-3 w-3" />
          <HammerIcon className="h-3 w-3" />
        </span>
      </IconButton>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-30 mt-1 w-60 overflow-hidden rounded-md border border-slate-700 bg-slate-900 py-1 text-left shadow-xl"
        >
          <button
            type="button"
            role="menuitem"
            disabled={isEmpty}
            onClick={() => {
              distributeZ();
              setOpen(false);
            }}
            className="block w-full px-3 py-1.5 text-left transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:hover:bg-transparent"
          >
            <span
              className={
                isEmpty ? 'block text-xs text-slate-600' : 'block text-xs text-slate-200'
              }
            >
              Разложить по слоям
            </span>
            <span className="mt-0.5 block text-[10px] leading-snug text-slate-500">
              Полоса {LAYER_MM} мм с заходом {SINK_MM} мм в слой под деталью
            </span>
          </button>
        </div>
      )}
    </div>
  );
}
