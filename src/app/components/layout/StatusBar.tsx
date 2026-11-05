import { useState } from 'react';
import clsx from 'clsx';
import { formatNumber } from '@i18n';
import { useProjectStore, type Status } from '../../store/useProjectStore';
import { useT } from '../../i18n';
import { ResetIcon } from '../common/Icon';
import { IconButton } from '../common/IconButton';
import { LanguageMenu } from './LanguageMenu';

/** Repository of the project: the link sits in the status bar so it is reachable from any view. */
const GITHUB_URL = 'https://github.com/sergeiterehov/svg23d';

export function StatusBar() {
  const t = useT();
  const warnings = useProjectStore((s) => s.warnings);
  const error = useProjectStore((s) => s.error);
  const status = useProjectStore((s) => s.status);
  const modelSize = useProjectStore((s) => s.modelSize);
  const result = useProjectStore((s) => s.result);
  const project = useProjectStore((s) => s.project);
  const rebuild = useProjectStore((s) => s.rebuild);
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

      <div className="flex h-8 items-center gap-3 px-4 text-slate-400">
        <StatusPill status={status} />

        {error ? (
          <span className="truncate select-none text-rose-400">{error}</span>
        ) : (
          <span className="select-none">
            {status === 'building'
              ? t('status.building')
              : modelSize
                ? t('status.modelSize', {
                    width: round(modelSize.widthMm),
                    height: round(modelSize.heightMm),
                  })
                : t('status.empty')}
          </span>
        )}

        {result && (
          <span className="select-none text-slate-500">
            {t('status.stats', {
              parts: result.stats.partCount,
              triangles: formatNumber(result.stats.triangleCount),
              volume: (result.stats.volume / 1000).toFixed(2),
            })}
          </span>
        )}

        <div className="ml-auto flex items-center gap-1">
          {/* Warnings come first so the rebuild button keeps the rightmost place whatever happens. */}
          {uniqueWarnings.length > 0 && (
            <button
              type="button"
              onClick={() => setOpen((value) => !value)}
              className={clsx(
                'rounded px-2 py-0.5',
                open ? 'bg-slate-800 text-slate-200' : 'text-amber-400 hover:bg-slate-800',
              )}
            >
              {t('status.warnings', { count: uniqueWarnings.length })}
            </button>
          )}

          <LanguageMenu />

          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noreferrer"
            title={t('status.github')}
            className="rounded px-2 py-0.5 text-slate-500 transition hover:bg-slate-800 hover:text-slate-100"
          >
            GitHub
          </a>

          <IconButton
            label={t('status.rebuild')}
            onClick={rebuild}
            disabled={!project || status === 'empty'}
            className="h-6 w-6 hover:bg-slate-800 hover:text-slate-100"
          >
            <ResetIcon className="h-3.5 w-3.5" />
          </IconButton>
        </div>
      </div>
    </footer>
  );
}

function StatusPill({ status }: { status: Status }) {
  const t = useT();
  const map = {
    empty: { text: t('status.pill.empty'), className: 'bg-slate-800 text-slate-400' },
    building: { text: t('status.pill.building'), className: 'bg-amber-500/15 text-amber-300' },
    ready: { text: t('status.pill.ready'), className: 'bg-emerald-500/15 text-emerald-300' },
    error: { text: t('status.pill.error'), className: 'bg-rose-500/15 text-rose-300' },
  } as const;
  const item = map[status];
  return (
    <span
      className={clsx(
        'shrink-0 rounded px-2 py-0.5 text-[10px] uppercase tracking-wider',
        item.className,
      )}
    >
      {item.text}
    </span>
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
