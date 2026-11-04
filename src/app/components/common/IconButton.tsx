import clsx from 'clsx';
import { useTooltip } from './Tooltip';

interface IconButtonProps {
  /** Tooltip text and accessible name. */
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  disabled?: boolean;
  className?: string;
  /** Tree rows must not trigger the row selection when their buttons are clicked. */
  stopPropagation?: boolean;
  active?: boolean;
}

/** Icon-only button with a delayed tooltip. */
export function IconButton({
  label,
  onClick,
  children,
  disabled,
  className,
  stopPropagation,
  active,
}: IconButtonProps) {
  const tip = useTooltip(label);

  return (
    <>
      <button
        type="button"
        aria-label={label}
        aria-pressed={active}
        disabled={disabled}
        onClick={(event) => {
          if (stopPropagation) event.stopPropagation();
          onClick();
        }}
        {...tip.handlers}
        className={clsx(
          'grid shrink-0 place-items-center rounded transition',
          disabled ? 'cursor-not-allowed text-slate-700' : 'text-slate-400',
          className,
        )}
      >
        {children}
      </button>
      {tip.tooltip}
    </>
  );
}
