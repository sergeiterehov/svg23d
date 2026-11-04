import clsx from 'clsx';
import { HelpHint } from './Icon';

/**
 * Shared look of the panel controls (ADR-0027): a filled pill without a border. The fill is the
 * affordance, hover brightens it and only the focus draws a ring — exactly how Figma does it.
 * Prefixes (icons or short letters like `W`) live inside the pill, so most fields need no caption.
 */
export interface FieldProps {
  /** Leading icon; drawn at 14 px and coloured like a placeholder. */
  icon?: React.ComponentType<{ className?: string }>;
  /** Short leading text instead of an icon, e.g. `W` or `по`. */
  prefix?: string;
}

interface FieldShellProps {
  title?: string;
  disabled?: boolean;
  className?: string;
  children: React.ReactNode;
  prefix?: React.ReactNode;
  suffix?: React.ReactNode;
}

export function FieldShell({
  title,
  disabled,
  className,
  children,
  prefix,
  suffix,
}: FieldShellProps) {
  return (
    <span
      title={title}
      className={clsx(
        'flex h-7 min-w-0 items-center gap-1.5 rounded-md px-1.5 transition',
        'bg-slate-800/60 ring-1 ring-inset ring-transparent',
        'hover:bg-slate-800 focus-within:bg-slate-800 focus-within:ring-sky-500',
        disabled && 'opacity-40 hover:bg-slate-800/60',
        className,
      )}
    >
      {prefix}
      {children}
      {suffix}
    </span>
  );
}

/** Icon or letter at the left edge of a field. */
export function FieldPrefix({ icon: Icon, prefix }: FieldProps) {
  if (Icon) return <Icon className="h-3.5 w-3.5 shrink-0 text-slate-500" />;
  if (!prefix) return null;
  return (
    <span className="shrink-0 text-[10px] font-medium leading-none text-slate-500">{prefix}</span>
  );
}

/**
 * A block of related fields: caption on the left, optional actions on the right (ADR-0027).
 * Shared by the inspector and the view-settings popover so both panels look the same.
 */
export function FieldSection({
  title,
  hint,
  right,
  children,
}: {
  title: string;
  hint?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="border-b border-slate-800/70 px-3 py-2.5 last:border-b-0">
      <div className="flex min-h-4 items-center justify-between gap-2">
        <h2 className="flex min-w-0 items-center gap-1 text-[11px] font-semibold text-slate-200">
          <span className="truncate">{title}</span>
          {hint && <HelpHint text={hint} />}
        </h2>
        {right}
      </div>
      <div className="mt-1.5 space-y-1.5">{children}</div>
    </section>
  );
}
