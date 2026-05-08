import { useEffect, useRef } from 'react';
import type { Group } from '../api';
import { MovieCard } from './MovieCard';

type Props = {
  groups: Group[];
  onSelect: (group: Group) => void;
  /** When true, focuses the first card on mount/whenever `groups` becomes
   *  non-empty. The caller normally passes the live TV-mode flag so desktop
   *  users don't get an unexpected auto-focus. */
  autoFocusFirst?: boolean;
};

export function MovieGrid({ groups, onSelect, autoFocusFirst = false }: Props) {
  const gridRef = useRef<HTMLDivElement | null>(null);
  // Track whether we've already auto-focused for this `groups` array — we
  // don't want the grid to keep stealing focus on every re-render (e.g.
  // when an unrelated state hop above triggers a parent re-render).
  const autoFocusedRef = useRef(false);

  // Reset the "have we auto-focused" guard whenever the underlying groups
  // identity changes (filter applied, page reloaded, etc).
  useEffect(() => {
    autoFocusedRef.current = false;
  }, [groups]);

  // TV mode: when the grid first has cards, drop focus onto the first one
  // so the remote starts on a navigable element.
  useEffect(() => {
    if (!autoFocusFirst) return;
    if (autoFocusedRef.current) return;
    if (!document.body.classList.contains('tv-mode')) return;
    const grid = gridRef.current;
    if (!grid) return;
    // The MovieCard component renders a single <button> as its root, and
    // each grid cell wraps exactly one MovieCard, so the first direct
    // child div's button is the first card.
    const first = grid.querySelector<HTMLButtonElement>(':scope > div > button');
    if (first) {
      first.focus();
      autoFocusedRef.current = true;
    }
  }, [groups, autoFocusFirst]);

  // Arrow-key navigation: only intercept when TV mode is on. The active
  // element must be one of our card buttons, and only horizontal/vertical
  // arrow keys do anything — every other key bubbles normally so things
  // like Tab still work.
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!document.body.classList.contains('tv-mode')) return;
    const key = e.key;
    if (
      key !== 'ArrowLeft' &&
      key !== 'ArrowRight' &&
      key !== 'ArrowUp' &&
      key !== 'ArrowDown'
    ) {
      return;
    }
    const grid = gridRef.current;
    if (!grid) return;
    // One <button> per cell (MovieCard's root element).
    const cards = Array.from(grid.querySelectorAll<HTMLButtonElement>(':scope > div > button'));
    if (cards.length === 0) return;
    const active = document.activeElement;
    const idx = cards.findIndex((c) => c === active);
    if (idx < 0) return;

    // Derive column count from layout: walk forward from index 0 and count
    // how many cards share the same `offsetTop` as the first row. This
    // is robust to Tailwind's responsive grid-cols breakpoints without
    // hard-coding them, and survives partial last rows naturally.
    const firstTop = cards[0].offsetTop;
    let cols = 0;
    for (const c of cards) {
      if (c.offsetTop === firstTop) cols++;
      else break;
    }
    if (cols < 1) cols = 1;

    let target = idx;
    if (key === 'ArrowLeft') target = idx - 1;
    else if (key === 'ArrowRight') target = idx + 1;
    else if (key === 'ArrowUp') target = idx - cols;
    else if (key === 'ArrowDown') target = idx + cols;

    if (target < 0 || target >= cards.length) return;
    e.preventDefault();
    cards[target].focus();
  };

  return (
    <div
      ref={gridRef}
      onKeyDown={onKeyDown}
      className="
        grid gap-x-6 gap-y-10
        grid-cols-2
        sm:grid-cols-3
        md:grid-cols-4
        lg:grid-cols-5
        xl:grid-cols-6
        animate-fade-in
      "
    >
      {groups.map((g, i) => (
        <div
          key={g.id}
          className="animate-rise-in"
          style={{
            animationDelay: `${Math.min(i, 12) * 30}ms`,
            animationFillMode: 'backwards',
            // Browser-level virtualisation: off-screen cards skip layout +
            // paint until they scroll into view. The intrinsic-size hint is
            // a rough estimate (poster aspect 2:3 at typical column width
            // + title block) so the scrollbar stays accurate before the
            // browser has measured each card.
            contentVisibility: 'auto',
            containIntrinsicSize: 'auto 400px',
          }}
        >
          <MovieCard group={g} onClick={() => onSelect(g)} />
        </div>
      ))}
    </div>
  );
}

export function MovieGridSkeleton({ count = 12 }: { count?: number }) {
  return (
    <div
      className="
        grid gap-x-6 gap-y-10
        grid-cols-2
        sm:grid-cols-3
        md:grid-cols-4
        lg:grid-cols-5
        xl:grid-cols-6
      "
    >
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex flex-col gap-3">
          <div
            className="w-full skeleton-shimmer"
            style={{ aspectRatio: '2 / 3', borderRadius: 2 }}
          />
          <div className="h-4 skeleton-shimmer w-3/4" style={{ borderRadius: 1 }} />
          <div className="h-3 skeleton-shimmer w-1/4" style={{ borderRadius: 1 }} />
        </div>
      ))}
    </div>
  );
}
