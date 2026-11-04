import { useEffect, useRef } from 'react';
import { useProjectStore } from '../../store/useProjectStore';
import { createViewer, type ViewerHandle } from '@viewer/createViewer';

export function Preview3D() {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<ViewerHandle | null>(null);
  const result = useProjectStore((s) => s.result);
  const select = useProjectStore((s) => s.select);

  useEffect(() => {
    if (!containerRef.current) return;
    const viewer = createViewer(containerRef.current, {
      onBackgroundClick: () => select(null),
    });
    viewerRef.current = viewer;
    return () => {
      viewer.dispose();
      viewerRef.current = null;
    };
  }, [select]);

  useEffect(() => {
    viewerRef.current?.setParts(result?.parts ?? []);
  }, [result]);

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" />
      {!result && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-sm text-slate-500">
          Модель ещё не построена
        </div>
      )}
    </div>
  );
}
