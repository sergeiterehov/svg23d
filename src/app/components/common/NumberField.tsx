import { useState } from 'react';
import clsx from 'clsx';
import { HelpHint, ResetIcon } from './Icon';

interface NumberFieldProps {
  label: string;
  value: number | undefined;
  inheritedValue?: number;
  onChange: (value: number | undefined) => void;
  step?: number;
  min?: number;
  suffix?: string;
  /** Explanation shown in the "?" tooltip. */
  hint?: string;
  disabled?: boolean;
  /** Project-wide values have nothing to inherit from, so they hide the reset icon. */
  hideReset?: boolean;
}

/**
 * Numeric input. `undefined` means "inherited": the placeholder shows the inherited value and a
 * reset icon appears inside the field once the user overrides it.
 */
export function NumberField({
  label,
  value,
  inheritedValue,
  onChange,
  step = 0.1,
  min,
  suffix = 'мм',
  hint,
  disabled,
  hideReset = false,
}: NumberFieldProps) {
  // Derived state: the draft is discarded whenever the committed value changes
  // (reset button, undo, switching selection).
  const [draft, setDraft] = useState<string | null>(null);
  const [lastValue, setLastValue] = useState(value);
  if (lastValue !== value) {
    setLastValue(value);
    setDraft(null);
  }

  const displayed = draft ?? (value === undefined ? '' : String(value));
  const overridden = value !== undefined;
  const showReset = overridden && !hideReset;

  return (
    <label className="block">
      <span className="flex h-4 items-center gap-1 text-xs leading-none text-slate-400">
        <span className="truncate">{label}</span>
        {hint && <HelpHint text={hint} />}
      </span>

      <span className="relative mt-1 block">
        <input
          type="number"
          inputMode="decimal"
          step={step}
          min={min}
          disabled={disabled}
          value={displayed}
          placeholder={inheritedValue !== undefined ? String(round(inheritedValue)) : ''}
          onChange={(event) => {
            const raw = event.target.value;
            setDraft(raw);
            if (raw.trim() === '') {
              onChange(undefined);
              return;
            }
            const parsed = Number(raw);
            if (Number.isFinite(parsed)) onChange(parsed);
          }}
          onBlur={() => setDraft(null)}
          className={clsx(
            'h-[34px] w-full rounded-md border bg-slate-900/70 pl-2 text-sm text-slate-100 outline-none transition',
            showReset ? 'border-sky-700/70 pr-10' : 'border-slate-700 pr-7',
            'focus:border-sky-500 focus:ring-1 focus:ring-sky-500/40',
            disabled && 'opacity-40',
          )}
        />
        <span
          className={clsx(
            'pointer-events-none absolute top-1/2 -translate-y-1/2 text-[10px] leading-none text-slate-500',
            showReset ? 'right-6' : 'right-2',
          )}
        >
          {suffix}
        </span>
        {showReset && (
          <button
            type="button"
            title="Сбросить к наследуемому значению"
            aria-label="Сбросить к наследуемому значению"
            onClick={(event) => {
              event.preventDefault();
              onChange(undefined);
            }}
            className="absolute right-1 top-1/2 grid h-4 w-4 -translate-y-1/2 place-items-center rounded text-slate-400 hover:bg-slate-700 hover:text-white"
          >
            <ResetIcon className="h-3 w-3" />
          </button>
        )}
      </span>
    </label>
  );
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
