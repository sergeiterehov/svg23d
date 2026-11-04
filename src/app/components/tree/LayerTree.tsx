import { useState } from 'react';
import clsx from 'clsx';
import type { SvgDocNode } from '@core/model/types';
import { effectiveSettingsFor } from '@core/solver/inheritance';
import { orderedChildren } from '@core/solver/order';
import { useProjectStore } from '../../store/useProjectStore';
import { ColorChip } from '../common/Toggle';
import { ChevronDownIcon, ChevronUpIcon, EyeIcon, EyeOffIcon } from '../common/Icon';

export function LayerTree() {
  const project = useProjectStore((s) => s.project);
  if (!project) return null;

  // First row = drawn last = cuts into everything below (ADR-0004).
  const roots = [...orderedChildren(project.document.root, project.settings)].reverse();

  return (
    <div className="py-1">
      {roots.map((child) => (
        <TreeRow key={child.id} node={child} depth={0} />
      ))}
    </div>
  );
}

function TreeRow({ node, depth }: { node: SvgDocNode; depth: number }) {
  const project = useProjectStore((s) => s.project);
  const selectedId = useProjectStore((s) => s.selectedId);
  const select = useProjectStore((s) => s.select);
  const hover = useProjectStore((s) => s.hover);
  const updateSettings = useProjectStore((s) => s.updateSettings);
  const shiftNode = useProjectStore((s) => s.shiftNode);
  const [expanded, setExpanded] = useState(true);

  if (!project) return null;

  const effective = effectiveSettingsFor(
    project.document.root,
    project.settings,
    project.global,
    node.id,
  );
  const isSelected = selectedId === node.id;
  const hasChildren = node.children.length > 0;
  const isPart = project.settings[node.id]?.isPart === true;
  const children = [...orderedChildren(node, project.settings)].reverse();

  return (
    <div>
      <div
        className={clsx(
          'group flex cursor-pointer items-center gap-1.5 py-1 pr-1.5 text-xs transition',
          isSelected ? 'bg-sky-500/20 text-sky-100' : 'text-slate-300 hover:bg-slate-800/70',
        )}
        style={{ paddingLeft: 8 + depth * 12 }}
        data-node-row={node.id}
        onClick={() => select(node.id)}
        onMouseEnter={() => hover(node.id)}
        onMouseLeave={() => hover(null)}
        title={`${node.tag} · ${node.id}`}
      >
        <button
          type="button"
          className={clsx('w-3 shrink-0 text-slate-500', !hasChildren && 'invisible')}
          onClick={(event) => {
            event.stopPropagation();
            setExpanded((value) => !value);
          }}
        >
          {expanded ? '▾' : '▸'}
        </button>

        <ColorChip color={node.fill} />

        <span className={clsx('truncate', node.kind === 'group' && 'font-medium')}>{node.name}</span>

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
            title="Выше в порядке вырезания"
            onClick={() => shiftNode(node.id, 1)}
          >
            <ChevronUpIcon className="h-3 w-3" />
          </IconButton>
          <IconButton title="Ниже в порядке вырезания" onClick={() => shiftNode(node.id, -1)}>
            <ChevronDownIcon className="h-3 w-3" />
          </IconButton>
        </span>

        <IconButton
          title={effective?.hidden ? 'Показать' : 'Скрыть'}
          persistent={effective?.hidden === true}
          onClick={() => updateSettings(node.id, { hidden: !effective?.hidden })}
        >
          {effective?.hidden ? <EyeOffIcon className="h-3.5 w-3.5" /> : <EyeIcon className="h-3.5 w-3.5" />}
        </IconButton>
      </div>

      {expanded &&
        children.map((child) => <TreeRow key={child.id} node={child} depth={depth + 1} />)}
    </div>
  );
}

function IconButton({
  title,
  onClick,
  children,
  persistent,
}: {
  title: string;
  onClick: () => void;
  children: React.ReactNode;
  persistent?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      className={clsx(
        'grid h-4 w-4 place-items-center rounded text-slate-500 hover:bg-slate-700/70 hover:text-slate-100',
        !persistent && 'opacity-0 group-hover:opacity-100',
      )}
    >
      {children}
    </button>
  );
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}
