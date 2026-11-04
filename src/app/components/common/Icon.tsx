import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';

/**
 * Minimal inline icon set (no external dependency) plus the "?" help hint used to keep
 * labels short: the explanation lives in a tooltip instead of a paragraph of text.
 */

interface IconProps {
  className?: string;
}

const base = 'shrink-0';

function Svg({ className, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={clsx(base, className)}
    >
      {children}
    </svg>
  );
}

export function ResetIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M3 12a9 9 0 1 0 2.6-6.4" />
      <path d="M3 4v5h5" />
    </Svg>
  );
}

export function ChevronUpIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="m6 15 6-6 6 6" />
    </Svg>
  );
}

export function ChevronDownIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="m6 9 6 6 6-6" />
    </Svg>
  );
}

export function UndoIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h10a6 6 0 0 1 0 12h-3" />
    </Svg>
  );
}

export function RedoIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="m15 14 5-5-5-5" />
      <path d="M20 9H10a6 6 0 0 0 0 12h3" />
    </Svg>
  );
}

export function SaveIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z" />
      <path d="M17 21v-8H7v8" />
      <path d="M7 3v5h8" />
    </Svg>
  );
}

export function OpenIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
    </Svg>
  );
}

/** Sliders: view/appearance settings. */
export function SlidersIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M4 7h9M18 7h2M4 17h3M12 17h8" />
      <circle cx="15.5" cy="7" r="2" />
      <circle cx="9.5" cy="17" r="2" />
    </Svg>
  );
}

export function XIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M6 6l12 12M18 6 6 18" />
    </Svg>
  );
}

export function EyeIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12Z" />
      <circle cx="12" cy="12" r="2.5" />
    </Svg>
  );
}

/** Folder: stands for a group in the layer tree (groups have no colour of their own). */
export function FolderIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4l2 2.5h7A1.5 1.5 0 0 1 19 10v7.5A1.5 1.5 0 0 1 17.5 19h-13A1.5 1.5 0 0 1 3 17.5Z" />
    </Svg>
  );
}

/** Wrench crossed with a hammer (like a hammer-and-sickle emblem): the layers tools menu. */
export function ToolsIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      {/* Hammer: head at the top-left, handle down to the bottom-right. */}
      <g transform="rotate(-45 12 12)">
        <path d="M7.5 3.5h6.5v5H7.5z" />
        <path d="M10.75 8.5V21" />
      </g>
      {/* Wrench: jaw at the top-right, handle down to the bottom-left. */}
      <path d="M18.6 4.7a3.5 3.5 0 1 0 1.1 4.8" />
      <path d="m14.8 11-9.6 9.6" />
    </Svg>
  );
}

export function EyeOffIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M3 3l18 18" />
      <path d="M10.6 6.1A9.9 9.9 0 0 1 12 6c6.5 0 10 6 10 6a17 17 0 0 1-2.6 3.3" />
      <path d="M6.2 7.7A16.6 16.6 0 0 0 2 12s3.5 6.5 10 6.5a9.7 9.7 0 0 0 4.1-.9" />
    </Svg>
  );
}

/** Small "?" bubble with an instant custom popover (the native `title` tooltip has a long delay).
 * Rendered through a portal with fixed coordinates so it is never clipped by scrolling panels;
 * the bubble is measured first and clamped to the viewport on both axes.
 */
export function HelpHint({ text }: { text: string }) {
  const anchorRef = useRef<HTMLSpanElement>(null);
  const tipRef = useRef<HTMLSpanElement>(null);
  const [anchor, setAnchor] = useState<{ left: number; right: number; top: number } | null>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);

  const open = (): void => {
    const rect = anchorRef.current?.getBoundingClientRect();
    if (!rect) return;
    setAnchor({ left: rect.left, right: rect.right, top: rect.top });
  };
  const close = (): void => setAnchor(null);

  useLayoutEffect(() => {
    const tip = tipRef.current;
    if (!anchor || !tip) {
      setPosition(null);
      return;
    }
    const gap = 8;
    const width = tip.offsetWidth;
    const height = tip.offsetHeight;
    let left = anchor.right + gap;
    if (left + width > window.innerWidth - gap) left = anchor.left - width - gap;
    left = Math.min(Math.max(gap, left), Math.max(gap, window.innerWidth - width - gap));
    const top = Math.min(
      Math.max(gap, anchor.top - 6),
      Math.max(gap, window.innerHeight - height - gap),
    );
    setPosition({ left, top });
  }, [anchor, text]);

  useEffect(() => {
    if (!anchor) return;
    const hide = (): void => setAnchor(null);
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    return () => {
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('resize', hide);
    };
  }, [anchor]);

  return (
    <>
      <span
        ref={anchorRef}
        role="img"
        aria-label={text}
        tabIndex={0}
        onMouseEnter={open}
        onMouseLeave={close}
        onFocus={open}
        onBlur={close}
        className="inline-grid h-[11px] w-[11px] shrink-0 cursor-help place-items-center rounded-full border border-slate-600 text-[8px] leading-none text-slate-400 outline-none hover:border-slate-400 hover:text-slate-200 focus-visible:border-sky-500"
      >
        ?
      </span>
      {anchor &&
        createPortal(
          <span
            ref={tipRef}
            role="tooltip"
            style={{
              left: position?.left ?? 0,
              top: position?.top ?? 0,
              opacity: position ? 1 : 0,
            }}
            className="pointer-events-none fixed z-50 block w-60 rounded-md border border-slate-700 bg-slate-900/98 px-2.5 py-2 text-[11px] leading-snug text-slate-200 shadow-xl"
          >
            {text}
          </span>,
          document.body,
        )}
    </>
  );
}
