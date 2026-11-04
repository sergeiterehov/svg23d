import { useEffect, useMemo, useRef } from 'react';
import { useProjectStore } from '../../store/useProjectStore';
import { createViewer, type ViewerHandle } from '@viewer/createViewer';
import { partIdForSelection } from '@core/solver/selection';

export function Preview3D() {
  const containerRef = useRef<HTMLDivElement>(null);
  const navCubeRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<ViewerHandle | null>(null);
  const result = useProjectStore((s) => s.result);
  const select = useProjectStore((s) => s.select);
  const selectedId = useProjectStore((s) => s.selectedId);
  const leaves = useProjectStore((s) => s.leaves);
  const project = useProjectStore((s) => s.project);
  const material = useProjectStore((s) => s.project?.global.view.material ?? 'matte');
  const lighting = useProjectStore((s) => s.project?.global.view.lighting ?? 'studio');
  const projection = useProjectStore((s) => s.project?.global.view.projection ?? 'perspective');
  const documentHash = useProjectStore((s) => s.project?.document.hash ?? null);
  const framedHashRef = useRef<string | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const viewer = createViewer(containerRef.current, {
      onBackgroundClick: () => select(null),
      onPartClick: (partId) => select(partId),
    });
    viewerRef.current = viewer;
    const detachCube = navCubeRef.current ? viewer.mountNavCube(navCubeRef.current) : null;
    return () => {
      detachCube?.();
      viewer.dispose();
      viewerRef.current = null;
    };
  }, [select]);

  useEffect(() => {
    // Frame the camera only when the document changes, so a rebuild never jumps the view.
    const shouldFrame = framedHashRef.current !== documentHash;
    framedHashRef.current = documentHash;
    viewerRef.current?.setParts(result?.parts ?? [], { frame: shouldFrame });
  }, [result, documentHash]);

  const selectedPartId = useMemo(
    () => (project ? partIdForSelection(project.document.root, leaves, selectedId) : null),
    [project, leaves, selectedId],
  );

  useEffect(() => {
    viewerRef.current?.setSelectedPart(selectedPartId);
  }, [selectedPartId, result]);

  useEffect(() => {
    viewerRef.current?.setView({ material, lighting, projection });
  }, [material, lighting, projection]);

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" />
      <div ref={navCubeRef} className="absolute bottom-3 right-3 z-10 h-[96px] w-[96px]" />
      {!result && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-sm text-slate-500">
          Модель ещё не построена
        </div>
      )}
    </div>
  );
}
