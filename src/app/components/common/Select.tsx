import { ChevronDownIcon, HelpHint } from './Icon';
import { FieldPrefix, FieldShell, type FieldProps } from './Field';

export interface SelectOption {
  value: string;
  label: string;
}

interface SelectFieldProps extends FieldProps {
  /** Accessible name; also the caption above the field when there is no icon or letter. */
  label: string;
  /** Explanation shown in the "?" tooltip next to the caption (ignored for icon-only fields). */
  hint?: string;
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  className?: string;
}

/**
 * Native `<select>` inside the shared pill (ADR-0027): `appearance-none` plus our own chevron,
 * because the built-in arrow sits flush against the border and looks cramped.
 */
export function SelectField({
  label,
  icon,
  prefix,
  hint,
  value,
  options,
  onChange,
  className,
}: SelectFieldProps) {
  const flat = Boolean(icon || prefix);

  const field = (
    <FieldShell
      className={className}
      title={flat ? label : undefined}
      prefix={<FieldPrefix icon={icon} prefix={prefix} />}
      suffix={
        <ChevronDownIcon className="pointer-events-none h-3.5 w-3.5 shrink-0 text-slate-500" />
      }
    >
      <select
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-full min-w-0 flex-1 cursor-pointer appearance-none bg-transparent text-xs text-slate-100 outline-none"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value} className="bg-slate-900">
            {option.label}
          </option>
        ))}
      </select>
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
