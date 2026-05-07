import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

// TrackMenu — compact dropdown for selecting an audio or subtitle track.
// Renders as a small chip in the player's bottom-strip overlay; on click
// it opens an upward-anchored frosted menu listing the available options.
// `value === null` represents "auto" (audio default) or "off" (subtitles).
//
// The menu is rendered via createPortal into document.body and positioned
// with `position: fixed` calculated from the trigger button's
// getBoundingClientRect. This bypasses the player container's
// `overflow:hidden`, which would otherwise clip the dropdown when it
// opens above the chip.
type Option = {
  value: number | null;
  label: string;
};

type Props = {
  label: string;
  options: Option[];
  value: number | null;
  onChange: (v: number | null) => void;
  disabled?: boolean;
};

// Truncate a label so it fits the chip without wrapping. The full label
// stays accessible via the dropdown menu and the button's title attr.
function truncate(s: string, max = 18): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}

const MENU_WIDTH = 220;
const MENU_GAP = 8; // px between trigger and menu

export function TrackMenu({
  label,
  options,
  value,
  onChange,
  disabled = false,
}: Props) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; bottom: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  // Close on click-outside / ESC. Listeners only attach while open so the
  // menu doesn't leak handlers when many TrackMenus mount simultaneously.
  useEffect(() => {
    if (!open) return;
    const onDocMouseDown = (e: MouseEvent) => {
      const trig = triggerRef.current;
      const menu = menuRef.current;
      if (e.target instanceof Node) {
        if (trig && trig.contains(e.target)) return;
        if (menu && menu.contains(e.target)) return;
      }
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDocMouseDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Recompute menu position whenever it opens, on scroll, or on resize —
  // so the dropdown follows the trigger if the page moves while open.
  useEffect(() => {
    if (!open) return;
    const compute = () => {
      const t = triggerRef.current;
      if (!t) return;
      const r = t.getBoundingClientRect();
      // Anchor the menu's bottom edge MENU_GAP px above the trigger's
      // top edge. `bottom` here is "viewport.height - menu.bottom", so we
      // express it as `vh - rect.top + GAP`.
      setPos({
        left: Math.max(8, Math.min(window.innerWidth - MENU_WIDTH - 8, r.left)),
        bottom: window.innerHeight - r.top + MENU_GAP,
      });
    };
    compute();
    window.addEventListener('scroll', compute, true);
    window.addEventListener('resize', compute);
    return () => {
      window.removeEventListener('scroll', compute, true);
      window.removeEventListener('resize', compute);
    };
  }, [open]);

  const current = options.find((o) => o.value === value);
  const currentLabel = current?.label ?? '—';

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          if (disabled) return;
          setOpen((o) => !o);
        }}
        disabled={disabled}
        title={`${label}: ${currentLabel}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`
          focus-ring
          inline-flex items-center gap-1.5
          rounded-full px-3 py-1.5
          text-[11px] uppercase tracking-[0.2em]
          bg-white/5 hover:bg-white/10 text-bone-200/85
          border border-white/10
          transition-colors
          disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-white/5
        `}
      >
        <span className="text-bone-300/60">{label}</span>
        <span className="text-bone-50 normal-case tracking-normal">
          {truncate(currentLabel)}
        </span>
        <svg
          width="9"
          height="9"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`text-bone-300/60 transition-transform ${open ? 'rotate-180' : ''}`}
          aria-hidden="true"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open && !disabled && pos &&
        createPortal(
          <div
            ref={menuRef}
            role="listbox"
            aria-label={label}
            className="
              fixed z-[100]
              max-h-72 overflow-y-auto
              bg-ink-900/95 backdrop-blur-md
              border border-white/10
              shadow-2xl
              py-1
            "
            style={{
              left: pos.left,
              bottom: pos.bottom,
              width: MENU_WIDTH,
              borderRadius: 8,
            }}
          >
            {options.map((opt) => {
              const active = opt.value === value;
              const key = opt.value === null ? '__null' : `v${opt.value}`;
              return (
                <button
                  key={key}
                  type="button"
                  role="option"
                  aria-selected={active}
                  onClick={() => {
                    onChange(opt.value);
                    setOpen(false);
                  }}
                  className={`
                    focus-ring
                    block w-full text-left
                    px-3 py-2
                    text-xs
                    transition-colors
                    ${active
                      ? 'bg-ember-400/[0.15] text-ember-100'
                      : 'text-bone-100/90 hover:bg-ink-800/80'}
                  `}
                >
                  <span className="flex items-center gap-2">
                    <span
                      className={`flex-shrink-0 inline-block w-1.5 h-1.5 rounded-full ${active ? 'bg-ember-300' : 'bg-bone-300/30'}`}
                    />
                    <span className="flex-1 min-w-0 truncate">{opt.label}</span>
                  </span>
                </button>
              );
            })}
          </div>,
          document.body,
        )}
    </>
  );
}
