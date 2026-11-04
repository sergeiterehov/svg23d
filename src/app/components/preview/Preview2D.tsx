import type { SvgDocNode, NodeSettings } from '@core/model/types';
import { useProjectStore } from '../../store/useProjectStore';
import { contoursToPathData } from '@core/svg/preview';
import { findNode } from '@core/solver/resolveLeaves';
import { orderedChildren } from '@core/solver/order';

function collectShapes(
  node: SvgDocNode,
  settings: Record<string, NodeSettings>,
  out: SvgDocNode[] = [],
): SvgDocNode[] {
  if (node.kind === 'shape') out.push(node);
  for (const child of orderedChildren(node, settings)) collectShapes(child, settings, out);
  return out;
}

function collectSubtreeIds(node: SvgDocNode, out: Set<string> = new Set()): Set<string> {
  out.add(node.id);
  for (const child of node.children) collectSubtreeIds(child, out);
  return out;
}

/**
 * 2D preview rendered from the *computed* contours, not from the original markup:
 * what you see is exactly what will be extruded.
 */
export function Preview2D() {
  const project = useProjectStore((s) => s.project);
  const selectedId = useProjectStore((s) => s.selectedId);
  const hoveredId = useProjectStore((s) => s.hoveredId);
  const select = useProjectStore((s) => s.select);
  const hover = useProjectStore((s) => s.hover);

  if (!project) {
    return <div className="grid h-full place-items-center text-sm text-slate-500">Нет модели</div>;
  }

  const { viewBox, root } = project.document;
  const width = Math.max(viewBox.maxX - viewBox.minX, 1e-6);
  const height = Math.max(viewBox.maxY - viewBox.minY, 1e-6);
  const shapes = collectShapes(root, project.settings);

  const selectedNode = selectedId ? findNode(root, selectedId) : null;
  const highlighted = selectedNode ? collectSubtreeIds(selectedNode) : new Set<string>();
  if (hoveredId) highlighted.add(hoveredId);

  const unit = Math.max(width, height);
  const strokeNormal = unit / 900;
  const strokeActive = unit / 260;

  return (
    <div
      className="h-full w-full overflow-hidden bg-[#f8fafc]"
      onClick={(event) => {
        // Empty space around the artwork → deselect and show project settings.
        if (!(event.target as Element).closest('path')) select(null);
      }}
    >
      <svg
        viewBox={`${viewBox.minX} ${viewBox.minY} ${width} ${height}`}
        preserveAspectRatio="xMidYMid meet"
        className="h-full w-full"
        onMouseLeave={() => hover(null)}
      >
        {shapes.map((node) => {
          const active = highlighted.has(node.id);
          // Stroke outlines are built from many overlapping polygons (discs, quads); outlining each
          // of them would show the construction, so only simple shapes get a contour.
          const simple = node.subpaths.length <= 8;
          return (
            <path
              key={node.id}
              d={contoursToPathData(node.subpaths)}
              fill={node.fill === 'none' ? '#000000' : node.fill}
              fillRule={node.fillRule}
              opacity={node.hidden ? 0.12 : active ? 0.95 : 0.8}
              stroke={active && simple ? '#0ea5e9' : simple ? '#0f172a' : 'none'}
              strokeWidth={active ? strokeActive : strokeNormal}
              strokeLinejoin="round"
              className="cursor-pointer transition-opacity"
              onMouseEnter={() => hover(node.id)}
              onClick={() => select(node.id)}
            />
          );
        })}
      </svg>
    </div>
  );
}
