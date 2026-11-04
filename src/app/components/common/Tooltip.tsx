import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * Delayed tooltip for icon buttons. Rendered through a portal with fixed coordinates, so it is
 * never clipped by scrolling panels, and it appears only after a short hover delay (unlike the
 * "?" help bubbles, which are instant).
 */

const SHOW_DELAY_MS = 450;

interface Placement {
  left: number;
  top: number;
  below: boolean;
}

export interface TooltipApi {
  handlers: {
    onMouseEnter: (event: React.MouseEvent<HTMLElement>) => void;
    onMouseLeave: () => void;
    onFocus: (event: React.FocusEvent<HTMLElement>) => void;
    onBlur: () => void;
    onPointerDown: () => void;
  };
  tooltip: React.ReactNode;
}

export function useTooltip(label: string, delay = SHOW_DELAY_MS): TooltipApi {
  const [placement, setPlacement] = useState<Placement | null>(null);
  const timer = useRef<number | null>(null);

  const clear = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  const hide = useCallback(() => {
    clear();
    setPlacement(null);
  }, [clear]);

  const show = useCallback(
    (element: HTMLElement) => {
      clear();
      timer.current = window.setTimeout(() => {
        const rect = element.getBoundingClientRect();
        const below = rect.bottom + 48 < window.innerHeight;
        setPlacement({
          left: Math.min(Math.max(rect.left + rect.width / 2, 60), window.innerWidth - 60),
          top: below ? rect.bottom + 8 : rect.top - 8,
          below,
        });
      }, delay);
    },
    [clear, delay],
  );

  useEffect(() => clear, [clear]);

  useEffect(() => {
    if (!placement) return;
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    return () => {
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('resize', hide);
    };
  }, [placement, hide]);

  return {
    handlers: {
      onMouseEnter: (event) => show(event.currentTarget),
      onMouseLeave: hide,
      onFocus: (event) => show(event.currentTarget),
      onBlur: hide,
      onPointerDown: hide,
    },
    tooltip:
      placement && label
        ? createPortal(
            <span
              role="tooltip"
              style={{
                left: placement.left,
                top: placement.top,
                transform: placement.below ? 'translate(-50%, 0)' : 'translate(-50%, -100%)',
              }}
              className="pointer-events-none fixed z-50 block max-w-64 rounded-md border border-slate-700 bg-slate-900/95 px-2 py-1 text-[11px] leading-snug whitespace-nowrap text-slate-200 shadow-xl"
            >
              {label}
            </span>,
            document.body,
          )
        : null,
  };
}
