import clsx from 'clsx';
import { ChevronDownIcon } from './Icon';

export interface SelectOption {
  value: string;
  label: string;
}

interface SelectFieldProps {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  className?: string;
}

/**
 * Native `<select>` with a custom chevron: the built-in arrow sits flush against the border and
 * looks cramped, so the element is rendered `appearance-none` with our own icon and padding.
 */
export function SelectField({ value, options, onChange, className }: SelectFieldProps) {
  return (
    <div className={clsx('relative', className)}>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full appearance-none rounded-md border border-slate-700 bg-slate-900/70 py-1.5 pl-2 pr-8 text-sm text-slate-100 outline-none transition focus:border-sky-500 focus:ring-1 focus:ring-sky-500/40"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDownIcon className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
    </div>
  );
}
