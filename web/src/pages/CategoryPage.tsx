import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ApiError, fetchCategoryPage, getSettings, type Group } from '../api';
import { useInfiniteScroll } from '../lib/useInfiniteScroll';
import { categoryBySlug, isCategorySlug } from '../lib/categories';
import { MovieCard } from '../components/MovieCard';
import { MovieGrid, MovieGridSkeleton } from '../components/MovieGrid';
import { SettingsModal } from '../components/SettingsModal';
import { Sidebar } from '../components/Sidebar';
import { SortBar } from '../components/SortBar';
import { TopBar } from '../components/TopBar';
import type { Language } from '../lib/lang';
import { filterGroups, sortGroups, type QualityBucket, type SortKey } from '../lib/sortFilter';
import { DEFAULT_STATE, parseState, serializeState } from '../lib/url';

/**
 * CategoryPage — drill-down view for a single category (route /category/:slug).
 * Loads paginated torrents from the backend and stacks them into an infinite-
 * scrolling 6-col grid. Lang/quality/sort filters are client-side and shared
 * with SearchPage via the same URL helpers. Page index is component state and
 * always resets on navigate; scroll restoration is intentionally out of scope.
 * Invalid slugs render a tiny "not found" instead of crashing.
 */
export default function CategoryPage() {
  const params = useParams<{ slug: string }>();
  const slug = params.slug ?? '';
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const initial = useMemo(() => parseState(searchParams), [searchParams]);

  const valid = isCategorySlug(slug);
  const category = valid ? categoryBySlug(slug) : null;

  const [sort, setSort] = useState<SortKey>(initial.sort);
  const [langs, setLangs] = useState<Language[]>(initial.langs);
  const [qualities, setQualities] = useState<QualityBucket[]>(initial.qualities);

  const [pages, setPages] = useState<Group[][]>([]);
  const [pageIndex, setPageIndex] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorText, setErrorText] = useState<string>('');
  const [initialLoaded, setInitialLoaded] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showSidebar, setShowSidebar] = useState(false);
  const [adultEnabled, setAdultEnabled] = useState(false);

  // Pull adult flag once for the sidebar's 18+ block.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const s = await getSettings();
        if (!cancelled) setAdultEnabled(Boolean(s.adult));
      } catch {
        // best-effort; sidebar just won't show 18+ entries
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [showSettings]);
  const abortRef = useRef<AbortController | null>(null);

  // Reset everything when slug changes (different category).
  useEffect(() => {
    abortRef.current?.abort();
    setPages([]);
    setPageIndex(0);
    setHasMore(false);
    setLoading(false);
    setErrorText('');
    setInitialLoaded(false);
  }, [slug]);

  const loadPage = useCallback(
    async (page: number) => {
      if (!category) return;
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;

      setLoading(true);
      setErrorText('');
      try {
        const res = await fetchCategoryPage(category.slug, page, ac.signal);
        if (ac.signal.aborted) return;
        setPages((prev) => {
          const next = prev.slice();
          next[page] = res.groups;
          return next;
        });
        setHasMore(res.hasMore);
        setPageIndex(res.page);
        setInitialLoaded(true);
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
      } finally {
        if (!ac.signal.aborted) setLoading(false);
      }
    },
    [category],
  );

  // Initial fetch on slug change.
  useEffect(() => {
    if (!category) return;
    void loadPage(0);
    return () => {
      abortRef.current?.abort();
    };
  }, [category, loadPage]);

  // Sync filter/sort state to URL (page is intentionally not synced).
  useEffect(() => {
    const next = serializeState({ q: '', sort, langs, qualities });
    const current = searchParams.toString();
    if (next.toString() !== current) {
      setSearchParams(next, { replace: true });
    }
  }, [sort, langs, qualities, searchParams, setSearchParams]);

  const onLoadMore = useCallback(() => {
    if (!hasMore || loading) return;
    void loadPage(pageIndex + 1);
  }, [hasMore, loading, loadPage, pageIndex]);

  const allGroups = useMemo(() => {
    const flat: Group[] = [];
    for (const p of pages) if (p) flat.push(...p);
    return flat;
  }, [pages]);

  const visibleGroups = useMemo(() => {
    const filtered = filterGroups(allGroups, langs, qualities);
    // For 'relevance' (the default) we trust the backend's order — rutor
    // returns newest-first, and re-sorting across pages would scramble the
    // positions of already-visible cards every time a new page appends.
    // Explicit sort modes (seeders/year/title/size) still re-rank, because
    // the user picked them on purpose and expects fresh ordering.
    if (sort === 'relevance') return filtered;
    return sortGroups(filtered, sort);
  }, [allGroups, langs, qualities, sort]);

  // "Новинки" strip — top-N by year from the first page only. Pulled
  // out of the same pages[0] data the grid below renders, so no extra
  // network round-trip; just a different shaping (sort by year desc,
  // cap at 15). Hidden when there's no recognisable year signal so we
  // don't surface a row of "—" placeholders.
  const newestGroups = useMemo(() => {
    const firstPage = pages[0];
    if (!firstPage || firstPage.length === 0) return [];
    const filtered = filterGroups(firstPage, langs, qualities);
    const withYears = filtered.filter((g) => g.year > 0);
    if (withYears.length === 0) return [];
    return withYears
      .slice()
      .sort((a, b) => b.year - a.year)
      .slice(0, 15);
  }, [pages, langs, qualities]);

  // Auto-load via IntersectionObserver is only safe when the current filter
  // actually returns at least one visible card. Otherwise the empty grid
  // leaves the sentinel permanently in viewport, and IO would hammer the
  // backend page-by-page (and rutor doesn't have English releases to find).
  // When filter eats everything we disable the sentinel and surface a manual
  // "load more anyway" affordance instead.
  const filterBlocking =
    initialLoaded && allGroups.length > 0 && visibleGroups.length === 0;
  const sentinelRef = useInfiniteScroll({
    hasMore: hasMore && !filterBlocking,
    loading,
    onLoadMore,
  });

  const handleSelect = useCallback(
    (group: Group) => {
      navigate(`/movie/${encodeURIComponent(group.id)}`, { state: { group } });
    },
    [navigate],
  );

  if (!valid || !category) {
    return (
      <div className="grain vignette min-h-screen relative">
        <div className="relative z-10 max-w-[1500px] mx-auto px-8 lg:px-14 pt-12 pb-24">
          <p className="text-bone-50 text-lg tracking-tight">Категория не найдена</p>
          <Link
            to="/"
            className="mt-4 inline-block text-[11px] uppercase tracking-[0.25em] text-ember-200 hover:text-ember-100 transition-colors"
          >
            ← На главную
          </Link>
        </div>
      </div>
    );
  }

  const showInitialSkeleton = !initialLoaded && loading;
  const showError = !!errorText && pages.length === 0;
  const showFilteredOut = initialLoaded && allGroups.length > 0 && visibleGroups.length === 0;

  return (
    <div className="grain vignette min-h-screen relative">
      <TopBar
        title={category.label}
        showBack
        onBack={() => navigate('/')}
        onMenu={() => setShowSidebar(true)}
        onSettings={() => setShowSettings(true)}
      />
      <Sidebar
        open={showSidebar}
        onClose={() => setShowSidebar(false)}
        adultEnabled={adultEnabled}
      />
      <div className="relative z-10 max-w-[1500px] mx-auto px-8 lg:px-14 pt-8 pb-24">
        <header className="pt-2 pb-10">
          <h1 className="font-display text-4xl md:text-5xl text-bone-50 tracking-tightest">
            {category.label}
          </h1>
        </header>

        <main>
          {newestGroups.length > 0 && (
            <NewestStrip groups={newestGroups} onSelect={handleSelect} />
          )}

          {(initialLoaded || allGroups.length > 0) && (
            <SortBar
              sort={sort}
              langs={langs}
              qualities={qualities}
              onSortChange={setSort}
              onLangsChange={setLangs}
              onQualitiesChange={setQualities}
            />
          )}

          {showInitialSkeleton && <MovieGridSkeleton count={12} />}

          {showError && (
            <div className="text-center pt-10 pb-24 max-w-md mx-auto animate-fade-in">
              <p className="text-[11px] uppercase tracking-[0.25em] text-ember-300/80 mb-3">
                Something broke
              </p>
              <p className="text-bone-50 text-lg tracking-tight">{errorText}</p>
              <button
                onClick={() => void loadPage(0)}
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
          )}

          {initialLoaded && !showError && (
            <>
              {showFilteredOut ? (
                <div className="text-center pt-6 pb-16 max-w-md mx-auto animate-fade-in">
                  <p className="text-bone-50 text-lg tracking-tight">
                    Ничего не подходит под фильтры
                  </p>
                  <p className="mt-2 text-bone-300/50 text-sm">
                    Загружено страниц: {pages.length} · попробуй ослабить
                    язык/качество или подгрузи ещё.
                  </p>
                  <div className="mt-5 flex items-center justify-center gap-2 flex-wrap">
                    <button
                      onClick={() => {
                        setLangs([...DEFAULT_STATE.langs]);
                        setQualities([...DEFAULT_STATE.qualities]);
                      }}
                      className="
                        focus-ring
                        px-5 py-2.5
                        text-[11px] uppercase tracking-[0.2em] font-medium
                        text-ember-200 border border-ember-300/40
                        hover:bg-ember-400/[0.08] hover:border-ember-300/70
                        transition-colors
                      "
                      style={{ borderRadius: 1 }}
                    >
                      Сбросить фильтры
                    </button>
                    {hasMore && (
                      <button
                        onClick={() => void loadPage(pageIndex + 1)}
                        disabled={loading}
                        className="
                          focus-ring
                          px-5 py-2.5
                          text-[11px] uppercase tracking-[0.2em] font-medium
                          text-bone-300/80 border border-ink-700/60
                          hover:text-bone-50 hover:border-ink-600
                          disabled:opacity-40 disabled:cursor-not-allowed
                          transition-colors
                        "
                        style={{ borderRadius: 1 }}
                      >
                        {loading ? 'Загружаем…' : 'Загрузить ещё страницу'}
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <MovieGrid
                  groups={visibleGroups}
                  onSelect={handleSelect}
                  // Only steal focus when there's no NewestStrip above —
                  // otherwise the strip already has the first card and
                  // we'd yank focus mid-orientation.
                  autoFocusFirst={newestGroups.length === 0}
                />
              )}

              {loading && pages.length > 0 && (
                <p className="mt-8 text-center text-[11px] uppercase tracking-[0.25em] text-bone-300/50">
                  Загружаем ещё…
                </p>
              )}

              {!loading && !hasMore && !showFilteredOut && visibleGroups.length > 0 && (
                <p className="mt-10 text-center text-[11px] uppercase tracking-[0.25em] text-bone-300/40">
                  Это все раздачи в категории · {visibleGroups.length}
                </p>
              )}

              <div ref={sentinelRef} aria-hidden="true" className="h-px w-full" />
            </>
          )}
        </main>
      </div>
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
    </div>
  );
}

// NewestStrip — horizontal scroller pinned above the main grid, showing
// the most recent releases inside this category (sorted by year DESC,
// top 15). Pulls from the same first-page data the grid renders, so no
// extra fetch is needed. Visually mirrors FeaturedRow / CategoryRow on
// the home page so the pattern stays consistent across the app.
function NewestStrip({
  groups,
  onSelect,
}: {
  groups: Group[];
  onSelect: (g: Group) => void;
}) {
  const stripRef = useRef<HTMLDivElement | null>(null);
  const autoFocusedRef = useRef(false);

  const scrollBy = useCallback((delta: number) => {
    stripRef.current?.scrollBy({ left: delta, behavior: 'smooth' });
  }, []);

  // TV-mode arrow-key nav within the strip. Same shape as CategoryRow:
  // ArrowLeft/Right move within the strip, ArrowUp/Down let through so
  // the user can escape into the grid below.
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

  // TV-mode: auto-focus the first card so the remote starts on a
  // navigable element. Once-only per `groups` identity to avoid yanking
  // focus away from the user mid-navigation.
  useEffect(() => {
    autoFocusedRef.current = false;
  }, [groups]);
  useEffect(() => {
    if (autoFocusedRef.current) return;
    if (!document.body.classList.contains('tv-mode')) return;
    const strip = stripRef.current;
    if (!strip) return;
    const first = strip.querySelector<HTMLButtonElement>(':scope > div > button');
    if (first) {
      first.focus();
      autoFocusedRef.current = true;
    }
  }, [groups]);

  const stripClass =
    'flex gap-3 overflow-x-auto snap-x snap-mandatory pb-2 [&::-webkit-scrollbar]:hidden';
  const stripStyle = { scrollbarWidth: 'none' as const };

  return (
    <section className="mb-8 group/row relative">
      <div className="mb-5 flex items-center gap-4">
        <span className="text-bone-300/50 text-[11px] uppercase tracking-[0.25em]">
          Новинки
        </span>
        <span className="flex-1 h-px bg-ink-700/60" />
      </div>

      <div className="relative">
        <div ref={stripRef} className={stripClass} style={stripStyle} onKeyDown={onKeyDown}>
          {groups.map((g) => (
            <div key={g.id} className="flex-shrink-0 w-[150px] snap-start">
              <MovieCard group={g} onClick={() => onSelect(g)} />
            </div>
          ))}
        </div>
        <NewestScrollArrow side="left" onClick={() => scrollBy(-600)} />
        <NewestScrollArrow side="right" onClick={() => scrollBy(600)} />
      </div>
    </section>
  );
}

function NewestScrollArrow({
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
