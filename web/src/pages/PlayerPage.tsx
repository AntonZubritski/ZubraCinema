import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  ApiError,
  deleteTorrent,
  getTorrent,
  launchExternal,
  streamUrl,
  type TorrentDetail,
} from '../api';
import { ProgressBar } from '../components/ProgressBar';
import { Spinner } from '../components/Spinner';
import { useToast } from '../lib/toast';
import { formatBytes, formatPercent, formatRate } from '../lib/format';

const POLL_MS = 2000;

type Status = 'loading' | 'success' | 'error';

// PlaybackPhase tracks the <video> element's effective state for the overlay.
//   'buffering' — initial state, no data has started playing yet
//   'playing'   — onPlaying has fired at least once for the current src
//   'error'     — onError fired (e.g. ERR_CONTENT_LENGTH_MISMATCH); browser gave up
type PlaybackPhase = 'buffering' | 'playing' | 'error';

function isVideoFile(mimeType: string | null, path: string): boolean {
  if (mimeType && mimeType.startsWith('video/')) return true;
  const ext = path.toLowerCase().split('.').pop() ?? '';
  return ['mp4', 'mkv', 'webm', 'avi', 'mov', 'm4v'].includes(ext);
}

function pickDefaultFile(torrent: TorrentDetail): number {
  const videos = torrent.files.filter((f) => isVideoFile(f.mimeType, f.path));
  const pool = videos.length > 0 ? videos : torrent.files;
  if (pool.length === 0) return 0;
  return pool.reduce((best, f) => (f.size > best.size ? f : best), pool[0]).idx;
}

export default function PlayerPage() {
  const params = useParams<{ torrentId: string }>();
  const torrentId = params.torrentId ?? '';
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const showToast = useToast();

  const [torrent, setTorrent] = useState<TorrentDetail | null>(null);
  const [status, setStatus] = useState<Status>('loading');
  const [errorText, setErrorText] = useState('');
  const [stopping, setStopping] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [phase, setPhase] = useState<PlaybackPhase>('buffering');
  const [overlayLaunching, setOverlayLaunching] = useState(false);

  // Latest torrent reference for the unmount cleanup effect, which only fires
  // when the page is actually torn down (otherwise it would re-fire on every
  // poll tick that updates `torrent`).
  const torrentRef = useRef<TorrentDetail | null>(null);
  useEffect(() => {
    torrentRef.current = torrent;
  }, [torrent]);

  const fileQuery = searchParams.get('file');
  const requestedFileIdx = fileQuery !== null ? Number(fileQuery) : null;

  const activeFileIdx = useMemo<number | null>(() => {
    if (!torrent) return null;
    if (
      requestedFileIdx !== null &&
      Number.isFinite(requestedFileIdx) &&
      torrent.files.some((f) => f.idx === requestedFileIdx)
    ) {
      return requestedFileIdx;
    }
    return pickDefaultFile(torrent);
  }, [torrent, requestedFileIdx]);

  // initial fetch
  useEffect(() => {
    if (!torrentId) {
      setStatus('error');
      setErrorText('Missing torrent identifier');
      return;
    }
    const ac = new AbortController();
    setStatus('loading');
    void (async () => {
      try {
        const t = await getTorrent(torrentId, ac.signal);
        if (ac.signal.aborted) return;
        setTorrent(t);
        setStatus('success');
      } catch (err) {
        if (ac.signal.aborted) return;
        setErrorText(err instanceof Error ? err.message : 'Failed to load torrent');
        setStatus('error');
      }
    })();
    return () => {
      ac.abort();
    };
  }, [torrentId]);

  // polling for stats
  useEffect(() => {
    if (status !== 'success' || !torrentId) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      try {
        const ac = new AbortController();
        const t = await getTorrent(torrentId, ac.signal);
        if (!cancelled) setTorrent(t);
      } catch {
        // ignore transient errors during polling
      } finally {
        if (!cancelled) {
          timer = setTimeout(tick, POLL_MS);
        }
      }
    };

    timer = setTimeout(tick, POLL_MS);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [status, torrentId]);

  // Reset playback phase whenever the active file (and thus videoSrc) changes,
  // so that switching files in the picker re-shows the buffering overlay
  // instead of inheriting a stale 'playing' / 'error' state from the previous
  // <video> element.
  useEffect(() => {
    setPhase('buffering');
  }, [activeFileIdx]);

  // Auto-stop streaming torrents when leaving the page. Download mode stays
  // running. Files are NOT deleted — partial pieces are kept on disk so the
  // user can resume by re-adding the torrent. This keeps us gentle on the
  // swarm and avoids burning bandwidth on something nobody is watching.
  useEffect(() => {
    return () => {
      const t = torrentRef.current;
      if (!t || !torrentId) return;
      if (t.mode === 'download') return;
      void deleteTorrent(torrentId, false).catch(() => {
        // best-effort; ignore failures on unmount
      });
    };
  }, [torrentId]);

  const handleSelectFile = useCallback(
    (idx: number) => {
      const next = new URLSearchParams(searchParams);
      next.set('file', String(idx));
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  const launchInExternal = useCallback(async () => {
    if (activeFileIdx === null) return;
    const absoluteUrl = `${window.location.origin}${streamUrl(torrentId, activeFileIdx)}`;
    await launchExternal(absoluteUrl);
  }, [activeFileIdx, torrentId]);

  const handleExternal = useCallback(async () => {
    if (activeFileIdx === null || launching) return;
    setLaunching(true);
    try {
      await launchInExternal();
      showToast('info', 'Opened in external player');
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Could not launch external player';
      showToast('error', msg);
    } finally {
      setLaunching(false);
    }
  }, [activeFileIdx, launching, launchInExternal, showToast]);

  const handleOverlayExternal = useCallback(async () => {
    if (activeFileIdx === null || overlayLaunching) return;
    setOverlayLaunching(true);
    try {
      await launchInExternal();
      showToast('info', 'Opened in external player');
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Could not launch external player';
      showToast('error', msg);
    } finally {
      setOverlayLaunching(false);
    }
  }, [activeFileIdx, launchInExternal, overlayLaunching, showToast]);

  const handleStop = useCallback(async () => {
    if (stopping) return;
    setStopping(true);
    try {
      await deleteTorrent(torrentId, false);
      navigate('/');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not stop torrent';
      showToast('error', msg);
      setStopping(false);
    }
  }, [navigate, showToast, stopping, torrentId]);

  const videoSrc =
    activeFileIdx !== null ? streamUrl(torrentId, activeFileIdx) : '';

  return (
    <div className="grain vignette min-h-screen relative">
      <div className="relative z-10 max-w-[1500px] mx-auto px-6 lg:px-10 pt-8 pb-16">
        <TopNav />

        {status === 'loading' && <PlayerSkeleton />}

        {status === 'error' && (
          <div className="mt-12 max-w-xl mx-auto text-center animate-fade-in">
            <p className="text-[11px] uppercase tracking-[0.25em] text-ember-300/80 mb-3">
              Could not load this stream
            </p>
            <p className="text-bone-50 text-lg tracking-tight">{errorText}</p>
            <Link
              to="/"
              className="
                focus-ring
                inline-flex items-center
                mt-6 px-6 py-3
                text-xs uppercase tracking-[0.18em] font-medium
                text-bone-50 bg-ember-400 hover:bg-ember-300
                transition-colors
              "
              style={{ borderRadius: 1 }}
            >
              Back to search
            </Link>
          </div>
        )}

        {status === 'success' && torrent && (
          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px] gap-8 mt-6 animate-fade-in">
            <div className="min-w-0">
              <div
                className="relative bg-black ring-1 ring-ember-300/40 overflow-hidden"
                style={{ borderRadius: 2 }}
              >
                <video
                  key={videoSrc}
                  controls
                  playsInline
                  preload="metadata"
                  autoPlay
                  muted
                  src={videoSrc}
                  className="w-full h-auto block max-h-[calc(100vh-160px)]"
                  onPlaying={() => setPhase('playing')}
                  onError={() => setPhase('error')}
                />
                {phase !== 'playing' && (
                  <PlaybackOverlay
                    phase={phase}
                    peers={torrent.peers}
                    downloadRate={torrent.downloadRate}
                    onExternal={handleOverlayExternal}
                    launching={overlayLaunching}
                    canLaunch={activeFileIdx !== null}
                  />
                )}
              </div>
            </div>

            <aside className="min-w-0 flex flex-col gap-6">
              <div>
                <p className="text-[10px] uppercase tracking-[0.25em] text-ember-300/70 mb-2">
                  Now streaming
                </p>
                <h1 className="font-display text-2xl md:text-3xl text-bone-50 tracking-tightest leading-tight break-words">
                  {torrent.name}
                </h1>
                <p className="text-bone-300/50 text-xs tracking-wide mt-2 tabular-nums">
                  {formatBytes(torrent.totalSize)} total
                </p>
              </div>

              <StatsPanel torrent={torrent} />

              {torrent.files.length > 1 && (
                <FilePicker
                  files={torrent.files}
                  activeIdx={activeFileIdx}
                  onSelect={handleSelectFile}
                />
              )}

              <div className="space-y-2">
                <button
                  type="button"
                  onClick={handleExternal}
                  disabled={launching || activeFileIdx === null}
                  className="
                    focus-ring
                    w-full flex items-center justify-center gap-2
                    px-4 py-3
                    text-[11px] uppercase tracking-[0.2em] font-medium
                    text-ember-200 hover:text-bone-50
                    border border-ember-300/40
                    hover:bg-ember-400 hover:border-ember-400
                    disabled:opacity-50 disabled:cursor-not-allowed
                    transition-colors
                  "
                  style={{ borderRadius: 1 }}
                >
                  {launching ? <Spinner size={12} /> : <ExternalIcon />}
                  <span>Open in external player</span>
                </button>

                <button
                  type="button"
                  onClick={handleStop}
                  disabled={stopping}
                  className="
                    focus-ring
                    w-full flex items-center justify-center gap-2
                    px-4 py-3
                    text-[11px] uppercase tracking-[0.2em] font-medium
                    text-bone-300/70 hover:text-bone-100
                    border border-ink-700/60 hover:border-ink-600
                    disabled:opacity-50 disabled:cursor-not-allowed
                    transition-colors
                  "
                  style={{ borderRadius: 1 }}
                >
                  {stopping ? <Spinner size={12} /> : null}
                  <span>{stopping ? 'Stopping' : 'Stop torrent'}</span>
                </button>
              </div>
            </aside>
          </div>
        )}
      </div>
    </div>
  );
}

function TopNav() {
  return (
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
  );
}

function StatsPanel({ torrent }: { torrent: TorrentDetail }) {
  return (
    <div
      className="border border-ink-700/60 bg-ink-900/60 p-4 space-y-3"
      style={{ borderRadius: 2 }}
    >
      <div>
        <div className="flex items-baseline justify-between mb-1.5">
          <span className="text-[10px] uppercase tracking-[0.25em] text-bone-300/60">
            Buffered
          </span>
          <span className="text-bone-50 tabular-nums text-sm">
            {formatPercent(torrent.progress)}
          </span>
        </div>
        <ProgressBar progress={torrent.progress} />
      </div>
      <div className="grid grid-cols-2 gap-3 pt-1">
        <Stat label="Peers" value={String(torrent.peers)} />
        <Stat label="Speed" value={formatRate(torrent.downloadRate)} />
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-[0.25em] text-bone-300/50 mb-0.5">
        {label}
      </p>
      <p className="text-bone-50 text-sm tabular-nums tracking-wide">{value}</p>
    </div>
  );
}

type FileEntry = TorrentDetail['files'][number];

function FilePicker({
  files,
  activeIdx,
  onSelect,
}: {
  files: FileEntry[];
  activeIdx: number | null;
  onSelect: (idx: number) => void;
}) {
  const sorted = [...files].sort((a, b) => b.size - a.size);
  return (
    <div>
      <p className="text-[10px] uppercase tracking-[0.25em] text-bone-300/60 mb-2">
        Files
      </p>
      <ul
        className="border border-ink-700/60 bg-ink-900/60 max-h-72 overflow-y-auto divide-y divide-ink-700/40"
        style={{ borderRadius: 2 }}
      >
        {sorted.map((f) => {
          const active = f.idx === activeIdx;
          const playable = isVideoFile(f.mimeType, f.path);
          const fileName = f.path.split('/').pop() ?? f.path;
          return (
            <li key={f.idx}>
              <button
                type="button"
                onClick={() => playable && onSelect(f.idx)}
                disabled={!playable}
                className={`
                  focus-ring
                  w-full text-left
                  px-3 py-2.5
                  flex items-center gap-2
                  transition-colors
                  ${active ? 'bg-ember-400/[0.08] text-ember-100' : 'text-bone-100/90 hover:bg-ink-800/80'}
                  ${!playable ? 'opacity-40 cursor-not-allowed' : ''}
                `}
                title={fileName}
              >
                <span
                  className={`flex-shrink-0 inline-block w-1 h-1 rounded-full ${active ? 'bg-ember-300' : 'bg-bone-300/30'}`}
                />
                <span className="flex-1 min-w-0 truncate text-xs">{fileName}</span>
                <span className="flex-shrink-0 text-[10px] tabular-nums text-bone-300/50">
                  {formatBytes(f.size)}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function PlayerSkeleton() {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px] gap-8 mt-6">
      <div
        className="w-full skeleton-shimmer"
        style={{ aspectRatio: '16 / 9', borderRadius: 2 }}
      />
      <div className="space-y-4">
        <div className="h-3 skeleton-shimmer w-1/3" style={{ borderRadius: 1 }} />
        <div className="h-8 skeleton-shimmer w-3/4" style={{ borderRadius: 2 }} />
        <div className="h-24 skeleton-shimmer w-full" style={{ borderRadius: 2 }} />
        <div className="h-10 skeleton-shimmer w-full" style={{ borderRadius: 1 }} />
        <div className="h-10 skeleton-shimmer w-full" style={{ borderRadius: 1 }} />
      </div>
    </div>
  );
}

function PlaybackOverlay({
  phase,
  peers,
  downloadRate,
  onExternal,
  launching,
  canLaunch,
}: {
  phase: PlaybackPhase;
  peers: number;
  downloadRate: number;
  onExternal: () => void;
  launching: boolean;
  canLaunch: boolean;
}) {
  const isError = phase === 'error';
  return (
    <div
      className="
        absolute inset-0 z-10
        flex flex-col items-center justify-center
        gap-4 px-6 text-center
        bg-black/70 backdrop-blur-sm
        animate-fade-in
        pointer-events-none
      "
    >
      {!isError && (
        <>
          <Spinner size={28} />
          <p className="text-[11px] uppercase tracking-[0.25em] text-ember-300/80">
            Подключение к swarm
          </p>
          <p className="text-bone-50 text-sm tabular-nums">
            peers: {peers} · {formatRate(downloadRate)}
          </p>
        </>
      )}
      {isError && (
        <>
          <p className="text-[11px] uppercase tracking-[0.25em] text-ember-300/80">
            Воспроизведение прервано
          </p>
          <p className="text-bone-50 text-base max-w-md tracking-tight">
            Не удалось загрузить — попробуй внешний плеер или другую раздачу
          </p>
          <button
            type="button"
            onClick={onExternal}
            disabled={launching || !canLaunch}
            className="
              focus-ring
              pointer-events-auto
              inline-flex items-center justify-center gap-2
              mt-2 px-6 py-3
              text-[11px] uppercase tracking-[0.2em] font-medium
              text-bone-50 bg-ember-400 hover:bg-ember-300
              disabled:opacity-60 disabled:cursor-not-allowed
              transition-colors
            "
            style={{ borderRadius: 1 }}
          >
            {launching ? <Spinner size={12} /> : <ExternalIcon />}
            <span>Открыть в плеере</span>
          </button>
        </>
      )}
    </div>
  );
}

function ExternalIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M14 4h6v6" />
      <path d="M10 14L20 4" />
      <path d="M20 14v6H4V4h6" />
    </svg>
  );
}
