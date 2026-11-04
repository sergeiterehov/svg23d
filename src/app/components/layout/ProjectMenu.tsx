import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { useProjectStore } from '../../store/useProjectStore';
import { ChevronDownIcon, TrashIcon } from '../common/Icon';
import { Dialog, DialogButton } from '../common/Dialog';

/**
 * Project switcher in the header (ADR-0031): the current name with a chevron, a list of everything
 * stored in the browser (newest edit first), inline rename on double click and deletion behind a
 * confirmation. Names may repeat — the list is keyed by guid.
 */
export function ProjectMenu() {
  const projectName = useProjectStore((s) => s.projectName);
  const projectId = useProjectStore((s) => s.projectId);
  const library = useProjectStore((s) => s.library);
  const openLibraryProject = useProjectStore((s) => s.openLibraryProject);
  const renameProject = useProjectStore((s) => s.renameProject);
  const renameLibraryProject = useProjectStore((s) => s.renameLibraryProject);
  const deleteLibraryProject = useProjectStore((s) => s.deleteLibraryProject);

  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  /**
   * A click opens the project, a double click renames it: the open is delayed by a hair so the
   * second click of a double click can cancel it.
   */
  const clickTimer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (clickTimer.current !== null) window.clearTimeout(clickTimer.current);
    },
    [],
  );

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

  const deleting = library.find((item) => item.id === deletingId) ?? null;

  const commitRename = (id: string): void => {
    const value = draft.trim();
    setEditingId(null);
    if (value === '') return;
    if (id === projectId) renameProject(value);
    else void renameLibraryProject(id, value);
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Проект «${projectName}»: список проектов`}
        onClick={() => setOpen((value) => !value)}
        className={clsx(
          'flex max-w-64 items-center gap-1 rounded-md border px-2 py-1 text-[11px] transition',
          open
            ? 'border-slate-600 bg-slate-800 text-white'
            : 'border-slate-800 bg-slate-900/60 text-slate-300 hover:border-slate-600 hover:text-white',
        )}
      >
        <span className="truncate">{projectName}</span>
        <ChevronDownIcon className="h-3 w-3 shrink-0 text-slate-500" />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute left-0 top-full z-30 mt-1 w-72 overflow-hidden rounded-lg border border-slate-700 bg-slate-900 shadow-2xl"
        >
          {/* Same caption as the panel sections: white, 11 px, semibold, no uppercase. */}
          <div className="flex items-center justify-between px-3 py-2.5 text-[11px] font-semibold text-slate-200">
            <span>Проекты</span>
            <span className="text-[10px] font-normal tabular-nums text-slate-500">
              {library.length}
            </span>
          </div>

          <div className="max-h-72 overflow-y-auto border-t border-slate-800">
            {library.length === 0 && (
              <p className="px-3 py-3 text-[11px] leading-snug text-slate-500">
                История пуста. Импортируйте SVG — проект сохранится в браузере сам.
              </p>
            )}

            {library.map((item) => {
              const editing = editingId === item.id;
              return (
                <div
                  key={item.id}
                  role="menuitem"
                  data-project-row={item.id}
                  className={clsx(
                    'group flex cursor-pointer items-center gap-2 px-3 py-1.5 text-xs transition',
                    item.id === projectId
                      ? 'bg-sky-500/10 text-sky-100'
                      : 'text-slate-300 hover:bg-slate-800',
                  )}
                  onClick={() => {
                    if (editing) return;
                    if (clickTimer.current !== null) window.clearTimeout(clickTimer.current);
                    clickTimer.current = window.setTimeout(() => {
                      clickTimer.current = null;
                      setOpen(false);
                      void openLibraryProject(item.id);
                    }, DOUBLE_CLICK_MS);
                  }}
                  onDoubleClick={() => {
                    if (clickTimer.current !== null) {
                      window.clearTimeout(clickTimer.current);
                      clickTimer.current = null;
                    }
                    setEditingId(item.id);
                    setDraft(item.name);
                  }}
                >
                  {editing ? (
                    <input
                      autoFocus
                      value={draft}
                      aria-label="Имя проекта"
                      // The whole name is selected, so typing replaces it instead of appending.
                      onFocus={(event) => event.currentTarget.select()}
                      onChange={(event) => setDraft(event.target.value)}
                      onClick={(event) => event.stopPropagation()}
                      onDoubleClick={(event) => event.stopPropagation()}
                      onBlur={() => commitRename(item.id)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          commitRename(item.id);
                        } else if (event.key === 'Escape') {
                          event.preventDefault();
                          setEditingId(null);
                        }
                      }}
                      className="min-w-0 flex-1 rounded border border-sky-500 bg-slate-950 px-1 py-0 text-xs text-white outline-none"
                    />
                  ) : (
                    <span className="truncate" title="Двойной клик — переименовать">
                      {item.name}
                    </span>
                  )}

                  {item.id === projectId && (
                    <span className="shrink-0 rounded bg-sky-500/15 px-1 text-[9px] text-sky-300">
                      открыт
                    </span>
                  )}

                  <span className="ml-auto shrink-0 text-[10px] tabular-nums text-slate-500">
                    {formatUpdatedAt(item.updatedAt)}
                  </span>

                  <button
                    type="button"
                    aria-label={`Удалить проект «${item.name}»`}
                    onClick={(event) => {
                      event.stopPropagation();
                      setDeletingId(item.id);
                    }}
                    className="grid h-5 w-5 shrink-0 place-items-center rounded text-slate-500 opacity-0 transition hover:bg-rose-500/20 hover:text-rose-300 group-hover:opacity-100 focus-visible:opacity-100"
                  >
                    <TrashIcon className="h-3.5 w-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {deleting && (
        <Dialog
          title="Удалить проект?"
          onClose={() => setDeletingId(null)}
          footer={
            <>
              <DialogButton onClick={() => setDeletingId(null)}>Отмена</DialogButton>
              <DialogButton
                variant="danger"
                onClick={() => {
                  setDeletingId(null);
                  setOpen(false);
                  void deleteLibraryProject(deleting.id);
                }}
              >
                Удалить
              </DialogButton>
            </>
          }
        >
          «{deleting.name}» исчезнет из истории браузера. Скачанный файл проекта, если он есть,
          останется на диске.
        </Dialog>
      )}
    </div>
  );
}

/** Long enough to tell a double click from two single ones, short enough to feel instant. */
const DOUBLE_CLICK_MS = 220;

/** "сегодня, 14:32" / "вчера, 09:10" / "04.11.2025" — when the project was last edited. */
function formatUpdatedAt(timestamp: number): string {
  const date = new Date(timestamp);
  const time = date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  const sameDay = (a: Date, b: Date): boolean => a.toDateString() === b.toDateString();
  const today = new Date();
  if (sameDay(date, today)) return `сегодня, ${time}`;
  if (sameDay(date, new Date(today.getTime() - 86_400_000))) return `вчера, ${time}`;
  return date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
