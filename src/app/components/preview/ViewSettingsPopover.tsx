import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { useProjectStore } from '../../store/useProjectStore';
import { DEFAULT_GLOBAL_SETTINGS } from '@core/model/defaults';
import type { ViewSettings } from '@core/model/types';
import { SelectField } from '../common/Select';
import { SlidersIcon, XIcon } from '../common/Icon';
import { IconButton } from '../common/IconButton';

/**
 * View settings live next to the 2D/3D switch: they belong to the preview, not to the project
 * settings panel. The popover closes with its own ✕ (and on Escape / outside click).
 */
export function ViewSettingsPopover() {
  const view = useProjectStore((s) => s.project?.global.view) ?? DEFAULT_GLOBAL_SETTINGS.view;
  const updateView = useProjectStore((s) => s.updateView);
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
      <IconButton
        label="Настройки вида"
        onClick={() => setOpen((value) => !value)}
        active={open}
        className={clsx(
          'h-[30px] w-[30px] rounded-md border',
          open
            ? 'border-sky-500 bg-sky-600 text-white'
            : 'border-slate-700 bg-slate-900/90 text-slate-400 hover:border-slate-500 hover:text-slate-100',
        )}
      >
        <SlidersIcon className="h-4 w-4" />
      </IconButton>

      {open && (
        <div className="absolute right-0 top-full z-30 mt-2 w-64 rounded-lg border border-slate-700 bg-slate-900 p-3 shadow-2xl">
          <div className="flex items-center justify-between">
            <h3 className="text-[11px] font-semibold text-slate-200">Вид</h3>
            <IconButton
              label="Закрыть"
              onClick={() => setOpen(false)}
              className="h-5 w-5 hover:bg-slate-800 hover:text-white"
            >
              <XIcon className="h-3.5 w-3.5" />
            </IconButton>
          </div>

          <div className="mt-2 space-y-2">
            <SelectField
              label="Режим 2D"
              value={view.mode2d}
              options={[
                { value: 'transparent', label: 'Полупрозрачный' },
                { value: 'heightmap', label: 'Карта высот' },
                { value: 'asis', label: 'Как есть' },
              ]}
              onChange={(value) => updateView({ mode2d: value as ViewSettings['mode2d'] })}
            />

            <SelectField
              label="Освещение"
              value={view.lighting}
              options={[
                { value: 'studio', label: 'Студийное' },
                { value: 'top', label: 'Сверху' },
                { value: 'flat', label: 'Плоское' },
              ]}
              onChange={(value) => updateView({ lighting: value as ViewSettings['lighting'] })}
            />

            <SelectField
              label="Материал"
              value={view.material}
              options={[
                { value: 'matte', label: 'Матовый' },
                { value: 'glossy', label: 'Глянцевый' },
              ]}
              onChange={(value) => updateView({ material: value as ViewSettings['material'] })}
            />

            <SelectField
              label="Проекция"
              value={view.projection}
              options={[
                { value: 'perspective', label: 'Перспективная' },
                { value: 'orthographic', label: 'Ортогональная' },
              ]}
              onChange={(value) => updateView({ projection: value as ViewSettings['projection'] })}
            />
          </div>
        </div>
      )}
    </div>
  );
}
