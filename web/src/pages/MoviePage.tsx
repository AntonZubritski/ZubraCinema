import { useCallback, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  ApiError,
  startTorrent,
  type Group,
  type GroupTorrent,
} from '../api';
import { TorrentRow } from '../components/TorrentRow';
import { useToast } from '../lib/toast';

type LocationState = { group?: Group } | null;

function initialsOf(title: string): string {
  const cleaned = title.trim();
  if (!cleaned) return '??';
  const words = cleaned.split(/\s+/).filter((w) => w.length > 0);
  if (words.length === 0) return '??';
  if (words.length === 1) {
    const w = words[0];
    return (w.length >= 2 ? w.slice(0, 2) : w).toUpperCase();
  }
  return (words[0][0] + words[1][0]).toUpperCase();
}

export default function MoviePage() {
  const location = useLocation();
  const navigate = useNavigate();
  const showToast = useToast();
  const state = location.state as LocationState;
  const group = state?.group ?? null;

  const [busyTorrentId, setBusyTorrentId] = useState<string | null>(null);

  const handlePick = useCallback(
    async (torrent: GroupTorrent) => {
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
      <div className="relative z-10 max-w-[1500px] mx-auto px-8 lg:px-14 pt-8 pb-24">
        <TopNav />
        {group ? (
          <GroupView
            group={group}
            busyTorrentId={busyTorrentId}
            onPick={handlePick}
          />
        ) : (
          <MissingState />
        )}
      </div>
    </div>
  );
}

function GroupView({
  group,
  busyTorrentId,
  onPick,
}: {
  group: Group;
  busyTorrentId: string | null;
  onPick: (t: GroupTorrent) => void;
}) {
  const sortedTorrents = [...group.torrents].sort((a, b) => b.seeders - a.seeders);

  return (
    <div className="mt-10 md:mt-14 animate-fade-in">
      <div className="grid grid-cols-1 md:grid-cols-[220px_minmax(0,1fr)] lg:grid-cols-[260px_minmax(0,1fr)] gap-8 md:gap-12">
        <div className="md:sticky md:top-8 self-start">
          <Poster posterUrl={group.posterUrl} title={group.title} />
        </div>

        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-[0.25em] text-ember-300/70 mb-3">
            Title
          </p>
          <h1 className="font-display text-4xl md:text-5xl lg:text-6xl text-bone-50 tracking-tightest leading-[1.05] break-words">
            {group.title}
          </h1>
          <div className="mt-4 flex items-center flex-wrap gap-x-3 gap-y-1 text-[11px] uppercase tracking-[0.25em]">
            {group.year > 0 && (
              <>
                <span className="text-bone-300/70 tabular-nums">{group.year}</span>
                <span className="text-bone-300/30">·</span>
              </>
            )}
            <span className="text-ember-300 font-semibold tabular-nums">
              {group.torrents.length}
            </span>
            <span className="text-bone-300/70">
              release{group.torrents.length === 1 ? '' : 's'}
            </span>
          </div>

          <div className="mt-10 md:mt-12">
            <SectionLabel>Available torrents</SectionLabel>

            {sortedTorrents.length === 0 ? (
              <div className="text-center py-12 max-w-md mx-auto animate-fade-in">
                <p className="font-display italic text-xl md:text-2xl text-bone-200/70 leading-relaxed tracking-tight">
                  "Nothing playable on this reel."
                </p>
              </div>
            ) : (
              <div className="space-y-2 animate-fade-in">
                {sortedTorrents.map((t) => (
                  <TorrentRow
                    key={t.id}
                    torrent={t}
                    busy={busyTorrentId === t.id}
                    disabled={busyTorrentId !== null && busyTorrentId !== t.id}
                    onPick={onPick}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Poster({ posterUrl, title }: { posterUrl: string; title: string }) {
  const [failed, setFailed] = useState(false);
  const showFallback = posterUrl.length === 0 || failed;
  const initials = initialsOf(title);

  return (
    <div
      className="
        relative w-full overflow-hidden
        bg-ink-900
        ring-1 ring-ink-700/60
      "
      style={{ aspectRatio: '2 / 3', borderRadius: 2 }}
    >
      {showFallback ? (
        <div
          className="
            absolute inset-0
            border border-ember-300/20
            flex items-center justify-center
            overflow-hidden
          "
        >
          <div className="absolute inset-0 bg-gradient-to-br from-ember-400/[0.05] via-transparent to-ember-400/[0.02] pointer-events-none" />
          <span
            className="
              font-display text-bone-50/40
              tracking-tightest leading-none
              select-none
            "
            style={{ fontSize: 'clamp(3.5rem, 8vw, 6rem)' }}
          >
            {initials}
          </span>
        </div>
      ) : (
        <img
          src={posterUrl}
          alt={title}
          onError={() => setFailed(true)}
          className="absolute inset-0 w-full h-full object-cover"
        />
      )}
    </div>
  );
}

function MissingState() {
  return (
    <div className="mt-24 max-w-xl mx-auto text-center animate-fade-in">
      <p className="text-[11px] uppercase tracking-[0.25em] text-ember-300/80 mb-4">
        Off the reel
      </p>
      <h1 className="font-display text-3xl md:text-4xl text-bone-50 tracking-tightest leading-[1.1]">
        Not found in current results
      </h1>
      <p className="mt-5 text-bone-200/70 text-base leading-relaxed tracking-tight">
        This page only lives while you have search results loaded. Run the search again to
        pick a release.
      </p>
      <Link
        to="/"
        className="
          focus-ring
          inline-flex items-center
          mt-8 px-6 py-3
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
