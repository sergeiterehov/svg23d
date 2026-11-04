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

  return (
    <label className="block">
      <span className="flex items-center gap-1 text-xs text-slate-400">
        <span className="truncate">{label}</span>
        {hint && <HelpHint text={hint} />}
      </span>

      <span className="mt-1 flex items-center gap-1">
        <span className="relative block flex-1">
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
              'w-full rounded-md border bg-slate-900/70 py-1.5 pl-2 text-sm text-slate-100 outline-none transition',
              overridden ? 'border-sky-700/70 pr-6' : 'border-slate-700 pr-2',
              'focus:border-sky-500 focus:ring-1 focus:ring-sky-500/40',
              disabled && 'opacity-40',
            )}
          />
          {overridden && (
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
        <span className="w-6 shrink-0 text-[10px] text-slate-500">{suffix}</span>
      </span>
    </label>
  );
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
