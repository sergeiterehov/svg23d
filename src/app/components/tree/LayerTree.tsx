import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import type { NodeSettings, SvgDocNode } from '@core/model/types';
import { effectiveSettingsFor } from '@core/solver/inheritance';
import { orderedChildren } from '@core/solver/order';
import { findNode } from '@core/solver/resolveLeaves';
import { findUnionOwner } from '@core/solver/selection';
import { useProjectStore } from '../../store/useProjectStore';
import { ColorChip } from '../common/Toggle';
import { EyeIcon, EyeOffIcon, FolderIcon, UnionIcon } from '../common/Icon';
import { IconButton } from '../common/IconButton';

/** Where a dragged row lands relative to the row under the pointer. */
type DropZone = 'before' | 'after' | 'inside';

export interface TreeDrag {
  /** Every row the drag carries (a multi-selection moves as one block). */
  ids: string[];
  over: { id: string; zone: DropZone } | null;
}

interface TreeUi {
  collapsed: Set<string>;
  toggle: (id: string) => void;
  editingId: string | null;
  startEditing: (id: string) => void;
  stopEditing: () => void;
  drag: TreeDrag | null;
  startDrag: (ids: string[]) => void;
  setOver: (over: TreeDrag['over']) => void;
  endDrag: () => void;
  rows: string[];
  rowIndex: Map<string, number>;
  /** Opens the row's context menu at viewport coordinates. */
  openMenu: (x: number, y: number, nodeId: string) => void;
}

/** Display order of the rows (top row = drawn last = cuts into everything below, ADR-0004). */
function flattenRows(
  node: SvgDocNode,
  settings: Record<string, NodeSettings>,
  collapsed: Set<string>,
  out: string[] = [],
): string[] {
  for (const child of [...orderedChildren(node, settings)].reverse()) {
    out.push(child.id);
    // A union expands like any group: its contents stay editable — drag a shape out of it, delete it
    // or add another one; only the object that reaches the solver is merged (ADR-0028).
    if (!collapsed.has(child.id)) flattenRows(child, settings, collapsed, out);
  }
  return out;
}

/** Shapes behind the given nodes, de-duplicated: how many objects a union would merge. */
function countShapes(root: SvgDocNode, ids: string[]): number {
  const seen = new Set<string>();
  const collect = (node: SvgDocNode): void => {
    if (node.kind === 'shape') seen.add(node.id);
    for (const child of node.children) collect(child);
  };
  for (const id of ids) {
    const node = findNode(root, id);
    if (node) collect(node);
  }
  return seen.size;
}

export function LayerTree() {
  const project = useProjectStore((s) => s.project);
  const moveNodes = useProjectStore((s) => s.moveNodes);
  // Collapsing lives above the rows so Shift-click can work on the rows that are actually visible.
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [drag, setDrag] = useState<TreeDrag | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; nodeId: string } | null>(null);
  /** Last row clicked without Shift: the range starts there. */
  const anchorRef = useRef<string | null>(null);
  const rows = useMemo(
    () => (project ? flattenRows(project.document.root, project.settings, collapsed) : []),
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
    startDrag: (ids) => setDrag({ ids, over: null }),
    setOver: (over) => setDrag((current) => (current ? { ...current, over } : current)),
    endDrag: () => setDrag(null),
    rows,
    rowIndex,
    openMenu: (x, y, nodeId) => {
      // Right-click on an unselected row selects it first, like every other tree in the world.
      const state = useProjectStore.getState();
      if (!state.selectedIds.includes(nodeId)) state.select(nodeId);
      anchorRef.current = nodeId;
      setMenu({ x, y, nodeId });
    },
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
          onDrop={moveNodes}
        />
      ))}
      {menu && (
        <TreeContextMenu
          x={menu.x}
          y={menu.y}
          nodeId={menu.nodeId}
          onClose={() => setMenu(null)}
          onRename={() => {
            ui.startEditing(menu.nodeId);
            setMenu(null);
          }}
        />
      )}
    </div>
  );
}

/** Right-click menu of the tree: grouping, renaming and deleting live here, not in the tools menu. */
function TreeContextMenu({
  x,
  y,
  nodeId,
  onClose,
  onRename,
}: {
  x: number;
  y: number;
  nodeId: string;
  onClose: () => void;
  onRename: () => void;
}) {
  const groupSelected = useProjectStore((s) => s.groupSelected);
  const unionSelected = useProjectStore((s) => s.unionSelected);
  const ununionSelected = useProjectStore((s) => s.ununionSelected);
  const removeSelected = useProjectStore((s) => s.removeSelected);
  const selectedIds = useProjectStore((s) => s.selectedIds);
  const project = useProjectStore((s) => s.project);
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: x, top: y });

  // Measured first, then clamped to the viewport so the menu is never cut off at an edge.
  useLayoutEffect(() => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    setPosition({
      left: Math.min(x, window.innerWidth - rect.width - 8),
      top: Math.min(y, window.innerHeight - rect.height - 8),
    });
  }, [x, y]);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent): void => {
      if (!ref.current?.contains(event.target as Node)) onClose();
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', onClose);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose]);

  const item =
    'flex w-full items-center justify-between gap-6 px-3 py-1.5 text-left text-xs transition';
  const count = selectedIds.length;
  // A union needs at least two shapes; a single group of shapes can be merged in place.
  const shapes = project ? countShapes(project.document.root, selectedIds) : 0;
  const unionId =
    selectedIds.length === 1 && project?.tree.unions.includes(selectedIds[0])
      ? selectedIds[0]
      : null;

  return (
    <div
      ref={ref}
      role="menu"
      className="fixed z-50 w-56 overflow-hidden rounded-md border border-slate-700 bg-slate-900 py-1 shadow-xl"
      style={{ left: position.left, top: position.top }}
      data-node-menu={nodeId}
    >
      <button
        type="button"
        role="menuitem"
        disabled={count === 0}
        onClick={() => {
          groupSelected();
          onClose();
        }}
        className={clsx(
          item,
          count === 0
            ? 'cursor-not-allowed text-slate-600'
            : 'text-slate-200 hover:bg-slate-800 hover:text-white',
        )}
      >
        <span>Сгруппировать{count > 1 ? ` (${count})` : ''}</span>
        <span className="text-[10px] text-slate-500">⌘G</span>
      </button>
      <button
        type="button"
        role="menuitem"
        disabled={shapes < 2}
        title={
          shapes < 2
            ? 'Нужно минимум две фигуры'
            : 'Одна печатная деталь: настройки частей не учитываются'
        }
        onClick={() => {
          unionSelected();
          onClose();
        }}
        className={clsx(
          item,
          shapes < 2
            ? 'cursor-not-allowed text-slate-600'
            : 'text-slate-200 hover:bg-slate-800 hover:text-white',
        )}
      >
        <span>Объединить</span>
        <span className="text-[10px] text-slate-500">⌥⇧U</span>
      </button>
      {unionId && (
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            ununionSelected();
            onClose();
          }}
          className={clsx(item, 'text-slate-200 hover:bg-slate-800 hover:text-white')}
        >
          <span>Разъединить</span>
          <span className="text-[10px] text-slate-500">вернуть части</span>
        </button>
      )}
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          onRename();
        }}
        className={clsx(item, 'text-slate-200 hover:bg-slate-800 hover:text-white')}
      >
        <span>Переименовать</span>
        <span className="text-[10px] text-slate-500">двойной клик</span>
      </button>
      <div className="my-1 border-t border-slate-800" />
      <button
        type="button"
        role="menuitem"
        disabled={count === 0}
        onClick={() => {
          removeSelected();
          onClose();
        }}
        className={clsx(
          item,
          count === 0
            ? 'cursor-not-allowed text-slate-600'
            : 'text-rose-300 hover:bg-rose-500/15 hover:text-rose-200',
        )}
      >
        <span>Удалить{count > 1 ? ` (${count})` : ''}</span>
        <span className="text-[10px] text-slate-500">⌫</span>
      </button>
    </div>
  );
}

interface TreeRowProps {
  node: SvgDocNode;
  depth: number;
  ui: TreeUi;
  /** Row that started a Shift-click range (a ref, so the rows do not re-render). */
  anchorRef: { current: string | null };
  onDrop: (nodeIds: string[], targetId: string, position: DropZone) => void;
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
  // A part of a union has no heights of its own and no meaningful range: the body is the union's.
  const unionPart = node.union !== true && findUnionOwner(project.document.root, node.id) !== null;
  const range = unionPart ? null : effective;
  const isSelected = selectedIds.includes(node.id);
  const isHovered = hoveredId === node.id;
  const isHidden = effective?.hidden === true;
  /** Hidden by this node itself (a group hiding its subtree cannot be undone from a child). */
  const ownHidden = project.settings[node.id]?.hidden === true;
  const hiddenByGroup = isHidden && !ownHidden;
  const isGroup = node.kind === 'group';
  const hasChildren = node.children.length > 0;
  const unionColor =
    project.settings[node.id]?.colorOverride ?? (node.fill === 'none' ? undefined : node.fill);
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
          ui.drag?.ids.includes(node.id) && 'opacity-50',
        )}
        style={{ paddingLeft: 8 + depth * 12 }}
        data-node-row={node.id}
        draggable={!editing}
        onDragStart={(event) => {
          event.dataTransfer.effectAllowed = 'move';
          event.dataTransfer.setData('text/plain', node.id);
          // Dragging a selected row carries the whole selection; dragging any other row a single one.
          const ids = isSelected && selectedIds.length > 1 ? selectedIds : [node.id];
          ui.startDrag(ids);
        }}
        onDragOver={(event) => {
          if (!ui.drag || ui.drag.ids.includes(node.id)) return;
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
          const dragged = ui.drag?.ids ?? [];
          const zone = zoneAt(event);
          ui.endDrag();
          if (dragged.length === 0 || dragged.includes(node.id)) return;
          onDrop(dragged, node.id, zone);
        }}
        onClick={handleClick}
        onDoubleClick={() => ui.startEditing(node.id)}
        onContextMenu={(event) => {
          event.preventDefault();
          ui.openMenu(event.clientX, event.clientY, node.id);
        }}
        onMouseEnter={() => hover(node.id)}
        onMouseLeave={() => hover(null)}
        title={node.union ? `объединение · ${node.id}` : `${node.tag} · ${node.id}`}
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

        {node.union ? (
          // Merged body: the icon carries the object's colour, the shape says "not just a container".
          <span
            className="grid shrink-0 place-items-center text-slate-400"
            style={unionColor ? { color: unionColor } : undefined}
            title="Объединение"
          >
            <UnionIcon className="h-3.5 w-3.5" />
          </span>
        ) : isGroup ? (
          // Groups have no colour of their own: the folder says "this is a container".
          <FolderIcon className="h-3.5 w-3.5 text-slate-400" />
        ) : (
          <ColorChip color={project.settings[node.id]?.colorOverride ?? node.fill} />
        )}

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
          {range ? `${round(range.zFrom)}–${round(range.zTo)}` : ''}
        </span>

        <IconButton
          label={hiddenByGroup ? 'Скрыто группой' : isHidden ? 'Показать' : 'Скрыть'}
          stopPropagation
          disabled={hiddenByGroup}
          onClick={() => updateSettings(node.id, { hidden: isHidden ? undefined : true })}
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
