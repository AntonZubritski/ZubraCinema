import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { fetchCategoryPage, type Group } from '../api';
import { MovieCard } from './MovieCard';

type Props = {
  slug: string;
  label: string;
  /** When true, skips the red icon medallion (used for utility rows like
   *  "Сейчас смотрят" that read as feed-style rather than a ranked list). */
  flat?: boolean;
};

type Status = 'loading' | 'success' | 'error';

const PREVIEW_COUNT = 15;

/**
 * One horizontal row on the home page in Lampa-CUB chrome: a red icon
 * medallion + bold section title + "Ещё" pill on the right, then a
 * horizontal-scrolling strip of posters underneath. Loads its own data,
 * aborts on unmount, and degrades to a muted inline error so a single
 * bad row can't break the home page.
 */
export function CategoryRow({ slug, label, flat = false }: Props): JSX.Element {
  const [status, setStatus] = useState<Status>('loading');
  const [groups, setGroups] = useState<Group[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const stripRef = useRef<HTMLDivElement | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    const ac = new AbortController();
    abortRef.current = ac;
    setStatus('loading');
    (async () => {
      try {
        const res = await fetchCategoryPage(slug, 0, ac.signal);
        if (ac.signal.aborted) return;
        setGroups(res.groups.slice(0, PREVIEW_COUNT));
        setStatus('success');
      } catch (err) {
        if (ac.signal.aborted) return;
        if (err instanceof Error && err.name === 'AbortError') return;
        setStatus('error');
      }
    })();

    return () => {
      ac.abort();
    };
  }, [slug]);

  const handleSelect = useCallback(
    (group: Group) => {
      navigate(`/movie/${encodeURIComponent(group.id)}`, { state: { group } });
    },
    [navigate],
  );

  const scrollBy = useCallback((delta: number) => {
    stripRef.current?.scrollBy({ left: delta, behavior: 'smooth' });
  }, []);

  // TV-mode arrow-key nav within a single horizontal strip. Only ArrowLeft
  // and ArrowRight are captured — ArrowUp/Down are intentionally let
  // through so the user can move *between* rows using whatever default
  // focus-movement / page-scroll behaviour the browser provides. Wrapping
  // around at strip boundaries is also intentionally NOT done; it would
  // confuse a user who's still pressing right to escape the row.
  const onKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!document.body.classList.contains('tv-mode')) return;
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const strip = stripRef.current;
    if (!strip) return;
    const cards = Array.from(strip.querySelectorAll<HTMLButtonElement>(':scope > div > button'));
    if (cards.length === 0) return;
    const idx = cards.findIndex((c) => c === document.activeElement);
    if (idx < 0) return;
    const target = e.key === 'ArrowLeft' ? idx - 1 : idx + 1;
    if (target < 0 || target >= cards.length) return;
    e.preventDefault();
    cards[target].focus();
  }, []);

  // Hide native scrollbar: Tailwind has no util, so combine Firefox's
  // `scrollbarWidth: 'none'` style with an arbitrary-variant for WebKit/Edge.
  const stripClass =
    'flex gap-3 overflow-x-auto snap-x snap-mandatory pb-2 [&::-webkit-scrollbar]:hidden';
  const stripStyle = { scrollbarWidth: 'none' as const };

  return (
    <section className="mb-10 group/row relative">
      <div className="mb-4 flex items-center gap-3">
        {!flat && <RowMedallion slug={slug} />}
        <h2 className="text-bone-50 text-[20px] md:text-[22px] font-medium tracking-tight truncate">
          {label}
        </h2>

        <div className="flex-1" />

        <Link
          to={`/category/${slug}`}
          className="
            focus-ring
            inline-flex items-center
            px-3.5 py-1
            rounded-full
            text-[12px] tracking-tight
            text-bone-200/85
            bg-white/[0.04] hover:bg-white/[0.10]
            border border-white/[0.06]
            transition-colors
          "
        >
          Ещё
        </Link>
      </div>

      {status === 'loading' && (
        <div className={stripClass} style={stripStyle}>
          {Array.from({ length: 12 }).map((_, i) => (
            <div
              key={i}
              className="flex-shrink-0 w-[150px] aspect-[2/3] rounded-md skeleton-shimmer"
            />
          ))}
        </div>
      )}

      {status === 'error' && (
        <p className="text-bone-300/50 text-sm">
          Не удалось загрузить — попробуйте позже
        </p>
      )}

      {status === 'success' && groups.length > 0 && (
        <div className="relative">
          <div ref={stripRef} className={stripClass} style={stripStyle} onKeyDown={onKeyDown}>
            {groups.map((g) => (
              <div key={g.id} className="flex-shrink-0 w-[150px] snap-start">
                <MovieCard group={g} onClick={() => handleSelect(g)} />
              </div>
            ))}
          </div>
          <ScrollArrow side="left" onClick={() => scrollBy(-600)} />
          <ScrollArrow side="right" onClick={() => scrollBy(600)} />
        </div>
      )}
    </section>
  );
}

// RowMedallion — Lampa-CUB-style filled red circle with a white pictogram.
// Sits left of the section title and gives the row a visual anchor like
// the trophy icons in the reference screenshots.
function RowMedallion({ slug }: { slug: string }): JSX.Element {
  return (
    <span
      className="
        inline-flex items-center justify-center
        w-9 h-9 rounded-full
        bg-ember-500 text-white
        shadow-[0_4px_12px_-2px_rgba(220,47,59,0.5)]
        shrink-0
      "
      aria-hidden="true"
    >
      <RowIcon slug={slug} />
    </span>
  );
}

function RowIcon({ slug }: { slug: string }) {
  const common = {
    width: 16,
    height: 16,
    viewBox: '0 0 24 24',
    fill: 'none' as const,
    stroke: 'currentColor' as const,
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  if (slug.startsWith('series')) {
    return (
      <svg {...common}>
        <rect x="3" y="6" width="18" height="12" rx="1.5" />
        <path d="M8 21h8M12 18v3" />
      </svg>
    );
  }
  if (slug === 'animation' || slug === 'anime') {
    return (
      <svg {...common}>
        <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" />
      </svg>
    );
  }
  if (slug.startsWith('horror')) {
    return (
      <svg {...common}>
        <path d="M5 21V11a7 7 0 1 1 14 0v10l-2-1.5L15 21l-2-1.5L11 21l-2-1.5L7 21z" />
      </svg>
    );
  }
  if (slug.startsWith('comedy')) {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="9" />
        <path d="M9 14c.7 1 1.8 1.5 3 1.5s2.3-.5 3-1.5" />
      </svg>
    );
  }
  if (slug.startsWith('action') || slug.startsWith('thriller')) {
    return (
      <svg {...common}>
        <path d="M12 21c4 0 7-2.5 7-6.5 0-3-2-4.5-2.5-6.5C15.5 5 14 4 12 3c.5 3-1 4.5-2.5 6S7 12 7 14.5C7 18.5 9 21 12 21z" />
      </svg>
    );
  }
  // Trophy default — used for "Топ 100" / movies / unrecognised slugs.
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M7 4h10v3a5 5 0 0 1-3 4.58V14h-1v-2.42A5 5 0 0 1 10 11.58V14H9v-2.42A5 5 0 0 1 7 7V4zm-2.5 1H6v2.5A2.5 2.5 0 0 1 4.5 5zm15 0H18v2.5A2.5 2.5 0 0 0 19.5 5zM10 15h4l1 4H9l1-4zm-2 5h8v1.5H8z" />
    </svg>
  );
}

function ScrollArrow({ side, onClick }: { side: 'left' | 'right'; onClick: () => void }) {
  const isLeft = side === 'left';
  // Soft radial-fade gutter: the arrow sits on a circular pill in the
  // middle, surrounded by a wide gradient that eases the row's posters
  // out behind it. Less hard-cut than a flat dark column.
  const fadeBg = isLeft
    ? 'bg-gradient-to-r from-ink-950/90 via-ink-950/45 to-transparent'
    : 'bg-gradient-to-l from-ink-950/90 via-ink-950/45 to-transparent';
  return (
    <div
      className={`hidden md:flex absolute ${isLeft ? 'left-0' : 'right-0'} top-0 bottom-2 z-10 w-20 items-center ${isLeft ? 'justify-start pl-2' : 'justify-end pr-2'} ${fadeBg} opacity-0 group-hover/row:opacity-100 transition-opacity pointer-events-none`}
    >
      <button
        type="button"
        onClick={onClick}
        aria-label={isLeft ? 'Прокрутить назад' : 'Прокрутить вперёд'}
        className="
          focus-ring pointer-events-auto
          flex items-center justify-center
          w-11 h-11 rounded-full
          bg-ink-900/85 hover:bg-ink-800
          text-bone-50 text-2xl leading-none
          ring-1 ring-white/10
          shadow-lg shadow-black/40
          transition-colors
        "
      >
        {isLeft ? '‹' : '›'}
      </button>
    </div>
  );
}
