import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ApiError,
  getMovie,
  getMovieTorrents,
  startTorrent,
  type MovieDetail,
  type Torrent,
} from '../api';
import { MovieHero } from '../components/MovieHero';
import { TorrentRow, TorrentRowSkeleton } from '../components/TorrentRow';
import { useToast } from '../lib/toast';

type DetailStatus = 'loading' | 'success' | 'error';
type TorrentsStatus = 'loading' | 'success' | 'error';

export default function MoviePage() {
  const params = useParams<{ tmdbId: string }>();
  const navigate = useNavigate();
  const showToast = useToast();
  const tmdbId = Number(params.tmdbId);

  const [detail, setDetail] = useState<MovieDetail | null>(null);
  const [detailStatus, setDetailStatus] = useState<DetailStatus>('loading');
  const [detailError, setDetailError] = useState('');

  const [torrents, setTorrents] = useState<Torrent[]>([]);
  const [torrentsStatus, setTorrentsStatus] = useState<TorrentsStatus>('loading');
  const [torrentsError, setTorrentsError] = useState('');

  const [busyTorrentId, setBusyTorrentId] = useState<string | null>(null);

  useEffect(() => {
    if (!Number.isFinite(tmdbId) || tmdbId <= 0) {
      setDetailStatus('error');
      setDetailError('Invalid movie identifier');
      return;
    }

    const ac = new AbortController();
    setDetailStatus('loading');
    setTorrentsStatus('loading');

    void (async () => {
      try {
        const m = await getMovie(tmdbId, ac.signal);
        if (ac.signal.aborted) return;
        setDetail(m);
        setDetailStatus('success');
      } catch (err) {
        if (ac.signal.aborted) return;
        setDetailError(err instanceof Error ? err.message : 'Failed to load movie');
        setDetailStatus('error');
      }
    })();

    void (async () => {
      try {
        const list = await getMovieTorrents(tmdbId, ac.signal);
        if (ac.signal.aborted) return;
        setTorrents(list);
        setTorrentsStatus('success');
      } catch (err) {
        if (ac.signal.aborted) return;
        setTorrentsError(err instanceof Error ? err.message : 'Failed to load torrents');
        setTorrentsStatus('error');
      }
    })();

    return () => {
      ac.abort();
    };
  }, [tmdbId]);

  const handlePick = useCallback(
    async (torrent: Torrent) => {
      if (busyTorrentId) return;
      setBusyTorrentId(torrent.id);
      try {
        const session = await startTorrent(torrent.magnet);
        navigate(`/play/${encodeURIComponent(session.id)}`);
      } catch (err) {
        const msg =
          err instanceof ApiError
            ? err.message
            : err instanceof Error
              ? err.message
              : 'Could not start torrent';
        showToast('error', msg);
        setBusyTorrentId(null);
      }
    },
    [busyTorrentId, navigate, showToast],
  );

  return (
    <div className="grain vignette min-h-screen relative">
      <div className="relative z-10">
        <TopNav />

        {detailStatus === 'loading' && <MovieHeroSkeleton />}
        {detailStatus === 'error' && (
          <DetailError message={detailError} />
        )}
        {detailStatus === 'success' && detail && <MovieHero movie={detail} />}

        <section className="max-w-[1500px] mx-auto px-8 lg:px-14 mt-16 md:mt-20 pb-24">
          <SectionLabel>Available torrents</SectionLabel>

          {torrentsStatus === 'loading' && (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <TorrentRowSkeleton key={i} />
              ))}
            </div>
          )}

          {torrentsStatus === 'error' && (
            <div className="text-center py-12 max-w-md mx-auto">
              <p className="text-[11px] uppercase tracking-[0.25em] text-ember-300/80 mb-3">
                Could not load torrents
              </p>
              <p className="text-bone-200/80 text-sm">{torrentsError}</p>
            </div>
          )}

          {torrentsStatus === 'success' && torrents.length === 0 && (
            <div className="text-center py-12 max-w-md mx-auto animate-fade-in">
              <p className="font-display italic text-xl md:text-2xl text-bone-200/70 leading-relaxed tracking-tight">
                "Not in the catalogue. Try a different title."
              </p>
            </div>
          )}

          {torrentsStatus === 'success' && torrents.length > 0 && (
            <div className="space-y-2 animate-fade-in">
              {torrents.map((t) => (
                <TorrentRow
                  key={t.id}
                  torrent={t}
                  busy={busyTorrentId === t.id}
                  disabled={busyTorrentId !== null && busyTorrentId !== t.id}
                  onPick={handlePick}
                />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function TopNav() {
  return (
    <div className="absolute top-0 inset-x-0 z-20 px-8 lg:px-14 pt-6">
      <Link
        to="/"
        className="
          focus-ring
          inline-flex items-center gap-2
          text-[11px] uppercase tracking-[0.25em] font-medium
          text-bone-200/80 hover:text-ember-200
          transition-colors
        "
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M15 18l-6-6 6-6" />
        </svg>
        <span>Back</span>
      </Link>
    </div>
  );
}

function MovieHeroSkeleton() {
  return (
    <div className="relative w-full">
      <div className="w-full skeleton-shimmer" style={{ height: 'min(50vh, 540px)' }} />
      <div className="max-w-[1500px] mx-auto px-8 lg:px-14 -mt-32 md:-mt-40 relative">
        <div className="flex flex-col md:flex-row gap-8 md:gap-10 items-start">
          <div
            className="flex-shrink-0 w-44 md:w-[280px] skeleton-shimmer"
            style={{ aspectRatio: '2 / 3', borderRadius: 2 }}
          />
          <div className="flex-1 min-w-0 pt-2 md:pt-16 space-y-4 w-full">
            <div className="h-12 md:h-16 skeleton-shimmer w-3/4" style={{ borderRadius: 2 }} />
            <div className="h-3 skeleton-shimmer w-1/2" style={{ borderRadius: 1 }} />
            <div className="h-3 skeleton-shimmer w-1/3" style={{ borderRadius: 1 }} />
            <div className="space-y-2 pt-4">
              <div className="h-3 skeleton-shimmer w-full" style={{ borderRadius: 1 }} />
              <div className="h-3 skeleton-shimmer w-5/6" style={{ borderRadius: 1 }} />
              <div className="h-3 skeleton-shimmer w-2/3" style={{ borderRadius: 1 }} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function DetailError({ message }: { message: string }) {
  return (
    <div className="max-w-xl mx-auto px-8 pt-32 pb-12 text-center animate-fade-in">
      <p className="text-[11px] uppercase tracking-[0.25em] text-ember-300/80 mb-3">
        Could not load this title
      </p>
      <p className="text-bone-50 text-lg tracking-tight">{message}</p>
      <Link
        to="/"
        className="
          focus-ring
          inline-flex items-center
          mt-6 px-6 py-3
          text-xs uppercase tracking-[0.18em] font-medium
          text-bone-50
          bg-ember-400 hover:bg-ember-300
          transition-colors
        "
        style={{ borderRadius: 1 }}
      >
        Back to search
      </Link>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-6 flex items-center gap-4">
      <span className="text-bone-300/50 text-[11px] uppercase tracking-[0.25em]">
        {children}
      </span>
      <span className="flex-1 h-px bg-ink-700/60" />
    </div>
  );
}
