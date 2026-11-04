import { useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import type { SvgDocNode } from '@core/model/types';
import { effectiveSettingsFor } from '@core/solver/inheritance';
import { orderedChildren } from '@core/solver/order';
import { useProjectStore } from '../../store/useProjectStore';
import { ColorChip } from '../common/Toggle';
import { EyeIcon, EyeOffIcon } from '../common/Icon';
import { IconButton } from '../common/IconButton';

/** Where a dragged row lands relative to the row under the pointer. */
type DropZone = 'before' | 'after' | 'inside';

export interface TreeDrag {
  id: string;
  over: { id: string; zone: DropZone } | null;
}

interface TreeUi {
  collapsed: Set<string>;
  toggle: (id: string) => void;
  editingId: string | null;
  startEditing: (id: string) => void;
  stopEditing: () => void;
  drag: TreeDrag | null;
  startDrag: (id: string) => void;
  setOver: (over: TreeDrag['over']) => void;
  endDrag: () => void;
  rows: string[];
  rowIndex: Map<string, number>;
}

/** Display order of the rows (top row = drawn last = cuts into everything below, ADR-0004). */
function flattenRows(node: SvgDocNode, collapsed: Set<string>, out: string[] = []): string[] {
  for (const child of [...node.children].reverse()) {
    out.push(child.id);
    if (!collapsed.has(child.id)) flattenRows(child, collapsed, out);
  }
  return out;
}

export function LayerTree() {
  const project = useProjectStore((s) => s.project);
  const moveNode = useProjectStore((s) => s.moveNode);
  // Collapsing lives above the rows so Shift-click can work on the rows that are actually visible.
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [drag, setDrag] = useState<TreeDrag | null>(null);
  /** Last row clicked without Shift: the range starts there. */
  const anchorRef = useRef<string | null>(null);
  const rows = useMemo(
    () => (project ? flattenRows(project.document.root, collapsed) : []),
    [project, collapsed],
  );
  const rowIndex = useMemo(() => new Map(rows.map((id, index) => [id, index])), [rows]);

  if (!project) return null;

  const ui: TreeUi = {
    collapsed,
    toggle: (id) =>
      setCollapsed((current) => {
        const next = new Set(current);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }),
    editingId,
    startEditing: setEditingId,
    stopEditing: () => setEditingId(null),
    drag,
    startDrag: (id) => setDrag({ id, over: null }),
    setOver: (over) => setDrag((current) => (current ? { ...current, over } : current)),
    endDrag: () => setDrag(null),
    rows,
    rowIndex,
  };

  return (
    <div className="py-1" onDragEnd={ui.endDrag}>
      {[...orderedChildren(project.document.root, project.settings)].reverse().map((child) => (
        <TreeRow
          key={child.id}
          node={child}
          depth={0}
          ui={ui}
          anchorRef={anchorRef}
          onDrop={moveNode}
        />
      ))}
    </div>
  );
}

interface TreeRowProps {
  node: SvgDocNode;
  depth: number;
  ui: TreeUi;
  /** Row that started a Shift-click range (a ref, so the rows do not re-render). */
  anchorRef: { current: string | null };
  onDrop: (nodeId: string, targetId: string, position: DropZone) => void;
}

function TreeRow({ node, depth, ui, anchorRef, onDrop }: TreeRowProps) {
  const project = useProjectStore((s) => s.project);
  const selectedIds = useProjectStore((s) => s.selectedIds);
  const hoveredId = useProjectStore((s) => s.hoveredId);
  const select = useProjectStore((s) => s.select);
  const selectMany = useProjectStore((s) => s.selectMany);
  const toggleSelected = useProjectStore((s) => s.toggleSelected);
  const hover = useProjectStore((s) => s.hover);
  const updateSettings = useProjectStore((s) => s.updateSettings);
  const renameNode = useProjectStore((s) => s.renameNode);

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
  const isGroup = node.kind === 'group';
  const hasChildren = node.children.length > 0;
  const isPart = project.settings[node.id]?.isPart === true;
  const expanded = hasChildren && !ui.collapsed.has(node.id);
  const children = [...orderedChildren(node, project.settings)].reverse();
  const editing = ui.editingId === node.id;
  const dragOver = ui.drag?.over?.id === node.id ? ui.drag.over.zone : null;

  const handleClick = (event: React.MouseEvent): void => {
    if (editing) return;
    const anchorId = anchorRef.current;
    if (event.shiftKey && anchorId !== null) {
      const from = ui.rowIndex.get(anchorId);
      const to = ui.rowIndex.get(node.id);
      if (from !== undefined && to !== undefined) {
        const [start, end] = from <= to ? [from, to] : [to, from];
        selectMany(ui.rows.slice(start, end + 1));
        return;
      }
    }
    // ⌘/Ctrl-click extends the selection instead of replacing it.
    if (event.metaKey || event.ctrlKey) toggleSelected(node.id);
    else select(node.id);
    anchorRef.current = node.id;
  };

  const zoneAt = (event: React.DragEvent<HTMLDivElement>): DropZone => {
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientY - rect.top) / Math.max(rect.height, 1);
    // Rows are drawn top-down while the paint order goes bottom-up: the upper half of a row means
    // "above it in the picture", which is later in the paint order.
    if (ratio < 0.3) return 'after';
    if (ratio > 0.7) return 'before';
    return isGroup ? 'inside' : 'after';
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
          dragOver === 'inside' && 'ring-1 ring-inset ring-sky-400',
          dragOver === 'after' && 'shadow-[inset_0_2px_0_0_#38bdf8]',
          dragOver === 'before' && 'shadow-[inset_0_-2px_0_0_#38bdf8]',
          ui.drag?.id === node.id && 'opacity-50',
        )}
        style={{ paddingLeft: 8 + depth * 12 }}
        data-node-row={node.id}
        draggable={!editing}
        onDragStart={(event) => {
          event.dataTransfer.effectAllowed = 'move';
          event.dataTransfer.setData('text/plain', node.id);
          ui.startDrag(node.id);
        }}
        onDragOver={(event) => {
          if (!ui.drag || ui.drag.id === node.id) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = 'move';
          const zone = zoneAt(event);
          if (ui.drag.over?.id !== node.id || ui.drag.over.zone !== zone) {
            ui.setOver({ id: node.id, zone });
          }
        }}
        onDragLeave={() => {
          if (ui.drag?.over?.id === node.id) ui.setOver(null);
        }}
        onDrop={(event) => {
          event.preventDefault();
          const dragged = ui.drag?.id;
          const zone = zoneAt(event);
          ui.endDrag();
          if (!dragged || dragged === node.id) return;
          onDrop(dragged, node.id, zone);
        }}
        onClick={handleClick}
        onDoubleClick={() => ui.startEditing(node.id)}
        onMouseEnter={() => hover(node.id)}
        onMouseLeave={() => hover(null)}
        title={`${node.tag} · ${node.id}`}
      >
        <button
          type="button"
          className={clsx('w-3 shrink-0 text-slate-500', !hasChildren && 'invisible')}
          onClick={(event) => {
            event.stopPropagation();
            ui.toggle(node.id);
          }}
        >
          {expanded ? '▾' : '▸'}
        </button>

        <ColorChip color={project.settings[node.id]?.colorOverride ?? node.fill} />

        {editing ? (
          <input
            autoFocus
            defaultValue={node.name}
            aria-label="Имя элемента"
            className="min-w-0 flex-1 rounded border border-sky-500 bg-slate-950 px-1 py-0 text-xs text-white outline-none"
            onClick={(event) => event.stopPropagation()}
            onBlur={(event) => {
              renameNode(node.id, event.target.value);
              ui.stopEditing();
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                renameNode(node.id, event.currentTarget.value);
                ui.stopEditing();
              } else if (event.key === 'Escape') {
                ui.stopEditing();
              }
            }}
          />
        ) : (
          <span className={clsx('truncate', isGroup && 'font-medium')}>{node.name}</span>
        )}

        {isPart && (
          <span className="rounded bg-emerald-500/15 px-1 text-[9px] uppercase tracking-wide text-emerald-300">
            деталь
          </span>
        )}

        <span className="ml-auto shrink-0 text-[10px] tabular-nums text-slate-500">
          {effective ? `${round(effective.zFrom)}–${round(effective.zTo)}` : ''}
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
            ui={ui}
            anchorRef={anchorRef}
            onDrop={onDrop}
          />
        ))}
    </div>
  );
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}
