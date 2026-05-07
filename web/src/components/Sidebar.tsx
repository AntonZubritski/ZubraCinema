import { useEffect, useMemo } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { CATEGORIES, type CategoryDescriptor } from '../lib/categories';

type Props = {
  open: boolean;
  onClose: () => void;
  adultEnabled: boolean;
};

// Lampa-CUB-style left navigation drawer. Slides in from the left when the
// hamburger button is clicked. Backdrop click + ESC close it; body scroll
// locks while open. Categories come from `lib/categories.ts` so the home
// page and the drawer always agree on what's available.
export function Sidebar({ open, onClose, adultEnabled }: Props): JSX.Element {
  const location = useLocation();

  // ESC closes — same pattern as SettingsModal/InstallPanel.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Push UX: we deliberately DON'T lock body scroll. Hiding the scrollbar
  // makes the content jump horizontally as the gutter disappears. The
  // `scrollbar-gutter: stable` rule in index.css reserves the gutter so
  // toggling overflow wouldn't help anyway. The drawer's own overflow-y
  // contains its scroll within itself.

  // Split visible categories into "main top-level" (movies/series/anime —
  // the rutor top-level set), "genres" (foreign genre rows), and "adult"
  // (only when allowed). The split mirrors the home page row groupings.
  const groups = useMemo(() => splitCategories(CATEGORIES, adultEnabled), [adultEnabled]);

  const linkCls = (active: boolean) =>
    [
      'group/link relative flex items-center gap-3 pl-6 pr-5 py-2.5 text-[13px] tracking-wide transition-all',
      // Lampa CUB-style left accent bar via inset box-shadow when active.
      // Rendering it via shadow keeps the row's own padding stable so text
      // doesn't shift when navigating.
      active
        ? 'text-bone-50 bg-ember-400/[0.10] font-medium shadow-[inset_3px_0_0_0_theme(colors.ember.400)]'
        : 'text-bone-200/75 hover:bg-white/[0.04] hover:text-bone-50',
    ].join(' ');

  const isActive = (path: string) => location.pathname === path;

  return (
    <>
      {/* Dim backdrop — click to close. Sits below the drawer (z-40) so the
          drawer (z-50) renders above it. Pointer events are gated by the
          `open` state via opacity transition + pointer-events-none class. */}
      <div
        onClick={onClose}
        aria-hidden="true"
        className={[
          'fixed inset-0 z-40',
          'bg-black/55 backdrop-blur-[2px]',
          'transition-opacity duration-240 ease-out',
          open ? 'opacity-100' : 'opacity-0 pointer-events-none',
        ].join(' ')}
      />

      {/* Drawer — overlay UX: slides over the page on top of the dim. */}
      <aside
        className={[
          'fixed top-0 left-0 bottom-0 z-50 w-72 overflow-y-auto',
          'bg-ink-950/95 backdrop-blur-xl border-r border-white/[0.05]',
          'shadow-[8px_0_30px_-12px_rgba(0,0,0,0.7)]',
          'transition-transform duration-240 ease-out will-change-transform',
          open ? 'translate-x-0' : '-translate-x-full',
        ].join(' ')}
        role="dialog"
        aria-modal="true"
        aria-label="Навигация"
      >
        {/* Header */}
        <header className="px-5 py-5 border-b border-white/[0.04] flex items-center justify-between sticky top-0 bg-ink-900/95 backdrop-blur-xl z-10">
          <Link
            to="/"
            onClick={onClose}
            className="flex items-center"
            aria-label="ZubraCinema — главная"
          >
            <img src="/logo.svg" alt="ZubraCinema" className="h-9" />
          </Link>
          <button
            type="button"
            onClick={onClose}
            className="
              focus-ring
              text-bone-300/60 hover:text-bone-50 hover:bg-white/5
              transition-all p-1.5 rounded-md
            "
            aria-label="Закрыть"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M6 6l12 12" />
              <path d="M18 6l-12 12" />
            </svg>
          </button>
        </header>

        <nav className="py-3">
          {/* Static main pages */}
          <Link to="/" onClick={onClose} className={linkCls(isActive('/'))}>
            <Icon name="home" />
            <span>Главная</span>
          </Link>

          <Separator />

          {groups.main.map((c) => {
            const path = `/category/${c.slug}`;
            return (
              <Link
                key={c.slug}
                to={path}
                onClick={onClose}
                className={linkCls(isActive(path))}
              >
                <Icon name={iconForSlug(c.slug)} />
                <span>{c.label}</span>
              </Link>
            );
          })}

          {groups.genres.length > 0 && <Separator />}
          {groups.genres.map((c) => {
            const path = `/category/${c.slug}`;
            return (
              <Link
                key={c.slug}
                to={path}
                onClick={onClose}
                className={linkCls(isActive(path))}
              >
                <Icon name={iconForSlug(c.slug)} />
                <span>{c.label}</span>
              </Link>
            );
          })}

          {groups.adult.length > 0 && <Separator />}
          {groups.adult.map((c) => {
            const path = `/category/${c.slug}`;
            return (
              <Link
                key={c.slug}
                to={path}
                onClick={onClose}
                className={linkCls(isActive(path))}
              >
                <Icon name="adult" />
                <span>{c.label}</span>
              </Link>
            );
          })}
        </nav>
      </aside>
    </>
  );
}

function Separator() {
  return <div className="my-3 mx-5 border-t border-white/[0.04]" aria-hidden="true" />;
}

function splitCategories(all: readonly CategoryDescriptor[], adultEnabled: boolean) {
  const visible = all.filter((c) => !c.adult || adultEnabled);
  const mainSlugs = new Set([
    'movies-foreign',
    'movies-russian',
    'series-foreign',
    'series-russian',
    'animation',
    'anime',
  ]);
  const main = visible.filter((c) => mainSlugs.has(c.slug));
  const genres = visible.filter((c) => !mainSlugs.has(c.slug) && !c.adult);
  const adult = visible.filter((c) => c.adult);
  return { main, genres, adult };
}

// Map a category slug to one of the inline icons below. We don't try to
// reflect every nuance in the icon — the label carries the meaning. The
// icon is just a visual anchor so the row scans quickly.
function iconForSlug(slug: string): IconName {
  if (slug.startsWith('series')) return 'tv';
  if (slug === 'animation') return 'palette';
  if (slug === 'anime') return 'sparkle';
  if (slug.startsWith('movies')) return 'film';
  if (slug.startsWith('action')) return 'fire';
  if (slug.startsWith('comedy')) return 'smile';
  if (slug.startsWith('drama')) return 'mask';
  if (slug.startsWith('horror')) return 'ghost';
  if (slug.startsWith('scifi')) return 'rocket';
  if (slug.startsWith('thriller')) return 'mask';
  if (slug.startsWith('adventure')) return 'compass';
  if (slug.startsWith('fantasy')) return 'sparkle';
  if (slug.startsWith('detective')) return 'magnifier';
  if (slug.startsWith('melodrama')) return 'heart';
  if (slug.startsWith('adult')) return 'adult';
  return 'film';
}

type IconName =
  | 'home'
  | 'film'
  | 'tv'
  | 'palette'
  | 'sparkle'
  | 'fire'
  | 'smile'
  | 'mask'
  | 'ghost'
  | 'rocket'
  | 'compass'
  | 'magnifier'
  | 'heart'
  | 'adult';

// Inline 16x16 monochrome SVGs. `currentColor` so they pick up the link's
// text colour (and shift to ember on hover/active without extra styling).
function Icon({ name }: { name: IconName }) {
  const common = {
    width: 16,
    height: 16,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.6,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    className: 'shrink-0 opacity-80',
  };
  switch (name) {
    case 'home':
      return (
        <svg {...common}>
          <path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" />
        </svg>
      );
    case 'film':
      return (
        <svg {...common}>
          <rect x="3" y="4" width="18" height="16" rx="1" />
          <path d="M3 8h18M3 16h18M7 4v16M17 4v16" />
        </svg>
      );
    case 'tv':
      return (
        <svg {...common}>
          <rect x="3" y="5" width="18" height="13" rx="1" />
          <path d="M8 21h8M12 18v3" />
        </svg>
      );
    case 'palette':
      return (
        <svg {...common}>
          <path d="M12 3a9 9 0 1 0 0 18c1.5 0 2-1 2-2 0-1.5-1-2-1-3s.5-1.5 2-1.5h2a4 4 0 0 0 4-4 8 8 0 0 0-9-7.5z" />
          <circle cx="7.5" cy="11" r="1" />
          <circle cx="10" cy="7" r="1" />
          <circle cx="14.5" cy="7" r="1" />
          <circle cx="17" cy="11" r="1" />
        </svg>
      );
    case 'sparkle':
      return (
        <svg {...common}>
          <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" />
          <path d="M19 17l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z" />
        </svg>
      );
    case 'fire':
      return (
        <svg {...common}>
          <path d="M12 21c4 0 7-2.5 7-6.5 0-3-2-4.5-2.5-6.5C15.5 5 14 4 12 3c.5 3-1 4.5-2.5 6S7 12 7 14.5C7 18.5 9 21 12 21z" />
          <path d="M12 21c2 0 3.5-1.5 3.5-3.5 0-1.5-1-2-1.5-3.5-.8 1.5-2.5 1.7-2.5 3.5 0 1.5-1 1.5-1 3 0 .3.5.5 1.5.5z" />
        </svg>
      );
    case 'smile':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M9 14c.7 1 1.8 1.5 3 1.5s2.3-.5 3-1.5" />
          <circle cx="9" cy="10" r="0.7" fill="currentColor" />
          <circle cx="15" cy="10" r="0.7" fill="currentColor" />
        </svg>
      );
    case 'mask':
      return (
        <svg {...common}>
          <path d="M4 6c4-1 12-1 16 0v6a8 8 0 0 1-16 0z" />
          <path d="M9 11.5c.6.5 1.4.5 2 0M13 11.5c.6.5 1.4.5 2 0" />
        </svg>
      );
    case 'ghost':
      return (
        <svg {...common}>
          <path d="M5 21V11a7 7 0 1 1 14 0v10l-2-1.5L15 21l-2-1.5L11 21l-2-1.5L7 21z" />
          <circle cx="10" cy="11" r="0.7" fill="currentColor" />
          <circle cx="14" cy="11" r="0.7" fill="currentColor" />
        </svg>
      );
    case 'rocket':
      return (
        <svg {...common}>
          <path d="M14 4c4 0 6 2 6 6-2 0-4 1-6 3l-4-4c2-2 3-4 4-5z" />
          <path d="M10 9l-4 1-2 4 4-1M15 14l-1 4-4 2 1-4" />
          <circle cx="15" cy="9" r="1.2" />
        </svg>
      );
    case 'compass':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M15.5 8.5l-2 5-5 2 2-5z" />
        </svg>
      );
    case 'magnifier':
      return (
        <svg {...common}>
          <circle cx="11" cy="11" r="6" />
          <path d="M20 20l-4.5-4.5" />
        </svg>
      );
    case 'heart':
      return (
        <svg {...common}>
          <path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.5-7 10-7 10z" />
        </svg>
      );
    case 'adult':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M8 9v6M16 9v6M8 12h8" />
        </svg>
      );
  }
}
