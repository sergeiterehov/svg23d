import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import type { MessageKey } from '@i18n';
import { useProjectStore } from '../../store/useProjectStore';
import { useT } from '../../i18n';
import { DEFAULT_GLOBAL_SETTINGS } from '@core/model/defaults';
import type { ViewSettings } from '@core/model/types';
import { SelectField } from '../common/Select';
import { FieldSection } from '../common/Field';
import {
  BlendIcon,
  HeightsIcon,
  PictureIcon,
  ProjectionOrthoIcon,
  ProjectionPerspectiveIcon,
  SlidersIcon,
  SphereIcon,
  SunIcon,
  XIcon,
} from '../common/Icon';
import { IconButton } from '../common/IconButton';
import { useTooltip } from '../common/Tooltip';

interface TabOption<T extends string> {
  value: T;
  labelKey: MessageKey;
  icon: React.ComponentType<{ className?: string }>;
}

const MODES_2D: ReadonlyArray<TabOption<ViewSettings['mode2d']>> = [
  { value: 'transparent', labelKey: 'view.mode.transparent', icon: BlendIcon },
  { value: 'heightmap', labelKey: 'view.mode.heightmap', icon: HeightsIcon },
  { value: 'asis', labelKey: 'view.mode.asis', icon: PictureIcon },
];

const PROJECTIONS: ReadonlyArray<TabOption<ViewSettings['projection']>> = [
  { value: 'perspective', labelKey: 'view.perspective', icon: ProjectionPerspectiveIcon },
  { value: 'orthographic', labelKey: 'view.orthographic', icon: ProjectionOrthoIcon },
];

/**
 * View settings live next to the 2D/3D switch: they belong to the preview, not to the project
 * settings panel. The popover opens upwards (the switch sits at the bottom of the canvas) and shows
 * only the settings that matter for the current mode. The popover closes with its own ✕ (and on
 * Escape / outside click).
 */
export function ViewSettingsPopover() {
  const t = useT();
  const view = useProjectStore((s) => s.project?.global.view) ?? DEFAULT_GLOBAL_SETTINGS.view;
  const viewMode = useProjectStore((s) => s.viewMode);
  const updateView = useProjectStore((s) => s.updateView);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent): void => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <IconButton
        label={t('view.settings')}
        onClick={() => setOpen((value) => !value)}
        active={open}
        className={clsx(
          'h-[30px] w-[30px] rounded-md border',
          open
            ? 'border-sky-500 bg-sky-600 text-white'
            : 'border-slate-700 bg-slate-900/90 text-slate-400 hover:border-slate-500 hover:text-slate-100',
        )}
      >
        <SlidersIcon className="h-4 w-4" />
      </IconButton>

      {open && (
        <div className="absolute bottom-full right-0 z-30 mb-2 w-64 overflow-hidden rounded-lg border border-slate-700 bg-slate-900 shadow-2xl">
          <div className="flex items-center justify-between px-3 py-2.5">
            <h3 className="text-[11px] font-semibold text-slate-200">{t('view.title')}</h3>
            <IconButton
              label={t('common.close')}
              onClick={() => setOpen(false)}
              className="h-5 w-5 hover:bg-slate-800 hover:text-white"
            >
              <XIcon className="h-3.5 w-3.5" />
            </IconButton>
          </div>

          {viewMode === '3d' ? (
            <>
              <FieldSection title={t('view.projection')} hint={t('view.projectionHint')}>
                <IconTabs
                  value={view.projection}
                  options={PROJECTIONS}
                  onChange={(value) => updateView({ projection: value })}
                />
              </FieldSection>

              <FieldSection title={t('view.lighting')}>
                <SelectField
                  label={t('view.lighting')}
                  icon={SunIcon}
                  value={view.lighting}
                  options={[
                    { value: 'studio', label: t('view.lighting.studio') },
                    { value: 'top', label: t('view.lighting.top') },
                    { value: 'flat', label: t('view.lighting.flat') },
                  ]}
                  onChange={(value) => updateView({ lighting: value as ViewSettings['lighting'] })}
                />
              </FieldSection>

              <FieldSection title={t('view.material')}>
                <SelectField
                  label={t('view.material')}
                  icon={SphereIcon}
                  value={view.material}
                  options={[
                    { value: 'matte', label: t('view.material.matte') },
                    { value: 'glossy', label: t('view.material.glossy') },
                  ]}
                  onChange={(value) => updateView({ material: value as ViewSettings['material'] })}
                />
              </FieldSection>
            </>
          ) : (
            <FieldSection title={t('view.mode2d')} hint={t('view.mode2dHint')}>
              <IconTabs
                value={view.mode2d}
                options={MODES_2D}
                onChange={(value) => updateView({ mode2d: value })}
              />
            </FieldSection>
          )}
        </div>
      )}
    </div>
  );
}

/** Segmented control of icon-only tabs; the name comes up as a delayed tooltip. */
function IconTabs<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: ReadonlyArray<TabOption<T>>;
  onChange: (value: T) => void;
}) {
  const t = useT();
  return (
    // One track for the whole group, filled like any field and without a border: the active tab is
    // the only thing that gets a fill of its own.
    <div role="group" className="flex overflow-hidden rounded-md bg-slate-800/60">
      {options.map((option) => (
        <TabButton
          key={option.value}
          label={t(option.labelKey)}
          icon={option.icon}
          active={option.value === value}
          onClick={() => onChange(option.value)}
        />
      ))}
    </div>
  );
}

function TabButton({
  label,
  icon: Icon,
  active,
  onClick,
}: {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  active: boolean;
  onClick: () => void;
}) {
  const tip = useTooltip(label);

  return (
    <>
      <button
        type="button"
        aria-label={label}
        aria-pressed={active}
        onClick={onClick}
        {...tip.handlers}
        className={clsx(
          'grid h-7 flex-1 place-items-center transition',
          active
            ? 'bg-sky-600 text-white'
            : 'text-slate-400 hover:bg-slate-700/60 hover:text-slate-100',
        )}
      >
        <Icon className="h-4 w-4" />
      </button>
      {tip.tooltip}
    </>
  );
}
