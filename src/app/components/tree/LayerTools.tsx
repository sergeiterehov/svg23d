import { useEffect, useMemo, useRef, useState } from 'react';
import { useProjectStore } from '../../store/useProjectStore';
import { ToolsIcon } from '../common/Icon';
import { IconButton } from '../common/IconButton';
import { paletteUsage } from '@core/color/palette';
import { parseNumber } from '../common/NumberField';
import { LAYER_MM, SINK_MM } from '@core/solver/distribute';

/** How many colours "Уменьшить число цветов" suggests by default. */
const DEFAULT_COLOR_COUNT = 4;

/**
 * Tools menu of the layers panel. It lives in the panel header because its actions operate on the
 * whole stack of parts, not on the selected element or the project settings.
 */
export function LayerTools() {
  const distributeZ = useProjectStore((s) => s.distributeZ);
  const limitPalette = useProjectStore((s) => s.limitPalette);
  const resetPalette = useProjectStore((s) => s.resetPalette);
  const leaves = useProjectStore((s) => s.leaves);
  const settings = useProjectStore((s) => s.project?.settings);
  const isEmpty = useProjectStore((s) => s.leaves.length === 0);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  // Distinct colours of the model; the menu only offers to reduce a palette that is bigger.
  const colorCount = useMemo(() => paletteUsage(leaves).length, [leaves]);
  const hasOverrides = useMemo(
    () => Object.values(settings ?? {}).some((value) => value.colorOverride !== undefined),
    [settings],
  );
  const suggested = Math.min(DEFAULT_COLOR_COUNT, colorCount);
  const parsed = parseNumber(draft);
  const target =
    parsed === null ? suggested : Math.round(Math.min(Math.max(parsed, 1), colorCount));
  const canReduce = colorCount > 1 && target < colorCount;

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
        <ToolsIcon className="h-4 w-4" />
      </IconButton>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-30 mt-1 w-64 overflow-hidden rounded-md border border-slate-700 bg-slate-900 py-1 text-left shadow-xl"
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
                isEmpty ? 'block text-xs text-slate-600' : 'block text-xs font-medium text-white'
              }
            >
              Разложить по слоям
            </span>
            <span className="mt-0.5 block text-[10px] leading-snug text-slate-500">
              Деталь входит на {SINK_MM} мм в нижнюю и выступает на {LAYER_MM} мм над верхней
            </span>
          </button>

          <div className="mt-1 border-t border-slate-800 px-3 py-1.5">
            <span
              className={
                canReduce || colorCount > 1
                  ? 'block text-xs font-medium text-white'
                  : 'block text-xs text-slate-600'
              }
            >
              Уменьшить число цветов
            </span>
            <span className="mt-0.5 block text-[10px] leading-snug text-slate-500">
              {isEmpty
                ? 'Сначала загрузите SVG'
                : colorCount <= 1
                  ? 'В модели уже один цвет'
                  : `Сейчас цветов: ${colorCount}. Палитра подбирается по ближайшим оттенкам в OKLab.`}
            </span>
            {colorCount > 1 && (
              <div className="mt-1.5 flex items-center gap-1.5">
                <input
                  type="text"
                  inputMode="numeric"
                  aria-label="Сколько цветов оставить"
                  value={draft}
                  placeholder={String(suggested)}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter') return;
                    if (!canReduce) return;
                    limitPalette(target);
                    setDraft('');
                    setOpen(false);
                  }}
                  className="w-12 rounded border border-slate-700 bg-slate-950 px-1.5 py-0.5 text-xs tabular-nums text-slate-100 outline-none focus:border-sky-500"
                />
                <button
                  type="button"
                  disabled={!canReduce}
                  onClick={() => {
                    limitPalette(target);
                    setDraft('');
                    setOpen(false);
                  }}
                  className="rounded border border-slate-700 px-2 py-0.5 text-[11px] text-slate-200 transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:text-slate-600 disabled:hover:bg-transparent"
                >
                  Применить
                </button>
                {hasOverrides && (
                  <button
                    type="button"
                    onClick={() => {
                      resetPalette();
                      setDraft('');
                      setOpen(false);
                    }}
                    className="rounded px-1.5 py-0.5 text-[11px] text-slate-400 transition hover:bg-slate-800 hover:text-slate-100"
                  >
                    Сбросить
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
