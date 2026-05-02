import { useCallback, useRef, useState } from 'react';
import { ApiError, playMagnet, searchMovies, type Magnet, type Movie } from './api';
import { SearchBar } from './components/SearchBar';
import { MovieGrid, MovieGridSkeleton } from './components/MovieGrid';
import { PlayModal } from './components/PlayModal';
import { Toast, type ToastMessage } from './components/Toast';

type Status = 'idle' | 'loading' | 'success' | 'error';

export default function App() {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [movies, setMovies] = useState<Movie[]>([]);
  const [errorText, setErrorText] = useState<string>('');
  const [selected, setSelected] = useState<Movie | null>(null);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const toastIdRef = useRef(0);

  const showToast = useCallback((kind: ToastMessage['kind'], text: string) => {
    toastIdRef.current += 1;
    setToast({ id: toastIdRef.current, kind, text });
  }, []);

  const runSearch = useCallback(async () => {
    const q = query.trim();
    if (!q) return;

    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    setStatus('loading');
    setErrorText('');

    try {
      const results = await searchMovies(q, ac.signal);
      if (ac.signal.aborted) return;
      setMovies(results);
      setStatus('success');
    } catch (err) {
      if (ac.signal.aborted) return;
      const msg =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Something went wrong';
      setErrorText(msg);
      setStatus('error');
    }
  }, [query]);

  const handlePlay = useCallback(
    async (magnet: Magnet) => {
      await playMagnet(magnet.url);
      setSelected(null);
      showToast('info', `Opening ${magnet.quality} in player…`);
    },
    [showToast],
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
            onSubmit={runSearch}
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
            <ErrorState message={errorText} onRetry={runSearch} />
          )}

          {status === 'success' && movies.length === 0 && <NoResultsState query={query} />}

          {status === 'success' && movies.length > 0 && (
            <>
              <SectionLabel>
                {movies.length} result{movies.length === 1 ? '' : 's'} for{' '}
                <span className="text-bone-50">"{query}"</span>
              </SectionLabel>
              <MovieGrid movies={movies} onSelect={setSelected} />
            </>
          )}
        </main>
      </div>

      {selected && (
        <PlayModal
          movie={selected}
          onClose={() => setSelected(null)}
          onPlay={handlePlay}
        />
      )}

      <Toast toast={toast} onDismiss={() => setToast(null)} />
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

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
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
