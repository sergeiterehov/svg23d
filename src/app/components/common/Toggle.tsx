import clsx from 'clsx';
import { HelpHint } from './Icon';

interface ToggleProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Explanation shown in the "?" tooltip. */
  hint?: string;
}

export function Toggle({ label, checked, onChange, hint }: ToggleProps) {
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={clsx(
          'relative h-4 w-7 shrink-0 rounded-full transition',
          checked ? 'bg-sky-500' : 'bg-slate-700',
        )}
      >
        <span
          className={clsx(
            'absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all',
            checked ? 'left-3.5' : 'left-0.5',
          )}
        />
      </button>
      <span className="flex min-w-0 items-center gap-1">
        <button
          type="button"
          onClick={() => onChange(!checked)}
          className="truncate text-xs text-slate-300 hover:text-white"
        >
          {label}
        </button>
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
