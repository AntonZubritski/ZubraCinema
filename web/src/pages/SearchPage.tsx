import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ApiError, searchMovies, type Movie } from '../api';
import { SearchBar } from '../components/SearchBar';
import { MovieGrid, MovieGridSkeleton } from '../components/MovieGrid';

type Status = 'idle' | 'loading' | 'success' | 'error';

export default function SearchPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialQ = searchParams.get('q') ?? '';
  const [query, setQuery] = useState(initialQ);
  const [status, setStatus] = useState<Status>('idle');
  const [movies, setMovies] = useState<Movie[]>([]);
  const [errorText, setErrorText] = useState<string>('');
  const [errorCode, setErrorCode] = useState<string | undefined>(undefined);
  const abortRef = useRef<AbortController | null>(null);
  const navigate = useNavigate();

  const runSearch = useCallback(
    async (q: string) => {
      const trimmed = q.trim();
      if (!trimmed) return;

      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;

      setStatus('loading');
      setErrorText('');
      setErrorCode(undefined);

      try {
        const results = await searchMovies(trimmed, ac.signal);
        if (ac.signal.aborted) return;
        setMovies(results);
        setStatus('success');
      } catch (err) {
        if (ac.signal.aborted) return;
        if (err instanceof Error && err.name === 'AbortError') return;
        if (err instanceof ApiError) {
          setErrorText(err.message);
          setErrorCode(err.code);
        } else if (err instanceof Error) {
          setErrorText(err.message);
        } else {
          setErrorText('Something went wrong');
        }
        setStatus('error');
      }
    },
    [],
  );

  useEffect(() => {
    if (initialQ.trim().length > 0) {
      void runSearch(initialQ);
    }
    return () => {
      abortRef.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSubmit = useCallback(() => {
    const trimmed = query.trim();
    if (!trimmed) return;
    setSearchParams(trimmed ? { q: trimmed } : {}, { replace: false });
    void runSearch(trimmed);
  }, [query, runSearch, setSearchParams]);

  const handleSelect = useCallback(
    (movie: Movie) => {
      navigate(`/movie/${movie.tmdbId}`);
    },
    [navigate],
  );

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

        <section className="max-w-2xl mx-auto mb-20">
          <SearchBar
            value={query}
            onChange={setQuery}
            onSubmit={handleSubmit}
            loading={status === 'loading'}
          />
        </section>

        <main>
          {status === 'idle' && <IdleState />}

          {status === 'loading' && (
            <>
              <SectionLabel>Searching</SectionLabel>
              <MovieGridSkeleton />
            </>
          )}

          {status === 'error' && (
            <ErrorState
              message={errorText}
              code={errorCode}
              onRetry={() => void runSearch(query)}
            />
          )}

          {status === 'success' && movies.length === 0 && (
            <NoResultsState query={query} />
          )}

          {status === 'success' && movies.length > 0 && (
            <>
              <SectionLabel>
                {movies.length} result{movies.length === 1 ? '' : 's'} for{' '}
                <span className="text-bone-50">"{query}"</span>
              </SectionLabel>
              <MovieGrid movies={movies} onSelect={handleSelect} />
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

function IdleState() {
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

function ErrorState({
  message,
  code,
  onRetry,
}: {
  message: string;
  code: string | undefined;
  onRetry: () => void;
}) {
  if (code === 'TMDB_NOT_CONFIGURED') {
    return (
      <div className="max-w-xl mx-auto animate-fade-in pt-10 pb-24">
        <div
          className="border border-ember-300/30 bg-ember-400/[0.04] p-6"
          style={{ borderRadius: 2 }}
        >
          <p className="text-[11px] uppercase tracking-[0.25em] text-ember-300/80 mb-3">
            TMDB key required
          </p>
          <p className="text-bone-50 text-base tracking-tight leading-relaxed">
            Set <code className="text-ember-200 font-mono">ZUBRACINEMA_TMDB_KEY</code> to
            your TMDB API key, then restart the app.
          </p>
          <p className="mt-3 text-bone-300/60 text-sm leading-relaxed">
            Get one free at{' '}
            <a
              href="https://www.themoviedb.org/settings/api"
              target="_blank"
              rel="noreferrer"
              className="text-ember-200 hover:text-ember-100 underline underline-offset-2 decoration-ember-300/40"
            >
              themoviedb.org/settings/api
            </a>
            .
          </p>
        </div>
      </div>
    );
  }

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
