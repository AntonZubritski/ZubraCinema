import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  ApiError,
  fetchCategoryPage,
  fetchFeatured,
  getSettings,
  searchGroups,
  type Group,
} from '../api';
import { CategoryRow } from '../components/CategoryRow';
import { MovieCard } from '../components/MovieCard';
import { SearchBar } from '../components/SearchBar';
import { MovieGrid, MovieGridSkeleton } from '../components/MovieGrid';
import { SettingsModal } from '../components/SettingsModal';
import { SetupBanner } from '../components/SetupBanner';
import { Sidebar } from '../components/Sidebar';
import { SortBar } from '../components/SortBar';
import { TopBar } from '../components/TopBar';
import { CATEGORIES, type CategoryDescriptor } from '../lib/categories';
import type { Language } from '../lib/lang';
import { filterGroups, sortGroups, type QualityBucket, type SortKey } from '../lib/sortFilter';
import { DEFAULT_STATE, parseState, serializeState } from '../lib/url';

type Status = 'idle' | 'loading' | 'success' | 'error';

export default function SearchPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initial = useMemo(() => parseState(searchParams), [searchParams]);

  const [query, setQuery] = useState(initial.q);
  const [committedQuery, setCommittedQuery] = useState(initial.q);
  const [sort, setSort] = useState<SortKey>(initial.sort);
  const [langs, setLangs] = useState<Language[]>(initial.langs);
  const [qualities, setQualities] = useState<QualityBucket[]>(initial.qualities);
  // scope = "" means "Везде" → /api/search; non-empty = a CATEGORIES.slug,
  // in which case we fetch /api/category/{slug}?page=0 and filter client-side
  // by `q` (case-insensitive substring on group.title).
  const [scope, setScope] = useState<string>(initial.scope ?? '');

  const [status, setStatus] = useState<Status>('idle');
  const [groups, setGroups] = useState<Group[]>([]);
  const [errorText, setErrorText] = useState<string>('');
  const [mode, setMode] = useState<'featured' | 'search'>(
    initial.q.trim().length > 0 ? 'search' : 'featured',
  );
  const [showSettings, setShowSettings] = useState(false);
  const [showSidebar, setShowSidebar] = useState(false);
  const [showSearchOverlay, setShowSearchOverlay] = useState(false);
  const [adultEnabled, setAdultEnabled] = useState<boolean>(false);
  const [section, setSection] = useState<'movies' | 'adult'>('movies');
  // Ambient backdrop URL — populated from the first featured-row poster on
  // mount. Renders behind the entire home page to give it the cinematic
  // "always-on still" feel of Lampa CUB. When the user hovers a card, the
  // global HoverBackdrop layer crossfades on top of this one.
  const [ambientBackdrop, setAmbientBackdrop] = useState<string>('');

  const abortRef = useRef<AbortController | null>(null);
  const navigate = useNavigate();

  // Fetch the first poster from the top featured row to use as ambient
  // backdrop. Best-effort — if it fails we just don't show a backdrop and
  // the page falls back to its normal dark canvas.
  useEffect(() => {
    if (mode !== 'featured') return;
    let cancelled = false;
    const ac = new AbortController();
    void (async () => {
      try {
        const res = await fetchCategoryPage('movies-foreign', 0, ac.signal);
        if (cancelled || ac.signal.aborted) return;
        const first = res.groups.find((g) => g.posterUrl.length > 0);
        if (first) setAmbientBackdrop(first.posterUrl);
      } catch {
        // Backdrop is decorative — silent failure is fine.
      }
    })();
    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [mode]);

  // Pull the 18+ flag from the backend on mount and again when the
  // SettingsModal closes. Without re-fetching on close, the home page
  // wouldn't reflect a fresh toggle until the next full page load.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const s = await getSettings();
        if (cancelled) return;
        const enabled = Boolean(s.adult);
        setAdultEnabled(enabled);
        if (!enabled) setSection('movies');
      } catch {
        // best-effort — defaults to off
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [showSettings]);

  const visibleCategories = useMemo(() => {
    if (!adultEnabled) return CATEGORIES.filter((c) => !c.adult);
    if (section === 'adult') return CATEGORIES.filter((c) => c.adult);
    return CATEGORIES.filter((c) => !c.adult);
  }, [adultEnabled, section]);

  const runSearch = useCallback(async (q: string, scopeSlug: string) => {
    const trimmed = q.trim();
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    setCommittedQuery(trimmed);

    if (trimmed.length === 0) {
      setGroups([]);
      setErrorText('');
      setMode('featured');
      setStatus('idle');
      return;
    }

    setStatus('loading');
    setErrorText('');

    try {
      let results: Group[];
      if (scopeSlug.length > 0) {
        // Scoped search: fetch the first page of the category, then filter
        // client-side by case-insensitive substring on title. The category
        // listing is already pre-filtered to the genre/section, so this is
        // effectively "search within X".
        const page = await fetchCategoryPage(scopeSlug, 0, ac.signal);
        if (ac.signal.aborted) return;
        const needle = trimmed.toLowerCase();
        results = page.groups.filter((g) => g.title.toLowerCase().includes(needle));
      } else {
        results = await searchGroups(trimmed, ac.signal);
        if (ac.signal.aborted) return;
      }
      setGroups(results);
      setMode('search');
      setStatus('success');
    } catch (err) {
      if (ac.signal.aborted) return;
      if (err instanceof Error && err.name === 'AbortError') return;
      if (err instanceof ApiError) {
        setErrorText(err.message);
      } else if (err instanceof Error) {
        setErrorText(err.message);
      } else {
        setErrorText('Something went wrong');
      }
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    void runSearch(initial.q, initial.scope ?? '');
    return () => {
      abortRef.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const next = serializeState({ q: committedQuery, sort, langs, qualities, scope });
    const current = searchParams.toString();
    if (next.toString() !== current) {
      setSearchParams(next, { replace: true });
    }
  }, [committedQuery, sort, langs, qualities, scope, searchParams, setSearchParams]);

  const handleSubmit = useCallback(() => {
    void runSearch(query, scope);
    setShowSearchOverlay(false);
  }, [query, scope, runSearch]);

  const handleSelect = useCallback(
    (group: Group) => {
      navigate(`/movie/${encodeURIComponent(group.id)}`, { state: { group } });
    },
    [navigate],
  );

  const visibleGroups = useMemo(() => {
    const filtered = filterGroups(groups, langs, qualities);
    return sortGroups(filtered, sort);
  }, [groups, langs, qualities, sort]);

  const showSortBar = mode === 'search' && status === 'success' && groups.length > 0;
  const trimmedQuery = committedQuery;

  return (
    <div className="grain min-h-screen relative">
      {mode === 'featured' && (
        <AmbientBackdrop url={ambientBackdrop} />
      )}

      <TopBar
        onMenu={() => setShowSidebar(true)}
        onSettings={() => setShowSettings(true)}
        onSearch={() => setShowSearchOverlay((v) => !v)}
      />

      <Sidebar
        open={showSidebar}
        onClose={() => setShowSidebar(false)}
        adultEnabled={adultEnabled}
      />

      {showSearchOverlay && (
        <SearchOverlay
          value={query}
          onChange={setQuery}
          onSubmit={handleSubmit}
          onClose={() => setShowSearchOverlay(false)}
          loading={status === 'loading'}
          scope={scope}
          onScopeChange={setScope}
          scopeOptions={visibleCategories}
        />
      )}

      <div className="relative z-10 max-w-[1500px] mx-auto px-5 lg:px-8 pt-4 pb-24">
        <main>
          {mode === 'featured' ? (
            <>
              <div className="mb-6">
                <SetupBanner />
              </div>
              {adultEnabled && (
                <div className="mb-6 flex items-center gap-1 border-b border-white/[0.06]">
                  <SectionTab
                    label="Кино"
                    active={section === 'movies'}
                    onClick={() => setSection('movies')}
                  />
                  <SectionTab
                    label="18+"
                    active={section === 'adult'}
                    onClick={() => setSection('adult')}
                  />
                </div>
              )}
              {/* "Новинки кино" — feed row pulling from /api/featured. Sits
                  above the category rows; visible only in the regular
                  movies section (skipped on the 18+ tab — /api/featured
                  is non-adult and would clutter the adult catalogue). */}
              {section === 'movies' && (
                <FeaturedRow onSelect={handleSelect} />
              )}
              {visibleCategories.map((c) => (
                <CategoryRow key={c.slug} slug={c.slug} label={c.label} />
              ))}
            </>
          ) : (
            <>
              <div className="mb-6 mt-4">
                <SetupBanner />
              </div>

              {showSortBar && (
                <SortBar
                  sort={sort}
                  langs={langs}
                  qualities={qualities}
                  onSortChange={setSort}
                  onLangsChange={setLangs}
                  onQualitiesChange={setQualities}
                />
              )}

              {status === 'loading' && (
                <>
                  <SectionLabel>Searching</SectionLabel>
                  <MovieGridSkeleton />
                </>
              )}

              {status === 'error' && (
                <ErrorState message={errorText} onRetry={() => void runSearch(query, scope)} />
              )}

              {status === 'success' && groups.length === 0 && (
                <NoResultsState query={trimmedQuery} />
              )}

              {status === 'success' && groups.length > 0 && (
                <>
                  <SectionLabel>
                    Результаты для{' '}
                    <span className="text-bone-50">«{trimmedQuery}»</span>
                    <span className="text-bone-300/40 ml-2">
                      · {visibleGroups.length} из {groups.length}
                    </span>
                  </SectionLabel>
                  {visibleGroups.length === 0 ? (
                    <FilteredOutState
                      onReset={() => {
                        setLangs([...DEFAULT_STATE.langs]);
                        setQualities([...DEFAULT_STATE.qualities]);
                      }}
                    />
                  ) : (
                    <MovieGrid groups={visibleGroups} onSelect={handleSelect} />
                  )}
                </>
              )}
            </>
          )}
        </main>
      </div>
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
    </div>
  );
}

// AmbientBackdrop — full-bleed cinematic still pinned to the top of the
// viewport. Heavy darken so foreground (TopBar text, posters) stays
// readable. Opacity-fades in once the URL loads. Lives at z-0 below all
// content; the global HoverBackdropProvider (z-3) crossfades on top.
function AmbientBackdrop({ url }: { url: string }) {
  if (!url) return null;
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-x-0 top-0 z-0 h-[80vh] overflow-hidden"
    >
      <div
        className="absolute inset-0 bg-cover bg-center animate-fade-in"
        style={{ backgroundImage: `url(${url})`, filter: 'blur(2px) saturate(1.05)' }}
      />
      {/* Dark vignette + fade-to-page-bg at the bottom so the seam where
          the backdrop ends and the page bg starts is invisible. */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'linear-gradient(to bottom, rgba(8,9,13,0.55) 0%, rgba(8,9,13,0.78) 55%, rgba(8,9,13,1) 100%)',
        }}
      />
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse 80% 60% at 50% 30%, rgba(0,0,0,0) 0%, rgba(8,9,13,0.55) 100%)',
        }}
      />
    </div>
  );
}

// SearchOverlay — drops down from below the TopBar when the search icon
// is clicked. Click on the dimmed backdrop or press Escape to close.
// The scope pill sits above the search bar (left-aligned within the same
// max-w-3xl column) and lets the user restrict the search to a single
// category — when set, runSearch fetches /api/category/{slug} and filters
// client-side by query, instead of hitting the global /api/search.
function SearchOverlay({
  value,
  onChange,
  onSubmit,
  onClose,
  loading,
  scope,
  onScopeChange,
  scopeOptions,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onClose: () => void;
  loading: boolean;
  scope: string;
  onScopeChange: (slug: string) => void;
  scopeOptions: readonly CategoryDescriptor[];
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-40 animate-fade-in">
      <div
        className="absolute inset-0 bg-black/55 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="absolute inset-x-0 top-14 px-5 lg:px-8 pt-6">
        <div className="max-w-3xl mx-auto">
          <div className="mb-3 flex items-center">
            <ScopePicker
              scope={scope}
              onChange={onScopeChange}
              options={scopeOptions}
            />
          </div>
          <SearchBar
            value={value}
            onChange={onChange}
            onSubmit={onSubmit}
            loading={loading}
          />
        </div>
      </div>
    </div>
  );
}

// ScopePicker — pill button + dropdown showing the active search scope
// ("Везде" by default). Sits to the LEFT of the search input (above it
// in the column flow). Click toggles the panel; click-outside or Escape
// (handled by the parent SearchOverlay) closes it.
function ScopePicker({
  scope,
  onChange,
  options,
}: {
  scope: string;
  onChange: (slug: string) => void;
  options: readonly CategoryDescriptor[];
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // Click-outside to close. Listen on mousedown so the toggle button's own
  // click still flips state; the panel itself stops propagation below.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);

  const activeLabel = useMemo(() => {
    if (scope.length === 0) return 'Везде';
    const c = options.find((o) => o.slug === scope);
    return c ? c.label : 'Везде';
  }, [scope, options]);

  return (
    <div ref={wrapRef} className="relative" onMouseDown={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="
          focus-ring
          inline-flex items-center gap-2
          px-3.5 py-1.5
          rounded-full
          text-[12px] tracking-tight font-medium
          text-bone-100
          bg-white/[0.06] hover:bg-white/[0.12]
          border border-white/[0.08]
          transition-colors
        "
      >
        <span className="text-bone-300/60 text-[10px] uppercase tracking-[0.18em]">
          Где
        </span>
        <span>{activeLabel}</span>
        <svg
          width="10"
          height="10"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className={`transition-transform ${open ? 'rotate-180' : ''}`}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div
          role="listbox"
          className="
            absolute left-0 top-[calc(100%+6px)] z-50
            min-w-[220px] max-h-[60vh]
            overflow-y-auto
            bg-ink-900/95 backdrop-blur-md
            border border-ink-700/80
            shadow-[0_12px_32px_-8px_rgba(0,0,0,0.6)]
            py-1
          "
          style={{ borderRadius: 10 }}
        >
          <ScopeOption
            label="Везде"
            active={scope.length === 0}
            onClick={() => {
              onChange('');
              setOpen(false);
            }}
          />
          <div className="my-1 mx-3 h-px bg-white/[0.06]" />
          {options.map((c) => (
            <ScopeOption
              key={c.slug}
              label={c.label}
              active={scope === c.slug}
              onClick={() => {
                onChange(c.slug);
                setOpen(false);
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ScopeOption({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={active}
      onClick={onClick}
      className={`
        focus-ring
        block w-full text-left
        px-4 py-2
        text-[13px] tracking-tight
        transition-colors
        ${active
          ? 'text-ember-200 bg-ember-400/[0.08]'
          : 'text-bone-100 hover:bg-white/[0.06]'}
      `}
    >
      {label}
    </button>
  );
}

// FeaturedRow — "Новинки кино" horizontal feed pinned to the top of the
// home page. Visually mirrors CategoryRow's strip (same card size, same
// hidden-scrollbar layout, same hover-revealed scroll arrows) but pulls
// from /api/featured (rutor latest HD, sorted by recency on the backend)
// and is intentionally not clickable as a section — there's no
// /category/featured destination, so the eyebrow has no "Ещё" arrow.
// Failure mode: render nothing. The home page must never break because
// the featured fetch hiccupped.
const FEATURED_PREVIEW = 15;

function FeaturedRow({ onSelect }: { onSelect: (g: Group) => void }) {
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [groups, setGroups] = useState<Group[]>([]);
  const stripRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    setStatus('loading');
    (async () => {
      try {
        const res = await fetchFeatured(ac.signal);
        if (ac.signal.aborted) return;
        setGroups(res.slice(0, FEATURED_PREVIEW));
        setStatus('success');
      } catch (err) {
        if (ac.signal.aborted) return;
        if (err instanceof Error && err.name === 'AbortError') return;
        setStatus('error');
      }
    })();
    return () => ac.abort();
  }, []);

  const scrollBy = useCallback((delta: number) => {
    stripRef.current?.scrollBy({ left: delta, behavior: 'smooth' });
  }, []);

  // Silent failure: don't render the section at all on error so a flaky
  // /api/featured fetch can't visually clutter the home page.
  if (status === 'error') return null;

  const stripClass =
    'flex gap-3 overflow-x-auto snap-x snap-mandatory pb-2 [&::-webkit-scrollbar]:hidden';
  const stripStyle = { scrollbarWidth: 'none' as const };

  return (
    <section className="mb-10 group/row relative">
      <div className="mb-8 flex items-center gap-4">
        <span className="text-bone-300/50 text-[11px] uppercase tracking-[0.25em]">
          Новинки кино
        </span>
        <span className="flex-1 h-px bg-ink-700/60" />
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

      {status === 'success' && groups.length > 0 && (
        <div className="relative">
          <div ref={stripRef} className={stripClass} style={stripStyle}>
            {groups.map((g) => (
              <div key={g.id} className="flex-shrink-0 w-[150px] snap-start">
                <MovieCard group={g} onClick={() => onSelect(g)} />
              </div>
            ))}
          </div>
          <FeaturedScrollArrow side="left" onClick={() => scrollBy(-600)} />
          <FeaturedScrollArrow side="right" onClick={() => scrollBy(600)} />
        </div>
      )}
    </section>
  );
}

function FeaturedScrollArrow({
  side,
  onClick,
}: {
  side: 'left' | 'right';
  onClick: () => void;
}) {
  const isLeft = side === 'left';
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={isLeft ? 'Прокрутить назад' : 'Прокрутить вперёд'}
      className={`hidden md:flex absolute ${isLeft ? 'left-0' : 'right-0'} top-0 bottom-2 z-10 items-center justify-center w-10 bg-ink-950/60 hover:bg-ink-950/80 text-bone-50 text-2xl opacity-0 group-hover/row:opacity-100 transition-opacity focus-ring`}
    >
      {isLeft ? '‹' : '›'}
    </button>
  );
}

function SectionTab({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`
        focus-ring
        relative px-5 py-3
        text-[11px] uppercase tracking-[0.25em] font-medium
        transition-colors
        ${active ? 'text-ember-200' : 'text-bone-300/60 hover:text-bone-100'}
      `}
    >
      {label}
      {active && (
        <span className="absolute bottom-[-1px] left-0 right-0 h-px bg-ember-400" />
      )}
    </button>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-8 flex items-center gap-4">
      <span className="text-bone-300/50 text-[11px] uppercase tracking-[0.25em]">
        {children}
      </span>
      <span className="flex-1 h-px bg-ink-700/60" />
    </div>
  );
}

function NoResultsState({ query }: { query: string }) {
  return (
    <div className="text-center pt-10 pb-24 max-w-md mx-auto animate-fade-in">
      <p className="text-bone-50 text-xl tracking-tight">
        Nothing for "<span className="text-ember-200">{query}</span>"
      </p>
      <p className="mt-3 text-bone-300/50 text-sm">
        Try a different spelling, or a year.
      </p>
    </div>
  );
}

function FilteredOutState({ onReset }: { onReset: () => void }) {
  return (
    <div className="text-center pt-6 pb-16 max-w-md mx-auto animate-fade-in">
      <p className="text-bone-50 text-lg tracking-tight">Ничего не подходит под фильтры</p>
      <p className="mt-2 text-bone-300/50 text-sm">Попробуй ослабить язык или качество.</p>
      <button
        onClick={onReset}
        className="
          focus-ring
          mt-5 px-5 py-2.5
          text-[11px] uppercase tracking-[0.2em] font-medium
          text-ember-200 border border-ember-300/40
          hover:bg-ember-400/[0.08] hover:border-ember-300/70
          transition-colors
        "
        style={{ borderRadius: 1 }}
      >
        Сбросить фильтры
      </button>
    </div>
  );
}

function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="text-center pt-10 pb-24 max-w-md mx-auto animate-fade-in">
      <p className="text-[11px] uppercase tracking-[0.25em] text-ember-300/80 mb-3">
        Something broke
      </p>
      <p className="text-bone-50 text-lg tracking-tight">{message}</p>
      <button
        onClick={onRetry}
        className="
          focus-ring
          mt-6 px-6 py-3
          text-xs uppercase tracking-[0.18em] font-medium
          text-bone-50
          bg-ember-400 hover:bg-ember-300
          transition-colors
        "
        style={{ borderRadius: 1 }}
      >
        Try again
      </button>
    </div>
  );
}
