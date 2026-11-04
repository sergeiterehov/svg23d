import { useRef } from 'react';
import clsx from 'clsx';
import { useProjectStore } from '../../store/useProjectStore';
import { OpenIcon, RedoIcon, ResetIcon, SaveIcon, UndoIcon } from '../common/Icon';

export function Toolbar() {
  const project = useProjectStore((s) => s.project);
  const status = useProjectStore((s) => s.status);
  const result = useProjectStore((s) => s.result);
  const past = useProjectStore((s) => s.past);
  const future = useProjectStore((s) => s.future);
  const updateGlobal = useProjectStore((s) => s.updateGlobal);
  const exportThreeMf = useProjectStore((s) => s.exportThreeMf);
  const exportStl = useProjectStore((s) => s.exportStl);
  const rebuild = useProjectStore((s) => s.rebuild);
  const undo = useProjectStore((s) => s.undo);
  const redo = useProjectStore((s) => s.redo);
  const saveProject = useProjectStore((s) => s.saveProject);
  const openProject = useProjectStore((s) => s.openProject);
  const fileInput = useRef<HTMLInputElement>(null);

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-slate-800 bg-slate-950/70 px-4">
      <div className="flex items-baseline gap-2">
        <span className="text-sm font-semibold tracking-[0.12em] text-slate-100">SVG23D</span>
        <span className="text-[10px] uppercase tracking-wider text-slate-500">SVG → 3D</span>
      </div>

      {project && (
        <div className="flex min-w-0 items-center gap-2">
          <span className="max-w-48 truncate rounded bg-slate-800 px-2 py-0.5 text-[11px] text-slate-300">
            {project.document.fileName}
          </span>
          <StatusPill status={status} />
        </div>
      )}

      <div className="ml-auto flex items-center gap-2">
        <div className="flex items-center gap-0.5">
          <IconButton title="Отменить (⌘Z)" disabled={past.length === 0} onClick={undo}>
            <UndoIcon className="h-4 w-4" />
          </IconButton>
          <IconButton title="Повторить (⇧⌘Z)" disabled={future.length === 0} onClick={redo}>
            <RedoIcon className="h-4 w-4" />
          </IconButton>
        </div>

        <div className="flex items-center gap-0.5">
          <IconButton title="Открыть проект (.svg23d.json)" onClick={() => fileInput.current?.click()}>
            <OpenIcon className="h-4 w-4" />
          </IconButton>
          <IconButton title="Сохранить проект (⌘S)" disabled={!project} onClick={saveProject}>
            <SaveIcon className="h-4 w-4" />
          </IconButton>
        </div>

        {project && (
          <label className="flex items-center gap-1 text-[11px] text-slate-400">
            <span>Размер</span>
            <span className="relative">
              <input
                type="number"
                step={5}
                min={1}
                value={project.global.fitSizeMm}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  if (Number.isFinite(value) && value > 0) updateGlobal({ fitSizeMm: value });
                }}
                className="h-8 w-20 rounded-md border border-slate-700 bg-slate-900/70 pl-1.5 pr-7 text-right text-sm text-slate-100 outline-none focus:border-sky-500"
              />
              <span className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-[10px] leading-none text-slate-500">
                мм
              </span>
            </span>
          </label>
        )}

        <IconButton title="Пересчитать" onClick={rebuild} disabled={!project}>
          <ResetIcon className="h-4 w-4" />
        </IconButton>

        <button
          type="button"
          disabled={!result}
          onClick={exportThreeMf}
          className={clsx(
            'rounded-md px-3 py-2 text-xs font-medium transition',
            result
              ? 'bg-sky-600 text-white hover:bg-sky-500'
              : 'cursor-not-allowed bg-slate-800 text-slate-500',
          )}
          title="3MF: несколько объектов и цвета — для Bambu Studio"
        >
          3MF
        </button>

        <button
          type="button"
          disabled={!result}
          onClick={exportStl}
          className={clsx(
            'rounded-md border px-3 py-2 text-xs font-medium transition',
            result
              ? 'border-slate-600 text-slate-200 hover:border-slate-400 hover:text-white'
              : 'cursor-not-allowed border-slate-800 text-slate-600',
          )}
          title="STL: все детали одним мешем"
        >
          STL
        </button>
      </div>

      <input
        ref={fileInput}
        type="file"
        accept=".json,application/json"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void file.text().then(openProject);
          event.target.value = '';
        }}
      />
    </header>
  );
}

function IconButton({
  title,
  onClick,
  children,
  disabled,
}: {
  title: string;
  onClick: () => void;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      className={clsx(
        'grid h-7 w-7 place-items-center rounded-md border border-transparent transition',
        disabled
          ? 'cursor-not-allowed text-slate-700'
          : 'text-slate-400 hover:border-slate-700 hover:bg-slate-800 hover:text-slate-100',
      )}
    >
      {children}
    </button>
  );
}

function StatusPill({ status }: { status: 'empty' | 'building' | 'ready' | 'error' }) {
  const map = {
    empty: { text: 'пусто', className: 'bg-slate-800 text-slate-400' },
    building: { text: 'считаем…', className: 'bg-amber-500/15 text-amber-300' },
    ready: { text: 'готово', className: 'bg-emerald-500/15 text-emerald-300' },
    error: { text: 'ошибка', className: 'bg-rose-500/15 text-rose-300' },
  } as const;
  const item = map[status];
  return (
    <span className={clsx('rounded px-2 py-0.5 text-[10px] uppercase tracking-wider', item.className)}>
      {item.text}
    </span>
  );
}
