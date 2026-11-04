import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * Delayed tooltip for icon buttons. Rendered through a portal with fixed coordinates, so it is
 * never clipped by scrolling panels, and it appears only after a short hover delay (unlike the
 * "?" help bubbles, which are instant).
 *
 * The tooltip is measured before it becomes visible and then clamped to the viewport: clamping by
 * the anchor position alone is not enough, because a long label is wider than the anchor.
 */

const SHOW_DELAY_MS = 450;
const GAP = 8;

interface Anchor {
  left: number;
  top: number;
  bottom: number;
  centerX: number;
}

interface Placement {
  left: number;
  top: number;
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
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const [placement, setPlacement] = useState<Placement | null>(null);
  const tipRef = useRef<HTMLSpanElement | null>(null);
  const timer = useRef<number | null>(null);

  const clear = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  const hide = useCallback(() => {
    clear();
    setAnchor(null);
  }, [clear]);

  const show = useCallback(
    (element: HTMLElement) => {
      clear();
      timer.current = window.setTimeout(() => {
        const rect = element.getBoundingClientRect();
        setAnchor({
          left: rect.left,
          top: rect.top,
          bottom: rect.bottom,
          centerX: rect.left + rect.width / 2,
        });
      }, delay);
    },
    [clear, delay],
  );

  useEffect(() => clear, [clear]);

  useLayoutEffect(() => {
    const tip = tipRef.current;
    if (!anchor || !tip) {
      setPlacement(null);
      return;
    }
    const width = tip.offsetWidth;
    const height = tip.offsetHeight;
    const left = Math.min(
      Math.max(GAP, anchor.centerX - width / 2),
      Math.max(GAP, window.innerWidth - width - GAP),
    );
    // Prefer below the anchor, flip above when there is no room, then clamp to the viewport.
    let top = anchor.bottom + GAP;
    if (top + height > window.innerHeight - GAP) top = anchor.top - height - GAP;
    top = Math.min(Math.max(GAP, top), Math.max(GAP, window.innerHeight - height - GAP));
    setPlacement({ left, top });
  }, [anchor, label]);

  useEffect(() => {
    if (!anchor) return;
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    return () => {
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('resize', hide);
    };
  }, [anchor, hide]);

  return {
    handlers: {
      onMouseEnter: (event) => show(event.currentTarget),
      onMouseLeave: hide,
      onFocus: (event) => show(event.currentTarget),
      onBlur: hide,
      onPointerDown: hide,
    },
    tooltip:
      anchor && label
        ? createPortal(
            <span
              ref={tipRef}
              role="tooltip"
              style={{
                left: placement?.left ?? 0,
                top: placement?.top ?? 0,
                opacity: placement ? 1 : 0,
              }}
              className="pointer-events-none fixed z-50 block max-w-64 rounded-md border border-slate-700 bg-slate-900/95 px-2 py-1 text-[11px] leading-snug text-slate-200 shadow-xl"
            >
              {label}
            </span>,
            document.body,
          )
        : null,
  };
}
