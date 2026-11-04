import { useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import type { SvgDocNode } from '@core/model/types';
import { effectiveSettingsFor } from '@core/solver/inheritance';
import { orderedChildren } from '@core/solver/order';
import { useProjectStore } from '../../store/useProjectStore';
import { ColorChip } from '../common/Toggle';
import { ChevronDownIcon, ChevronUpIcon, EyeIcon, EyeOffIcon } from '../common/Icon';
import { IconButton } from '../common/IconButton';

/** Display order of the rows (top row = drawn last = cuts into everything below, ADR-0004). */
function flattenRows(
  node: SvgDocNode,
  settings: Record<string, unknown>,
  collapsed: Set<string>,
  out: string[] = [],
): string[] {
  for (const child of [...orderedChildren(node, settings as never)].reverse()) {
    out.push(child.id);
    if (!collapsed.has(child.id)) flattenRows(child, settings, collapsed, out);
  }
  return out;
}

export function LayerTree() {
  const project = useProjectStore((s) => s.project);
  // Collapsing lives above the rows so Shift-click can work on the rows that are actually visible.
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  /** Last row clicked without Shift: the range starts there. */
  const anchorRef = useRef<string | null>(null);
  const rows = useMemo(
    () => (project ? flattenRows(project.document.root, project.settings, collapsed) : []),
    [project, collapsed],
  );
  const rowIndex = useMemo(() => new Map(rows.map((id, index) => [id, index])), [rows]);

  if (!project) return null;

  return (
    <div className="py-1">
      {[...orderedChildren(project.document.root, project.settings)].reverse().map((child) => (
        <TreeRow
          key={child.id}
          node={child}
          depth={0}
          collapsed={collapsed}
          onToggle={(id) =>
            setCollapsed((current) => {
              const next = new Set(current);
              if (next.has(id)) next.delete(id);
              else next.add(id);
              return next;
            })
          }
          rows={rows}
          rowIndex={rowIndex}
          anchorRef={anchorRef}
        />
      ))}
    </div>
  );
}

interface TreeRowProps {
  node: SvgDocNode;
  depth: number;
  collapsed: Set<string>;
  onToggle: (id: string) => void;
  /** Visible rows in display order, for Shift-click ranges. */
  rows: string[];
  rowIndex: Map<string, number>;
  anchorRef: { current: string | null };
}

function TreeRow({ node, depth, collapsed, onToggle, rows, rowIndex, anchorRef }: TreeRowProps) {
  const project = useProjectStore((s) => s.project);
  const selectedIds = useProjectStore((s) => s.selectedIds);
  const hoveredId = useProjectStore((s) => s.hoveredId);
  const select = useProjectStore((s) => s.select);
  const selectMany = useProjectStore((s) => s.selectMany);
  const toggleSelected = useProjectStore((s) => s.toggleSelected);
  const hover = useProjectStore((s) => s.hover);
  const updateSettings = useProjectStore((s) => s.updateSettings);
  const shiftNode = useProjectStore((s) => s.shiftNode);

  if (!project) return null;

  const effective = effectiveSettingsFor(
    project.document.root,
    project.settings,
    project.global,
    node.id,
  );
  const isSelected = selectedIds.includes(node.id);
  const isHovered = hoveredId === node.id;
  const isHidden = effective?.hidden === true;
  const hasChildren = node.children.length > 0;
  const isPart = project.settings[node.id]?.isPart === true;
  const expanded = hasChildren && !collapsed.has(node.id);
  const children = [...orderedChildren(node, project.settings)].reverse();

  const handleClick = (event: React.MouseEvent): void => {
    const anchor = anchorRef.current;
    if (event.shiftKey && anchor !== null) {
      const from = rowIndex.get(anchor);
      const to = rowIndex.get(node.id);
      if (from !== undefined && to !== undefined) {
        const [start, end] = from <= to ? [from, to] : [to, from];
        selectMany(rows.slice(start, end + 1));
        return;
      }
    }
    // ⌘/Ctrl-click extends the selection instead of replacing it.
    if (event.metaKey || event.ctrlKey) toggleSelected(node.id);
    else select(node.id);
    anchorRef.current = node.id;
  };

  return (
    <div>
      <div
        className={clsx(
          'group flex cursor-pointer select-none items-center gap-1.5 py-1 pr-1.5 text-xs transition',
          isSelected
            ? 'bg-sky-500/20 text-sky-100'
            : isHovered
              ? 'bg-white/10 text-white'
              : 'text-slate-300 hover:bg-slate-800/70',
          isHidden && (isSelected || isHovered ? 'opacity-70' : 'opacity-45'),
        )}
        style={{ paddingLeft: 8 + depth * 12 }}
        data-node-row={node.id}
        onClick={handleClick}
        onMouseEnter={() => hover(node.id)}
        onMouseLeave={() => hover(null)}
        title={`${node.tag} · ${node.id}`}
      >
        <button
          type="button"
          className={clsx('w-3 shrink-0 text-slate-500', !hasChildren && 'invisible')}
          onClick={(event) => {
            event.stopPropagation();
            onToggle(node.id);
          }}
        >
          {expanded ? '▾' : '▸'}
        </button>

        <ColorChip color={project.settings[node.id]?.colorOverride ?? node.fill} />

        <span className={clsx('truncate', node.kind === 'group' && 'font-medium')}>
          {node.name}
        </span>

        {isPart && (
          <span className="rounded bg-emerald-500/15 px-1 text-[9px] uppercase tracking-wide text-emerald-300">
            деталь
          </span>
        )}

        <span className="ml-auto shrink-0 text-[10px] tabular-nums text-slate-500">
          {effective ? `${round(effective.zFrom)}–${round(effective.zTo)}` : ''}
        </span>

        <span className="flex shrink-0 items-center opacity-0 transition group-hover:opacity-100">
          <IconButton
            label="Выше в порядке вырезания"
            stopPropagation
            onClick={() => shiftNode(node.id, 1)}
            className="h-4 w-4 text-slate-500 hover:bg-slate-700/70 hover:text-slate-100"
          >
            <ChevronUpIcon className="h-3 w-3" />
          </IconButton>
          <IconButton
            label="Ниже в порядке вырезания"
            stopPropagation
            onClick={() => shiftNode(node.id, -1)}
            className="h-4 w-4 text-slate-500 hover:bg-slate-700/70 hover:text-slate-100"
          >
            <ChevronDownIcon className="h-3 w-3" />
          </IconButton>
        </span>

        <IconButton
          label={isHidden ? 'Показать' : 'Скрыть'}
          stopPropagation
          onClick={() => updateSettings(node.id, { hidden: !isHidden })}
          className={clsx(
            'h-4 w-4 text-slate-500 hover:bg-slate-700/70 hover:text-slate-100',
            !isHidden && 'opacity-0 group-hover:opacity-100',
          )}
        >
          {isHidden ? <EyeOffIcon className="h-3.5 w-3.5" /> : <EyeIcon className="h-3.5 w-3.5" />}
        </IconButton>
      </div>

      {expanded &&
        children.map((child) => (
          <TreeRow
            key={child.id}
            node={child}
            depth={depth + 1}
            collapsed={collapsed}
            onToggle={onToggle}
            rows={rows}
            rowIndex={rowIndex}
            anchorRef={anchorRef}
          />
        ))}
    </div>
  );
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}
