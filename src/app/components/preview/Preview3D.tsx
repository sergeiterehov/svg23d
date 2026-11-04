import { useEffect, useMemo, useRef } from 'react';
import { useProjectStore, HEIGHT_STEP_MM } from '../../store/useProjectStore';
import { createViewer, type ViewerHandle } from '@viewer/createViewer';
import { partIdForSelection } from '@core/solver/selection';
import { collectSubtreeIds } from '@core/solver/selection';
import { effectiveSettingsFor } from '@core/solver/inheritance';
import { findNode } from '@core/solver/resolveLeaves';
import { bboxOfContours } from '@core/model/defaults';

export function Preview3D() {
  const containerRef = useRef<HTMLDivElement>(null);
  const navCubeRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<ViewerHandle | null>(null);
  const heightDragRef = useRef<{ side: 'top' | 'bottom'; applied: number } | null>(null);
  const result = useProjectStore((s) => s.result);
  const select = useProjectStore((s) => s.select);
  const toggleSelected = useProjectStore((s) => s.toggleSelected);
  const selectedIds = useProjectStore((s) => s.selectedIds);
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
      onPartAdd: (partId) => toggleSelected(partId),
      heightStepMm: HEIGHT_STEP_MM,
      // Dragging an arrow on the model changes «от»/«до»; each 0.5 mm applies as a relative step,
      // so a multi-selection keeps its per-element differences.
      onHeightDragStart: (side) => {
        heightDragRef.current = { side, applied: 0 };
      },
      onHeightDrag: (side, deltaMm) => {
        const drag = heightDragRef.current;
        if (!drag || drag.side !== side) return;
        const diff = deltaMm - drag.applied;
        if (diff === 0) return;
        drag.applied = deltaMm;
        // Immediate rebuild: the model follows the arrow while it is being dragged.
        useProjectStore.getState().nudgeHeight(side === 'top' ? 'zTo' : 'zFrom', diff, true);
      },
      onHeightDragEnd: () => {
        heightDragRef.current = null;
      },
    });
    viewerRef.current = viewer;
    const detachCube = navCubeRef.current ? viewer.mountNavCube(navCubeRef.current) : null;
    return () => {
      detachCube?.();
      viewer.dispose();
      viewerRef.current = null;
    };
  }, [select, toggleSelected]);

  useEffect(() => {
    // Frame the camera only when the document changes, so a rebuild never jumps the view.
    const shouldFrame = framedHashRef.current !== documentHash;
    framedHashRef.current = documentHash;
    viewerRef.current?.setParts(result?.parts ?? [], { frame: shouldFrame });
  }, [result, documentHash]);

  const selectedPartIds = useMemo(() => {
    if (!project) return [];
    return selectedIds
      .map((id) => partIdForSelection(project.document.root, leaves, id))
      .filter((id): id is string => id !== null);
  }, [project, leaves, selectedIds]);

  useEffect(() => {
    viewerRef.current?.setSelectedParts(selectedPartIds);
  }, [selectedPartIds, result]);

  // The arrows straddle the selection's own height band; with nothing selected they disappear.
  const heightRange = useMemo(() => {
    if (!project || selectedIds.length === 0) return null;
    const ranges = selectedIds
      .map((id) =>
        effectiveSettingsFor(project.document.root, project.settings, project.global, id),
      )
      .filter((settings): settings is NonNullable<typeof settings> => settings !== null);
    if (ranges.length === 0) return null;
    return {
      top: Math.max(...ranges.map((settings) => settings.zTo)),
      bottom: Math.min(...ranges.map((settings) => settings.zFrom)),
    };
  }, [project, selectedIds]);

  useEffect(() => {
    viewerRef.current?.setHeightRange(heightRange);
  }, [heightRange, result]);

  // The arrows sit over the middle of the selected shape (a group uses the group's own bounds).
  const heightCenter = useMemo(() => {
    if (!project || selectedIds.length === 0) return null;
    const ids = new Set<string>();
    for (const id of selectedIds) {
      const node = findNode(project.document.root, id);
      if (node) for (const child of collectSubtreeIds(node)) ids.add(child);
    }
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const leaf of leaves) {
      if (!ids.has(leaf.id)) continue;
      const box = bboxOfContours(leaf.contours);
      if (!Number.isFinite(box.minX) || !Number.isFinite(box.minY)) continue;
      minX = Math.min(minX, box.minX);
      minY = Math.min(minY, box.minY);
      maxX = Math.max(maxX, box.maxX);
      maxY = Math.max(maxY, box.maxY);
    }
    if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null;
    return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
  }, [project, selectedIds, leaves]);

  useEffect(() => {
    viewerRef.current?.setHeightCenter(heightCenter);
  }, [heightCenter, result]);

  useEffect(() => {
    viewerRef.current?.setView({ material, lighting, projection });
  }, [material, lighting, projection]);

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" />
      <div ref={navCubeRef} className="absolute bottom-3 right-3 z-10 h-[96px] w-[96px]" />
    </div>
  );
}
