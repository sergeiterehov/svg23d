import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { useProjectStore, type ExampleId } from '../../store/useProjectStore';
import { ChevronDownIcon } from '../common/Icon';

const EXAMPLE_OPTIONS: Array<{ id: ExampleId; label: string }> = [
  { id: 'html5', label: 'Логотип HTML5' },
  { id: 'landscape', label: 'Пейзаж со слоями' },
  { id: 'name', label: 'Текст с обводкой' },
];

/** Drag & drop / file picker plus a compact dropdown with the bundled examples. */
export function SvgDropzone({ compact = false }: { compact?: boolean }) {
  const loadSvgText = useProjectStore((s) => s.loadSvgText);
  const loadExample = useProjectStore((s) => s.loadExample);
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
        'rounded-lg border border-dashed transition',
        dragging ? 'border-sky-400 bg-sky-500/10' : 'border-slate-700 bg-slate-900/40',
        compact ? 'p-3' : 'p-8',
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
            className="rounded-md bg-sky-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-500"
          >
            Выбрать файл
          </button>
          <ExamplesMenu onPick={loadExample} />
        </div>
        {!compact && (
          <p className="max-w-xs text-[11px] leading-relaxed text-slate-500">
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

function ExamplesMenu({ onPick }: { onPick: (id: ExampleId) => void }) {
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
        className="flex items-center gap-1 rounded-md border border-slate-700 px-2.5 py-1.5 text-xs text-slate-300 transition hover:border-slate-500 hover:text-white"
      >
        Примеры
        <ChevronDownIcon className={clsx('h-3 w-3 transition', open && 'rotate-180')} />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-30 mt-1 w-48 overflow-hidden rounded-md border border-slate-700 bg-slate-900 py-1 text-left shadow-xl"
        >
          {EXAMPLE_OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              role="menuitem"
              onClick={() => {
                onPick(option.id);
                setOpen(false);
              }}
              className="block w-full px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800 hover:text-white"
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
