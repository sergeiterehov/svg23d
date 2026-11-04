import { useEffect } from 'react';
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
import { HelpHint } from './components/common/Icon';

export default function App() {
  const isEmpty = useProjectStore((s) => (s.project ? isEmptyDocument(s.project.document) : true));
  const viewMode = useProjectStore((s) => s.viewMode);
  const setViewMode = useProjectStore((s) => s.setViewMode);
  const select = useProjectStore((s) => s.select);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!event.metaKey && !event.ctrlKey) return;
      const target = event.target as HTMLElement | null;
      const inField =
        !!target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      const key = event.key.toLowerCase();

      if (key === 'z' && !inField) {
        event.preventDefault();
        const state = useProjectStore.getState();
        if (event.shiftKey) state.redo();
        else state.undo();
      } else if (key === 's') {
        event.preventDefault();
        useProjectStore.getState().saveProject();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <div className="flex h-full flex-col bg-slate-950 text-slate-200">
      <Toolbar />

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
              if (!(event.target as HTMLElement).closest('[data-node-row]')) select(null);
            }}
          >
            <div className="flex items-center gap-1 px-3 py-2 text-[10px] uppercase tracking-wider text-slate-500">
              <span>Слои</span>
              <HelpHint text="Сверху вниз = порядок вырезания: верхний элемент делает гнёзда в нижних. Стрелки меняют порядок вручную." />
              <LayerTools />
            </div>
            <LayerTree />
          </div>
        </aside>

        <main className="relative min-w-0 flex-1 bg-slate-900">
          <div className="absolute right-3 top-3 z-20 flex items-center gap-2">
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

          <div className="h-full w-full">
            {viewMode === '3d' ? <Preview3D /> : <Preview2D />}
          </div>
        </main>

        <aside className="w-80 shrink-0 border-l border-slate-800 bg-slate-950">
          <Inspector />
        </aside>
      </div>

      <StatusBar />
    </div>
  );
}
