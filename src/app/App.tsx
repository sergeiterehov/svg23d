import { useEffect, useRef } from 'react';
import clsx from 'clsx';
import { useProjectStore } from './store/useProjectStore';
import { isEmptyDocument } from '@core/model/empty';
import { Toolbar } from './components/layout/Toolbar';
import { StatusBar } from './components/layout/StatusBar';
import { SvgDropzone } from './components/upload/SvgDropzone';
import { LayerTree } from './components/tree/LayerTree';
import { LayerTools } from './components/tree/LayerTools';
import { Preview2D } from './components/preview/Preview2D';
import { Preview3D } from './components/preview/Preview3D';
import { Inspector } from './components/inspector/Inspector';
import { ViewSettingsPopover } from './components/preview/ViewSettingsPopover';
import { ImportConflictDialog } from './components/layout/ImportConflictDialog';
import { HelpHint } from './components/common/Icon';
import { bootstrap } from './storage/persistence';

export default function App() {
  const isEmpty = useProjectStore((s) => (s.project ? isEmptyDocument(s.project.document) : true));
  const viewMode = useProjectStore((s) => s.viewMode);
  const setViewMode = useProjectStore((s) => s.setViewMode);
  const select = useProjectStore((s) => s.select);
  const hydrated = useProjectStore((s) => s.hydrated);
  // The picker lives here, next to the shortcut, and the toolbar button uses the same input.
  const fileInput = useRef<HTMLInputElement>(null);

  // Read the browser library and reopen the last project before anything is drawn (ADR-0031).
  useEffect(() => {
    bootstrap();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      const inField =
        !!target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      const key = event.key.toLowerCase();

      // ⌥⇧U (by physical key, so it works on any layout) — union the selection into one object.
      if (event.altKey && event.shiftKey && event.code === 'KeyU' && !inField) {
        event.preventDefault();
        useProjectStore.getState().unionSelected();
        return;
      }

      if (!event.metaKey && !event.ctrlKey) {
        // Delete / ⌫ remove the selected elements (never while typing).
        if ((event.key === 'Delete' || event.key === 'Backspace') && !inField) {
          const state = useProjectStore.getState();
          if (state.selectedIds.length > 0) {
            event.preventDefault();
            state.removeSelected();
          }
        }
        return;
      }

      if (key === 'z' && !inField) {
        event.preventDefault();
        const state = useProjectStore.getState();
        if (event.shiftKey) state.redo();
        else state.undo();
      } else if (key === 'y' && !inField) {
        // Windows-style redo as well as ⇧⌘Z.
        event.preventDefault();
        useProjectStore.getState().redo();
      } else if (key === 'a' && !inField) {
        // Select every printable part, the same set the tree and the 3D view show as elements.
        event.preventDefault();
        useProjectStore.getState().selectAll();
      } else if (key === 'g' && !inField) {
        event.preventDefault();
        useProjectStore.getState().groupSelected();
      } else if (key === 's') {
        event.preventDefault();
        useProjectStore.getState().saveProject();
      } else if (key === 'o') {
        // Opening a file is only meaningful when nothing is being typed.
        event.preventDefault();
        if (!inField) fileInput.current?.click();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Nothing to show until the stored session is read: otherwise the empty project flashes first.
  if (!hydrated) {
    return (
      <div className="grid h-full place-items-center bg-slate-950 text-xs text-slate-500">
        Открываем последний проект…
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-slate-950 text-slate-200">
      <Toolbar onOpenFile={() => fileInput.current?.click()} />

      <input
        ref={fileInput}
        type="file"
        accept=".json,.svg,application/json,image/svg+xml"
        className="hidden"
        aria-label="Открыть SVG или проект"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) {
            // The upload panel only exists for an empty document, so replacing the SVG goes through
            // this file picker too.
            const state = useProjectStore.getState();
            if (/\.svg$/i.test(file.name))
              void file.text().then((text) => state.importSvg(text, file.name));
            else void file.text().then((text) => state.openProject(text));
          }
          event.target.value = '';
        }}
      />

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-72 shrink-0 flex-col border-r border-slate-800 bg-slate-950">
          {isEmpty && (
            <div className="border-b border-slate-800 p-2">
              <SvgDropzone compact />
            </div>
          )}
          <div
            className="min-h-0 flex-1 overflow-y-auto"
            onClick={(event) => {
              // Click on empty space below the tree → deselect, so the inspector shows project settings.
              // The panel header keeps the selection: its menu acts on the selected elements.
              const target = event.target as HTMLElement;
              if (!target.closest('[data-node-row]') && !target.closest('[data-keep-selection]')) {
                select(null);
              }
            }}
          >
            <div
              className="flex items-center gap-1 border-b border-slate-800/70 px-3 py-2.5 text-[11px] font-semibold text-slate-200"
              data-keep-selection
            >
              <span>Слои</span>
              <HelpHint text="Сверху вниз = порядок вырезания: верхний элемент делает гнёзда в нижних. Перетащите строку, чтобы переместить элемент в любую группу. Двойной клик — переименовать. ⌘/Ctrl-клик добавляет к выбору, Shift-клик выбирает диапазон, ⌘/Ctrl+A — все элементы, ⌘G — сгруппировать, ⌥⇧U — объединить в одну деталь, Delete — удалить." />
              <LayerTools />
            </div>
            <LayerTree />
          </div>
        </aside>

        <main className="relative min-w-0 flex-1 bg-slate-900">
          <div className="h-full w-full">{viewMode === '3d' ? <Preview3D /> : <Preview2D />}</div>

          {/* Bottom-right: the navigation cube sits above this row (see Preview3D). */}
          <div className="absolute bottom-3 right-3 z-20 flex items-center gap-2">
            <div className="flex overflow-hidden rounded-md border border-slate-700 bg-slate-900/90 text-xs">
              {(['2d', '3d'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setViewMode(mode)}
                  className={clsx(
                    'px-3 py-1.5 uppercase tracking-wide transition',
                    viewMode === mode
                      ? 'bg-sky-600 text-white'
                      : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200',
                  )}
                >
                  {mode}
                </button>
              ))}
            </div>
            <ViewSettingsPopover />
          </div>
        </main>

        <aside className="w-80 shrink-0 border-l border-slate-800 bg-slate-950">
          <Inspector />
        </aside>
      </div>

      <StatusBar />
      <ImportConflictDialog />
    </div>
  );
}
