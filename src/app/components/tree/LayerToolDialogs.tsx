import { useState } from 'react';
import { useProjectStore } from '../../store/useProjectStore';
import { Dialog, DialogButton } from '../common/Dialog';
import { NumberField } from '../common/NumberField';
import { ColorChip, Toggle } from '../common/Toggle';
import {
  DEFAULT_DISTRIBUTE_OPTIONS,
  LAYER_MM,
  SINK_MM,
  SUPPORT_SHARE,
  type DistributeOptions,
} from '@core/solver/distribute';
import { reducePalette } from '@core/color/palette';
import { useT } from '../../i18n';

/** How many colours "Уменьшить число цветов" suggests by default. */
export const DEFAULT_COLOR_COUNT = 4;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * «Разложить по слоям» with every number of the algorithm on screen (ADR-0033). The stack is built
 * from four knobs, so the tool is a form and not a button: the defaults are a starting point.
 */
export function DistributeDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const distributeZ = useProjectStore((s) => s.distributeZ);
  const global = useProjectStore((s) => s.project?.global);
  const [options, setOptions] = useState<DistributeOptions>(DEFAULT_DISTRIBUTE_OPTIONS);
  // Without a support the part takes the project heights — or, unticked, its own.
  const [useProjectBase, setUseProjectBase] = useState(true);

  if (!global) return null;
  const baseFrom = options.baseFrom ?? global.defaultZFrom;
  const baseTo = options.baseTo ?? global.defaultZTo;
  const patch = (next: Partial<DistributeOptions>): void =>
    setOptions((current) => ({ ...current, ...next }));

  return (
    <Dialog
      title={t('tools.distribute')}
      onClose={onClose}
      footer={
        <>
          <DialogButton onClick={onClose}>{t('common.cancel')}</DialogButton>
          <DialogButton
            variant="primary"
            onClick={() => {
              distributeZ({
                ...options,
                ...(useProjectBase ? { baseFrom: undefined, baseTo: undefined } : {}),
              });
              onClose();
            }}
          >
            {t('distribute.apply')}
          </DialogButton>
        </>
      }
    >
      <p className="mb-3 text-[11px] leading-snug text-slate-400">{t('distribute.intro')}</p>

      <div className="grid grid-cols-2 gap-2">
        <NumberField
          label={t('distribute.layer')}
          value={options.layerMm}
          min={0}
          step={0.5}
          hint={t('distribute.layerHint')}
          onCommit={(value) => patch({ layerMm: value ?? LAYER_MM })}
          onDelta={(delta) => patch({ layerMm: Math.max(0, options.layerMm + delta) })}
        />
        <NumberField
          label={t('distribute.sink')}
          value={options.sinkMm}
          min={0}
          step={0.1}
          hint={t('distribute.sinkHint')}
          onCommit={(value) => patch({ sinkMm: value ?? SINK_MM })}
          onDelta={(delta) => patch({ sinkMm: Math.max(0, options.sinkMm + delta) })}
        />
      </div>

      <div className="mt-2">
        <NumberField
          label={t('distribute.support')}
          suffix="%"
          value={Math.round(options.supportShare * 1000) / 10}
          min={0}
          max={100}
          step={0.5}
          hint={t('distribute.supportHint')}
          onCommit={(value) =>
            patch({ supportShare: clamp((value ?? SUPPORT_SHARE * 100) / 100, 0, 1) })
          }
          onDelta={(delta) =>
            patch({
              supportShare: clamp(
                Math.round((options.supportShare * 100 + delta) * 10) / 1000,
                0,
                1,
              ),
            })
          }
        />
      </div>

      <div className="mt-3 border-t border-slate-800 pt-3">
        <Toggle
          label={t('distribute.useProject')}
          checked={useProjectBase}
          onChange={setUseProjectBase}
          hint={t('distribute.useProjectHint')}
        />
        {!useProjectBase && (
          <div className="mt-2 grid grid-cols-2 gap-2">
            <NumberField
              label={t('field.zFrom')}
              value={baseFrom}
              step={0.2}
              onCommit={(value) => patch({ baseFrom: value ?? 0 })}
              onDelta={(delta) => patch({ baseFrom: Math.max(0, baseFrom + delta) })}
            />
            <NumberField
              label={t('field.zTo')}
              value={baseTo}
              step={0.2}
              onCommit={(value) => patch({ baseTo: value ?? 0 })}
              onDelta={(delta) => patch({ baseTo: baseTo + delta })}
            />
          </div>
        )}
      </div>
    </Dialog>
  );
}

/**
 * «Уменьшить число цветов»: the dialog asks for one thing — how many colours to keep — and shows
 * the palette that comes out, so the k-means result is not a surprise after pressing the button.
 */
export function PaletteDialog({
  colorCount,
  onClose,
}: {
  colorCount: number;
  onClose: () => void;
}) {
  const t = useT();
  const limitPalette = useProjectStore((s) => s.limitPalette);
  const resetPalette = useProjectStore((s) => s.resetPalette);
  const usageOf = useProjectStore((s) => s.paletteUsage);
  const settings = useProjectStore((s) => s.project?.settings);
  const hasOverrides = Object.values(settings ?? {}).some(
    (value) => value.colorOverride !== undefined,
  );

  const suggested = Math.min(DEFAULT_COLOR_COUNT, colorCount);
  const [draft, setDraft] = useState<number | undefined>(suggested);
  const target = clamp(Math.round(draft ?? suggested), 1, colorCount);

  // Preview of the result: the same reduction the button applies, shown before it is applied.
  const usage = usageOf();
  const palette = reducePalette(usage, clamp(target, 1, Math.max(usage.length, 1))).palette;

  return (
    <Dialog
      title={t('tools.palette')}
      onClose={onClose}
      footer={
        <>
          <DialogButton onClick={onClose}>{t('common.cancel')}</DialogButton>
          {hasOverrides && (
            <DialogButton
              onClick={() => {
                resetPalette();
                onClose();
              }}
            >
              {t('palette.reset')}
            </DialogButton>
          )}
          <DialogButton
            variant="primary"
            onClick={() => {
              limitPalette(target);
              onClose();
            }}
          >
            {t('palette.apply')}
          </DialogButton>
        </>
      }
    >
      <p className="mb-3 text-[11px] leading-snug text-slate-400">
        {t('palette.intro', { count: colorCount })}
      </p>

      <NumberField
        label={t('palette.keep')}
        suffix=""
        value={draft}
        placeholder={String(suggested)}
        min={1}
        max={colorCount}
        step={1}
        onCommit={(value) => setDraft(value)}
        onDelta={(delta) => setDraft(clamp(target + delta, 1, colorCount))}
      />

      <div className="mt-3">
        <span className="mb-1 block text-[11px] leading-none text-slate-400">
          {t('palette.preview')}
        </span>
        <div className="flex h-7 items-center gap-1.5 rounded-md bg-slate-800/60 px-1.5">
          {palette.map((entry) => (
            <ColorChip key={entry.color} color={entry.color} size={14} />
          ))}
          <span className="ml-auto text-[10px] tabular-nums text-slate-500">
            {t('palette.of', { shown: palette.length, total: colorCount })}
          </span>
        </div>
      </div>

      {hasOverrides && (
        <p className="mt-3 text-[10px] leading-snug text-slate-500">{t('palette.overrides')}</p>
      )}
    </Dialog>
  );
}
