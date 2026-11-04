import { useRef } from 'react';
import clsx from 'clsx';
import { useProjectStore } from '../../store/useProjectStore';
import { OpenIcon, RedoIcon, SaveIcon, UndoIcon } from '../common/Icon';
import { IconButton } from '../common/IconButton';
import { useTooltip } from '../common/Tooltip';

const iconClass =
  'h-7 w-7 rounded-md border border-transparent hover:border-slate-700 hover:bg-slate-800 hover:text-slate-100';

export function Toolbar() {
  const project = useProjectStore((s) => s.project);
  const result = useProjectStore((s) => s.result);
  const past = useProjectStore((s) => s.past);
  const future = useProjectStore((s) => s.future);
  const exportThreeMf = useProjectStore((s) => s.exportThreeMf);
  const exportStl = useProjectStore((s) => s.exportStl);
  const undo = useProjectStore((s) => s.undo);
  const redo = useProjectStore((s) => s.redo);
  const saveProject = useProjectStore((s) => s.saveProject);
  const openProject = useProjectStore((s) => s.openProject);
  const loadSvgText = useProjectStore((s) => s.loadSvgText);
  const fileInput = useRef<HTMLInputElement>(null);
  const exportTip = useTooltip(
    '3MF: отдельные объекты и цвета — для Bambu Studio и других слайсеров',
  );
  const stlTip = useTooltip('STL: все детали слиты в один меш');

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-slate-800 bg-slate-950/70 px-4">
      <div className="flex items-baseline gap-2">
        <span className="text-sm font-semibold tracking-[0.12em] text-slate-100">SVG23D</span>
        <span className="text-[10px] uppercase tracking-wider text-slate-500">SVG → 3D</span>
      </div>

      {project && (
        <span className="max-w-48 truncate rounded bg-slate-800 px-2 py-0.5 text-[11px] text-slate-300">
          {project.document.fileName}
        </span>
      )}

      <div className="ml-auto flex items-center gap-2">
        <div className="flex items-center gap-0.5">
          <IconButton
            label="Отменить (⌘Z)"
            disabled={past.length === 0}
            onClick={undo}
            className={iconClass}
          >
            <UndoIcon className="h-4 w-4" />
          </IconButton>
          <IconButton
            label="Повторить (⇧⌘Z)"
            disabled={future.length === 0}
            onClick={redo}
            className={iconClass}
          >
            <RedoIcon className="h-4 w-4" />
          </IconButton>
        </div>

        <div className="flex items-center gap-0.5">
          <IconButton
            label="Открыть SVG или проект (.svg23d.json)"
            onClick={() => fileInput.current?.click()}
            className={iconClass}
          >
            <OpenIcon className="h-4 w-4" />
          </IconButton>
          <IconButton
            label="Сохранить проект (⌘S)"
            disabled={!project}
            onClick={saveProject}
            className={iconClass}
          >
            <SaveIcon className="h-4 w-4" />
          </IconButton>
        </div>

        <button
          type="button"
          disabled={!result}
          onClick={exportThreeMf}
          {...exportTip.handlers}
          className={clsx(
            'rounded-md px-3 py-2 text-xs font-medium transition',
            result
              ? 'bg-sky-600 text-white hover:bg-sky-500'
              : 'cursor-not-allowed bg-slate-800 text-slate-500',
          )}
        >
          3MF
        </button>
        {exportTip.tooltip}

        <button
          type="button"
          disabled={!result}
          onClick={exportStl}
          {...stlTip.handlers}
          className={clsx(
            'rounded-md border px-3 py-2 text-xs font-medium transition',
            result
              ? 'border-slate-600 text-slate-200 hover:border-slate-400 hover:text-white'
              : 'cursor-not-allowed border-slate-800 text-slate-600',
          )}
        >
          STL
        </button>
        {stlTip.tooltip}
      </div>

      <input
        ref={fileInput}
        type="file"
        accept=".json,.svg,application/json,image/svg+xml"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) {
            // The upload panel is only visible for an empty document, so replacing the SVG
            // goes through this file picker too.
            if (/\.svg$/i.test(file.name)) void file.text().then((text) => loadSvgText(text, file.name));
            else void file.text().then(openProject);
          }
          event.target.value = '';
        }}
      />
    </header>
  );
}
