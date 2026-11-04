import { useRef, useState } from 'react';
import clsx from 'clsx';
import { useProjectStore } from '../../store/useProjectStore';
import { ExamplesMenu } from './ExamplesMenu';

/** Drag & drop / file picker; compact mode is the block at the top of the layers panel. */
export function SvgDropzone({ compact = false }: { compact?: boolean }) {
  const loadSvgText = useProjectStore((s) => s.loadSvgText);
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const readFile = async (file: File): Promise<void> => {
    if (!/\.svg$/i.test(file.name)) {
      setError('Нужен файл с расширением .svg');
      return;
    }
    setError(null);
    const text = await file.text();
    loadSvgText(text, file.name);
  };

  return (
    <div
      className={clsx(
        'w-full rounded-lg border border-dashed transition',
        compact ? 'p-2.5' : 'max-w-sm p-6',
        dragging ? 'border-sky-400 bg-sky-500/10' : 'border-slate-700 bg-slate-900/40',
      )}
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        const file = event.dataTransfer.files[0];
        if (file) void readFile(file);
      }}
    >
      <div className={clsx('flex flex-col items-center text-center', compact ? 'gap-2' : 'gap-3')}>
        <p className={clsx('text-slate-300', compact ? 'text-xs' : 'text-sm')}>
          Перетащите SVG сюда
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className={clsx(
              'rounded-md bg-sky-600 font-medium text-white hover:bg-sky-500',
              compact ? 'px-2.5 py-1 text-[11px]' : 'px-3 py-1.5 text-xs',
            )}
          >
            Выбрать файл
          </button>
          <ExamplesMenu
            triggerClassName={clsx(
              'flex items-center gap-1 rounded-md border border-slate-700 text-slate-300 hover:border-slate-500 hover:text-white',
              compact ? 'px-2 py-1 text-[11px]' : 'px-2.5 py-1.5 text-xs',
            )}
          />
        </div>
        {!compact && (
          <p className="text-[11px] leading-relaxed text-slate-500">
            Поддерживаются фигуры с заливкой и обводкой: path, rect, circle, ellipse, polygon, use
            и группы &lt;g&gt;.
          </p>
        )}
        {error && <p className="text-[11px] text-rose-400">{error}</p>}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept=".svg,image/svg+xml"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void readFile(file);
          event.target.value = '';
        }}
      />
    </div>
  );
}
