import { useState } from 'react';
import clsx from 'clsx';
import { HelpHint, ResetIcon } from './Icon';
import { FieldPrefix, FieldShell, type FieldProps } from './Field';
import { useT } from '../../i18n';

interface NumberFieldProps extends FieldProps {
  /** Accessible name; also the caption above the field when there is no icon or letter. */
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
  max?: number;
  /** Unit shown at the right edge of the field. */
  suffix?: string;
  /** Explanation shown in the "?" tooltip next to the caption (ignored for icon-only fields). */
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
 *
 * With an icon or a letter prefix the field carries its own meaning and no caption is drawn —
 * the label stays as the accessible name and as the native hover tooltip.
 */
export function NumberField({
  label,
  icon,
  prefix,
  value,
  placeholder = '',
  onCommit,
  onDelta,
  step = 0.1,
  min,
  max,
  suffix,
  hint,
  disabled,
  showReset = false,
}: NumberFieldProps) {
  const t = useT();
  // «mm» unless the field names its own unit (percent, count).
  const shownSuffix = suffix ?? t('unit.mm');
  // Derived state: the draft is discarded whenever the committed value changes
  // (reset button, undo, switching selection).
  const [draft, setDraft] = useState<string | null>(null);
  const [lastValue, setLastValue] = useState(value);
  if (lastValue !== value) {
    setLastValue(value);
    setDraft(null);
  }

  const displayed = draft ?? (value === undefined ? '' : String(round(value)));

  const limit = (next: number): number =>
    Math.min(max ?? Number.POSITIVE_INFINITY, Math.max(min ?? Number.NEGATIVE_INFINITY, next));

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
        if (absolute !== null) onCommit(limit(absolute));
      }
      return;
    }
    const absolute = parseNumber(raw);
    if (absolute === null) return;
    onCommit(limit(absolute));
  };

  const flat = Boolean(icon || prefix);

  const field = (
    <FieldShell
      disabled={disabled}
      title={flat ? label : undefined}
      prefix={<FieldPrefix icon={icon} prefix={prefix} />}
      suffix={
        <>
          {shownSuffix && (
            <span className="shrink-0 select-none text-[10px] leading-none text-slate-500">
              {shownSuffix}
            </span>
          )}
          {showReset && (
            <button
              type="button"
              title={t('field.reset')}
              aria-label={t('field.reset')}
              onClick={(event) => {
                event.preventDefault();
                setDraft(null);
                onCommit(undefined);
              }}
              className="grid h-4 w-4 shrink-0 place-items-center rounded text-slate-500 transition hover:bg-slate-700 hover:text-white"
            >
              <ResetIcon className="h-3 w-3" />
            </button>
          )}
        </>
      }
    >
      <input
        type="text"
        inputMode="decimal"
        autoComplete="off"
        spellCheck={false}
        aria-label={label}
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
          'h-full min-w-0 flex-1 bg-transparent text-xs tabular-nums text-slate-100 outline-none',
          'placeholder:text-slate-500 disabled:cursor-not-allowed',
        )}
      />
    </FieldShell>
  );

  if (flat) return field;

  return (
    <label className="block">
      <span className="mb-1 flex h-3.5 items-center gap-1 text-[11px] leading-none text-slate-400">
        <span className="truncate">{label}</span>
        {hint && <HelpHint text={hint} />}
      </span>
      {field}
    </label>
  );
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
