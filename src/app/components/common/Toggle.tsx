import clsx from 'clsx';
import { HelpHint } from './Icon';
import { useT } from '../../i18n';

interface ToggleProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Explanation shown in the "?" tooltip. */
  hint?: string;
  /** Multi-selection with different values: the switch sits in between. */
  mixed?: boolean;
  /** The value is decided by an ancestor (e.g. a group hides this element). */
  disabled?: boolean;
}

export function Toggle({
  label,
  checked,
  onChange,
  hint,
  mixed = false,
  disabled = false,
}: ToggleProps) {
  const t = useT();
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        role="switch"
        aria-checked={mixed ? 'mixed' : checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(mixed ? true : !checked)}
        className={clsx(
          'relative h-4 w-7 shrink-0 rounded-full transition',
          disabled
            ? 'cursor-not-allowed opacity-50'
            : mixed
              ? 'bg-slate-500'
              : checked
                ? 'bg-sky-500'
                : 'bg-slate-700',
        )}
      >
        <span
          className={clsx(
            'absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all',
            mixed ? 'left-2 opacity-70' : checked ? 'left-3.5' : 'left-0.5',
          )}
        />
      </button>
      <span className="flex min-w-0 items-center gap-1">
        <button
          type="button"
          disabled={disabled}
          onClick={() => onChange(mixed ? true : !checked)}
          className={clsx(
            'truncate text-xs',
            disabled ? 'cursor-not-allowed text-slate-500' : 'text-slate-200 hover:text-white',
          )}
        >
          {label}
        </button>
        {mixed && <span className="shrink-0 text-[10px] text-slate-500">{t('common.mixed')}</span>}
        {hint && <HelpHint text={hint} />}
      </span>
    </div>
  );
}

export function ColorChip({ color, size = 12 }: { color: string; size?: number }) {
  return (
    <span
      className="inline-block shrink-0 rounded-sm ring-1 ring-black/40"
      style={{
        width: size,
        height: size,
        backgroundColor: color === 'none' ? 'transparent' : color,
        backgroundImage:
          color === 'none'
            ? 'linear-gradient(45deg, #475569 25%, transparent 25%, transparent 75%, #475569 75%)'
            : undefined,
        backgroundSize: color === 'none' ? '6px 6px' : undefined,
      }}
    />
  );
}

/** Two different colours diagonally split: the "mixed value" chip of a multi-selection. */
export function MixedColorChip({ colors, size = 12 }: { colors: string[]; size?: number }) {
  const first = colors[0] === 'none' ? 'transparent' : colors[0];
  const second = colors[1] === 'none' ? 'transparent' : colors[1];
  return (
    <span
      className="inline-block shrink-0 rounded-sm ring-1 ring-black/40"
      style={{
        width: size,
        height: size,
        backgroundImage: `linear-gradient(135deg, ${first} 50%, ${second} 50%)`,
        backgroundColor: '#1e293b',
      }}
    />
  );
}
