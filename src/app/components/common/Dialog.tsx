import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';

/**
 * Modal used for the two questions the app has to ask: "delete this project?" and "a project with
 * this name already exists" (ADR-0031). Rendered through a portal so no scrolling panel can clip it.
 */
export function Dialog({
  title,
  children,
  footer,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  footer: React.ReactNode;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-slate-950/70 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-full max-w-md rounded-lg border border-slate-700 bg-slate-900 shadow-2xl"
      >
        <h2 className="px-4 pt-3.5 text-sm font-semibold text-slate-100">{title}</h2>
        <div className="px-4 py-3 text-xs leading-relaxed text-slate-300">{children}</div>
        <div className="flex flex-wrap justify-end gap-2 border-t border-slate-800 px-3 py-2.5">
          {footer}
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function DialogButton({
  children,
  onClick,
  variant = 'ghost',
}: {
  children: React.ReactNode;
  onClick: () => void;
  variant?: 'ghost' | 'primary' | 'danger';
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        'rounded-md px-3 py-1.5 text-xs font-medium transition',
        variant === 'primary' && 'bg-sky-600 text-white hover:bg-sky-500',
        variant === 'danger' && 'bg-rose-600 text-white hover:bg-rose-500',
        variant === 'ghost' &&
          'border border-slate-700 text-slate-300 hover:border-slate-500 hover:text-white',
      )}
    >
      {children}
    </button>
  );
}
