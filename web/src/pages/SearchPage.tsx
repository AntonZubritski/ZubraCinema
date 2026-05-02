import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ApiError, fetchFeatured, searchGroups, type Group } from '../api';
import { SearchBar } from '../components/SearchBar';
import { MovieGrid, MovieGridSkeleton } from '../components/MovieGrid';
import { SortBar } from '../components/SortBar';
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

  const [status, setStatus] = useState<Status>('idle');
  const [groups, setGroups] = useState<Group[]>([]);
  const [errorText, setErrorText] = useState<string>('');
  const [mode, setMode] = useState<'featured' | 'search'>(
    initial.q.trim().length > 0 ? 'search' : 'featured',
  );
  const abortRef = useRef<AbortController | null>(null);
  const navigate = useNavigate();

  const runSearch = useCallback(async (q: string) => {
    const trimmed = q.trim();
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    setStatus('loading');
    setErrorText('');
    setCommittedQuery(trimmed);

    try {
      const results =
        trimmed.length === 0
          ? await fetchFeatured(ac.signal)
          : await searchGroups(trimmed, ac.signal);
      if (ac.signal.aborted) return;
      setGroups(results);
      setMode(trimmed.length === 0 ? 'featured' : 'search');
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
    void runSearch(initial.q);
    return () => {
      abortRef.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const next = serializeState({ q: committedQuery, sort, langs, qualities });
    const current = searchParams.toString();
    if (next.toString() !== current) {
      setSearchParams(next, { replace: true });
    }
  }, [committedQuery, sort, langs, qualities, searchParams, setSearchParams]);

  const handleSubmit = useCallback(() => {
    void runSearch(query);
  }, [query, runSearch]);

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

  const showSortBar = status === 'success' && groups.length > 0;
  const trimmedQuery = committedQuery;

  return (
    <div className="grain vignette min-h-screen relative">
      <div className="relative z-10 max-w-[1500px] mx-auto px-8 lg:px-14 pt-12 pb-24">
        <header className="flex flex-col items-center text-center pt-10 pb-14">
          <div className="flex items-baseline gap-2 mb-1">
            <span className="block w-1.5 h-1.5 bg-ember-400 translate-y-[-6px]" />
            <h1 className="font-display text-5xl md:text-6xl text-bone-50 tracking-tightest">
              ZubraCinema
            </h1>
          </div>
          <p className="text-bone-300/50 text-xs uppercase tracking-[0.35em] mt-2">
            A private cinema
          </p>
        </header>

        <section className="max-w-2xl mx-auto mb-14">
          <SearchBar
            value={query}
            onChange={setQuery}
            onSubmit={handleSubmit}
            loading={status === 'loading'}
          />
        </section>

        <main>
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
              <SectionLabel>{mode === 'featured' ? 'Загружаем новинки' : 'Searching'}</SectionLabel>
              <MovieGridSkeleton />
            </>
          )}

          {status === 'error' && (
            <ErrorState message={errorText} onRetry={() => void runSearch(query)} />
          )}

          {status === 'success' && groups.length === 0 && mode === 'search' && (
            <NoResultsState query={trimmedQuery} />
          )}

          {status === 'success' && groups.length === 0 && mode === 'featured' && (
            <FeaturedEmptyState />
          )}

          {status === 'success' && groups.length > 0 && (
            <>
              <SectionLabel>
                {mode === 'featured' ? (
                  <>
                    Новинки в HD
                    <span className="text-bone-300/40 ml-2">
                      · {visibleGroups.length} из {groups.length}
                    </span>
                  </>
                ) : (
                  <>
                    Результаты для{' '}
                    <span className="text-bone-50">«{trimmedQuery}»</span>
                    <span className="text-bone-300/40 ml-2">
                      · {visibleGroups.length} из {groups.length}
                    </span>
                  </>
                )}
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
        </main>
      </div>
    </div>
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

function FeaturedEmptyState() {
  return (
    <div className="text-center pt-10 pb-24 max-w-xl mx-auto animate-fade-in">
      <p className="font-display italic text-2xl md:text-3xl text-bone-200/80 leading-relaxed tracking-tight">
        "Everything you can imagine is real."
      </p>
      <p className="mt-6 text-bone-300/40 text-xs uppercase tracking-[0.3em]">
        Type a title to begin
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
