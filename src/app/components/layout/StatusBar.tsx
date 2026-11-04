import { useState } from 'react';
import clsx from 'clsx';
import { useProjectStore } from '../../store/useProjectStore';

export function StatusBar() {
  const warnings = useProjectStore((s) => s.warnings);
  const error = useProjectStore((s) => s.error);
  const status = useProjectStore((s) => s.status);
  const modelSize = useProjectStore((s) => s.modelSize);
  const result = useProjectStore((s) => s.result);
  const [open, setOpen] = useState(false);

  const uniqueWarnings = dedupe(warnings);

  return (
    <footer className="shrink-0 border-t border-slate-800 bg-slate-950/70 text-[11px]">
      {open && uniqueWarnings.length > 0 && (
        <ul className="max-h-40 overflow-y-auto border-b border-slate-800 px-4 py-2">
          {uniqueWarnings.map((warning, index) => (
            <li key={`${warning.code}-${index}`} className="py-0.5 text-slate-400">
              <span className="mr-2 rounded bg-slate-800 px-1 text-[9px] uppercase tracking-wide text-slate-500">
                {warning.code}
              </span>
              {warning.message}
            </li>
          ))}
        </ul>
      )}

      <div className="flex h-8 items-center gap-4 px-4 text-slate-400">
        {error && <span className="truncate text-rose-400">{error}</span>}
        {!error && (
          <span>
            {status === 'building'
              ? 'Построение модели…'
              : modelSize
                ? `Модель ${round(modelSize.widthMm)} × ${round(modelSize.heightMm)} мм`
                : 'Файл не загружен'}
          </span>
        )}

        {result && (
          <span className="text-slate-500">
            {result.stats.partCount} дет. · {result.stats.triangleCount.toLocaleString('ru-RU')} тр. ·{' '}
            {(result.stats.volume / 1000).toFixed(2)} см³
          </span>
        )}

        {uniqueWarnings.length > 0 && (
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            className={clsx(
              'ml-auto rounded px-2 py-0.5',
              open ? 'bg-slate-800 text-slate-200' : 'text-amber-400 hover:bg-slate-800',
            )}
          >
            предупреждений: {uniqueWarnings.length}
          </button>
        )}
      </div>
    </footer>
  );
}

function dedupe<T extends { code: string; message: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const item of items) {
    const key = `${item.code}:${item.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}
