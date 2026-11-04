import type { NodeSettings, SvgDocNode } from '@core/model/types';
import { useProjectStore } from '../../store/useProjectStore';
import { contoursToPathData } from '@core/svg/preview';
import { findNode } from '@core/solver/resolveLeaves';
import { orderedChildren } from '@core/solver/order';
import { HEIGHT_GRADIENT_CSS, heightColor } from './colorScale';

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
 * 2D preview rendered from the *computed* contours, not from the original markup, with SVG masks
 * taken from the same include/exclude coverage the solver uses — so the preview matches the 3D result.
 */
export function Preview2D() {
  const project = useProjectStore((s) => s.project);
  const selectedIds = useProjectStore((s) => s.selectedIds);
  const hoveredId = useProjectStore((s) => s.hoveredId);
  const select = useProjectStore((s) => s.select);
  const hover = useProjectStore((s) => s.hover);
  const leaves = useProjectStore((s) => s.leaves);
  const mode = useProjectStore((s) => s.project?.global.view.mode2d ?? 'transparent');

  if (!project) {
    return <div className="h-full w-full" />;
  }

  const { viewBox, root } = project.document;
  const width = Math.max(viewBox.maxX - viewBox.minX, 1e-6);
  const height = Math.max(viewBox.maxY - viewBox.minY, 1e-6);
  const shapes = collectShapes(root, project.settings);

  const selectedShapes = new Set<string>();
  for (const id of selectedIds) {
    const node = findNode(root, id);
    if (node) for (const child of collectSubtreeIds(node)) selectedShapes.add(child);
  }
  // Hovering a group in the tree lights up the whole subtree, so the same white trace is used for both.
  const hoveredShapes = new Set<string>();
  if (hoveredId) {
    const node = findNode(root, hoveredId);
    if (node) for (const child of collectSubtreeIds(node)) hoveredShapes.add(child);
  }

  const unit = Math.max(width, height);
  const strokeNormal = unit / 900;
  const strokeActive = unit / 260;

  // Height map: colour by the top face of every element.
  const heightById = new Map(leaves.map((leaf) => [leaf.id, leaf.zTo]));
  const heights = leaves.map((leaf) => leaf.zTo);
  const minHeight = heights.length > 0 ? Math.min(...heights) : 0;
  const maxHeight = heights.length > 0 ? Math.max(...heights) : 1;
  const heightSpan = Math.max(maxHeight - minHeight, 1e-6);

  const fillFor = (node: SvgDocNode): string => {
    if (mode !== 'heightmap') return node.fill === 'none' ? '#000000' : node.fill;
    const top = heightById.get(node.id);
    if (top === undefined) return '#94a3b8';
    // A model where every element has the same height is "all max".
    return heightColor(heightSpan < 1e-6 ? 1 : (top - minHeight) / heightSpan);
  };

  const maskId = (index: number): string => `svg23d-mask-${index}`;
  const indexed = shapes.map((node, index) => ({ node, index }));

  return (
    <div
      className="relative h-full w-full overflow-hidden bg-slate-800"
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
        <defs>
          {indexed.map(({ node, index }) =>
            node.maskInclude && node.maskInclude.length > 0 ? (
              <mask
                key={node.id}
                id={maskId(index)}
                maskUnits="userSpaceOnUse"
                x={viewBox.minX}
                y={viewBox.minY}
                width={width}
                height={height}
              >
                <path d={contoursToPathData(node.maskInclude)} fill="#ffffff" fillRule="nonzero" />
                {node.maskExclude && node.maskExclude.length > 0 && (
                  <path
                    d={contoursToPathData(node.maskExclude)}
                    fill="#000000"
                    fillRule="nonzero"
                  />
                )}
              </mask>
            ) : null,
          )}
        </defs>

        {indexed.map(({ node, index }) => {
          const selected = selectedShapes.has(node.id);
          const hovered = hoveredShapes.has(node.id);
          // Stroke outlines are built from many overlapping polygons (discs, quads); outlining each
          // of them would show the construction, so only simple shapes get a contour.
          const simple = node.subpaths.length <= 8;
          const opacity = node.hidden
            ? 0.12
            : mode === 'transparent'
              ? selected || hovered
                ? 0.95
                : 0.8
              : 1;
          const masked = node.maskInclude && node.maskInclude.length > 0;
          // Selection is sky-blue, hover is white: two different states, never the same colour.
          const stroke = !simple
            ? 'none'
            : selected
              ? '#38bdf8'
              : hovered
                ? '#f8fafc'
                : 'rgba(148, 163, 184, 0.45)';

          return (
            <path
              key={node.id}
              d={contoursToPathData(node.subpaths)}
              fill={fillFor(node)}
              fillRule={node.fillRule}
              mask={masked ? `url(#${maskId(index)})` : undefined}
              opacity={opacity}
              stroke={stroke}
              strokeWidth={selected || hovered ? strokeActive : strokeNormal}
              strokeLinejoin="round"
              className="cursor-pointer transition-opacity"
              onMouseEnter={() => hover(node.id)}
              onClick={() => select(node.id)}
            />
          );
        })}
      </svg>

      {mode === 'heightmap' && (
        <div className="pointer-events-none absolute bottom-3 left-3 rounded-md border border-slate-600/70 bg-slate-900/85 px-2 py-1.5">
          <div className="h-1.5 w-32 rounded-full" style={{ background: HEIGHT_GRADIENT_CSS }} />
          <div className="mt-1 flex justify-between text-[10px] tabular-nums text-slate-300">
            <span>{round(minHeight)} мм</span>
            <span>{round(maxHeight)} мм</span>
          </div>
        </div>
      )}
    </div>
  );
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}
