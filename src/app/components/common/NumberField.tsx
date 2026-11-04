import { useState } from 'react';
import clsx from 'clsx';
import { HelpHint, ResetIcon } from './Icon';

interface NumberFieldProps {
  label: string;
  /** Committed value; `undefined` leaves the input empty and shows the placeholder. */
  value: number | undefined;
  /** Text shown while the field is empty (inherited value or a spread like `12-15`). */
  placeholder?: string;
  /** Absolute value; `undefined` clears the override. */
  onCommit: (value: number | undefined) => void;
  /** Relative change from `+2` / `-2`. Without it deltas fall back to absolute parsing. */
  onDelta?: (delta: number) => void;
  step?: number;
  min?: number;
  suffix?: string;
  /** Explanation shown in the "?" tooltip. */
  hint?: string;
  disabled?: boolean;
  /** Shows the reset-to-inherited button (hidden for project-wide values and multi-selection). */
  showReset?: boolean;
}

/** `+2`, `-0.5` — a signed change, not an absolute value. */
export function parseDelta(raw: string): number | null {
  if (!/^[+-]/.test(raw.trim())) return null;
  const parsed = parseNumber(raw);
  return parsed === null ? null : parsed;
}

/** Accepts `12`, `12,5`, ` 12.5 `; rejects anything else. */
export function parseNumber(raw: string): number | null {
  const normalised = raw.trim().replace(',', '.').replace(/^\+/, '');
  if (normalised === '' || normalised === '-' || normalised === '+') return null;
  if (!/^-?\d*\.?\d*$/.test(normalised)) return null;
  const parsed = Number(normalised);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Numeric input that commits on Enter or blur, so that a typed value and a delta (`+2`, `-2`)
 * never fight each other mid-typing. Escape reverts the draft.
 */
export function NumberField({
  label,
  value,
  placeholder = '',
  onCommit,
  onDelta,
  step = 0.1,
  min,
  suffix = 'мм',
  hint,
  disabled,
  showReset = false,
}: NumberFieldProps) {
  // Derived state: the draft is discarded whenever the committed value changes
  // (reset button, undo, switching selection).
  const [draft, setDraft] = useState<string | null>(null);
  const [lastValue, setLastValue] = useState(value);
  if (lastValue !== value) {
    setLastValue(value);
    setDraft(null);
  }

  const displayed = draft ?? (value === undefined ? '' : String(round(value)));

  const commit = (): void => {
    if (draft === null) return;
    const raw = draft.trim();
    setDraft(null);
    if (raw === '') {
      onCommit(undefined);
      return;
    }
    const delta = parseDelta(raw);
    if (delta !== null) {
      if (onDelta) onDelta(delta);
      else {
        const absolute = parseNumber(raw);
        if (absolute !== null) onCommit(Math.max(min ?? -Infinity, absolute));
      }
      return;
    }
    const absolute = parseNumber(raw);
    if (absolute === null) return;
    onCommit(min !== undefined ? Math.max(min, absolute) : absolute);
  };

  return (
    <label className="block">
      <span className="flex h-4 items-center gap-1 text-xs leading-none text-slate-400">
        <span className="truncate">{label}</span>
        {hint && <HelpHint text={hint} />}
      </span>

      <span className="relative mt-1 block">
        <input
          type="text"
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          disabled={disabled}
          value={displayed}
          placeholder={placeholder}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              commit();
              event.currentTarget.blur();
            } else if (event.key === 'Escape') {
              event.preventDefault();
              setDraft(null);
              event.currentTarget.blur();
            } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
              // Keep the spinner-like behaviour of a number input without a number input.
              event.preventDefault();
              const base = parseNumber(displayed) ?? value ?? 0;
              const next = base + (event.key === 'ArrowUp' ? step : -step);
              setDraft(String(round(next)));
            }
          }}
          className={clsx(
            'h-[34px] w-full rounded-md border bg-slate-900/70 pl-2 text-sm text-slate-100 outline-none transition placeholder:text-slate-500',
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
              setDraft(null);
              onCommit(undefined);
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
