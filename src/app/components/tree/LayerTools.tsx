import { useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import { useProjectStore } from '../../store/useProjectStore';
import { LayersIcon, PaletteIcon, ToolsIcon } from '../common/Icon';
import { IconButton } from '../common/IconButton';
import { paletteUsage } from '@core/color/palette';
import { DistributeDialog, PaletteDialog } from './LayerToolDialogs';

/** Which tool dialog is open (the menu itself only lists the tools). */
type OpenDialog = 'distribute' | 'palette' | null;

/**
 * Tools menu of the layers panel. It lives in the panel header because its actions operate on the
 * whole stack of parts, not on the selected element or the project settings (ADR-0033).
 *
 * The menu is a list of tools only — icon, name, one line about the tool. A tool with settings asks
 * for them in a dialog first: fields inside a dropdown turn the menu into a form and make "apply"
 * indistinguishable from "open".
 */
export function LayerTools() {
  const leaves = useProjectStore((s) => s.leaves);
  const [open, setOpen] = useState(false);
  const [dialog, setDialog] = useState<OpenDialog>(null);
  /** Viewport coordinates of the menu once it has been measured (it is `fixed`, so nothing clips it). */
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  /**
   * The menu hangs off a panel header as `fixed`, and its own rect is measured once it is in the
   * DOM: the place is then clamped to the viewport, so the list is never cut by a screen edge or by
   * the panel's scroll area. A ref callback instead of an effect — the measurement is part of the
   * commit, not a reaction to state.
   */
  const measure = (node: HTMLDivElement | null): void => {
    if (!node) return;
    const anchor = containerRef.current?.getBoundingClientRect();
    if (!anchor) return;
    const rect = node.getBoundingClientRect();
    const gap = 8;
    const left = Math.min(
      Math.max(gap, anchor.right - rect.width),
      Math.max(gap, window.innerWidth - rect.width - gap),
    );
    const top = Math.min(
      Math.max(gap, anchor.bottom + 4),
      Math.max(gap, window.innerHeight - rect.height - gap),
    );
    setPosition((current) =>
      current && current.left === left && current.top === top ? current : { left, top },
    );
  };

  // Distinct colours of the model; the tool only offers to reduce a palette that is bigger.
  const colorCount = useMemo(() => paletteUsage(leaves).length, [leaves]);
  const isEmpty = leaves.length === 0;

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent): void => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false);
    };
    // A resize can move the button out of the clamped position: closing is cheaper than re-anchoring.
    const onResize = (): void => setOpen(false);
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', onResize);
    };
  }, [open]);

  const pick = (next: Exclude<OpenDialog, null>): void => {
    setOpen(false);
    setDialog(next);
  };

  return (
    <div ref={containerRef} className="relative ml-auto normal-case tracking-normal">
      <IconButton
        label="Инструменты"
        active={open}
        onClick={() => setOpen((value) => !value)}
        className={
          open
            ? 'h-6 w-6 bg-slate-800 text-sky-300'
            : 'h-6 w-6 text-slate-500 hover:bg-slate-800 hover:text-slate-100'
        }
      >
        <ToolsIcon className="h-4 w-4" />
      </IconButton>

      {open && (
        <div
          ref={measure}
          role="menu"
          style={{
            left: position?.left ?? 0,
            top: position?.top ?? 0,
            visibility: position ? 'visible' : 'hidden',
          }}
          className="fixed z-40 max-h-[calc(100vh-16px)] w-72 overflow-y-auto rounded-md border border-slate-700 bg-slate-900 py-1 text-left shadow-xl"
        >
          <ToolItem
            icon={LayersIcon}
            label="Разложить по слоям"
            description={
              isEmpty
                ? 'Сначала загрузите SVG'
                : 'Собрать детали в стопку: каждая опирается на то, что видно под ней'
            }
            disabled={isEmpty}
            onClick={() => pick('distribute')}
          />
          <ToolItem
            icon={PaletteIcon}
            label="Уменьшить число цветов"
            description={
              isEmpty
                ? 'Сначала загрузите SVG'
                : colorCount <= 1
                  ? 'В модели уже один цвет'
                  : 'Объединить близкие оттенки: цветов в модели станет меньше'
            }
            disabled={isEmpty || colorCount <= 1}
            onClick={() => pick('palette')}
          />
        </div>
      )}

      {dialog === 'distribute' && <DistributeDialog onClose={() => setDialog(null)} />}
      {dialog === 'palette' && (
        <PaletteDialog colorCount={colorCount} onClose={() => setDialog(null)} />
      )}
    </div>
  );
}

/** One tool in the menu: icon, name, one line about it. The settings live in the dialog. */
function ToolItem({
  icon: Icon,
  label,
  description,
  disabled,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  description: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className={clsx(
        'flex w-full items-start gap-2 px-3 py-2 text-left transition',
        disabled ? 'cursor-not-allowed' : 'hover:bg-slate-800',
      )}
    >
      <span
        className={clsx(
          'mt-0.5 grid h-4 w-4 shrink-0 place-items-center',
          disabled ? 'text-slate-600' : 'text-slate-400',
        )}
      >
        <Icon className="h-4 w-4" />
      </span>
      <span className="min-w-0">
        <span
          className={clsx('block text-xs font-medium', disabled ? 'text-slate-600' : 'text-white')}
        >
          {label}
        </span>
        <span className="mt-0.5 block text-[10px] leading-snug text-slate-500">{description}</span>
      </span>
    </button>
  );
}
