import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  ApiError,
  fetchMovieMetadata,
  getUserdataMovie,
  setBookmark,
  setReaction,
  getSettings,
  startTorrent,
  type Group,
  type GroupTorrent,
  type MovieMetadata,
  type Reaction,
  type TorrentMode,
  type UserdataMovieState,
} from '../api';
import { SettingsModal } from '../components/SettingsModal';
import { Sidebar } from '../components/Sidebar';
import { TopBar } from '../components/TopBar';
import { TorrentRow } from '../components/TorrentRow';
import { useToast } from '../lib/toast';
import { sortTorrentsByLanguagePriority, classifyQuality } from '../lib/sortFilter';
import { streamabilityOf, type Streamability } from '../lib/quality';

type LocationState = { group?: Group } | null;

// ── helpers ──────────────────────────────────────────────────────────────────

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

const STREAMABILITY_TEXT: Record<Streamability, string> = {
  good: 'text-emerald-400',
  ok: 'text-amber-400',
  poor: 'text-red-400',
};

function formatRuntime(min: number): string {
  if (!Number.isFinite(min) || min <= 0) return '';
  const h = Math.floor(min / 60);
  const m = min % 60;
  const hh = h > 0 ? `${h}ч` : '';
  const mm = m > 0 ? `${m}м` : '';
  return [hh, mm].filter(Boolean).join(' ');
}

function formatBudget(n: number): string {
  if (!n || n <= 0) return '';
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1).replace(/\.0$/, '')}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(0)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n}`;
}

function bestQualityLabel(torrents: GroupTorrent[]): string {
  if (torrents.length === 0) return '';
  const order = ['4k', '1080p', '720p', 'other'];
  let best: GroupTorrent | null = null;
  let bestRank = order.length;
  for (const t of torrents) {
    const bucket = classifyQuality(t.quality);
    const rank = order.indexOf(bucket);
    if (rank !== -1 && rank < bestRank) {
      best = t;
      bestRank = rank;
    }
  }
  if (!best) best = torrents[0];
  if (best.quality && best.quality.length > 0) return best.quality;
  const bucket = classifyQuality(best.quality);
  if (bucket === '4k') return '4K';
  if (bucket === '1080p') return '1080p';
  if (bucket === '720p') return '720p';
  return '';
}

const STATUS_RU: Record<string, string> = {
  Released: 'Выпущенный',
  'In Production': 'В производстве',
  'Post Production': 'Пост-продакшен',
  Planned: 'Запланирован',
  Canceled: 'Отменён',
  Rumored: 'Слух',
};

function statusRu(raw: string): string {
  if (!raw) return '';
  return STATUS_RU[raw] ?? raw;
}

// ── main page ────────────────────────────────────────────────────────────────

export default function MoviePage() {
  const location = useLocation();
  const navigate = useNavigate();
  const showToast = useToast();
  const state = location.state as LocationState;
  const group = state?.group ?? null;

  const [busy, setBusy] = useState<{ id: string; mode: TorrentMode } | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showSidebar, setShowSidebar] = useState(false);
  const [adultEnabled, setAdultEnabled] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const s = await getSettings();
        if (!cancelled) setAdultEnabled(Boolean(s.adult));
      } catch {
        // best-effort
      }
    })();
    return () => { cancelled = true; };
  }, [showSettings]);

  const handlePick = useCallback(
    async (torrent: GroupTorrent, mode: TorrentMode) => {
      if (busy) return;
      setBusy({ id: torrent.id, mode });
      try {
        const session = await startTorrent(torrent.magnet, mode);
        if (mode === 'stream') {
          // Pass an `adult` hint so the player can start muted on 18+
          // content (avoids surprising loud audio in public). Detected
          // from the source — rintor is our adult tracker.
          const adult = torrent.source === 'rintor';
          navigate(`/play/${encodeURIComponent(session.id)}`, { state: { adult } });
          return;
        }
        const name = session.name || torrent.title;
        showToast('info', `Loading ${name}… open downloads strip to track`);
        setBusy(null);
      } catch (err) {
        const msg =
          err instanceof ApiError
            ? err.message
            : err instanceof Error
              ? err.message
              : 'Could not start torrent';
        showToast('error', msg);
        setBusy(null);
      }
    },
    [busy, navigate, showToast],
  );

  return (
    <div className="grain vignette min-h-screen relative">
      <TopBar
        title={group?.title}
        showBack
        onBack={() => navigate(-1)}
        onMenu={() => setShowSidebar(true)}
        onSettings={() => setShowSettings(true)}
      />
      <Sidebar
        open={showSidebar}
        onClose={() => setShowSidebar(false)}
        adultEnabled={adultEnabled}
      />
      <div className="relative z-10 max-w-[1500px] mx-auto px-8 lg:px-14 pt-4 pb-24">
        {group ? (
          <GroupView group={group} busy={busy} onPick={handlePick} showToast={showToast} />
        ) : (
          <MissingState />
        )}
      </div>
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
    </div>
  );
}

// ── GroupView ─────────────────────────────────────────────────────────────────

function GroupView({
  group,
  busy,
  onPick,
  showToast,
}: {
  group: Group;
  busy: { id: string; mode: TorrentMode } | null;
  onPick: (t: GroupTorrent, mode: TorrentMode) => void;
  showToast: (kind: 'info' | 'error', text: string) => void;
}) {
  const sortedTorrents = useMemo(
    () => sortTorrentsByLanguagePriority(group.torrents),
    [group.torrents],
  );

  const totalSeeders = useMemo(
    () => group.torrents.reduce((s, t) => s + t.seeders, 0),
    [group.torrents],
  );
  const maxSeeders = useMemo(
    () => group.torrents.reduce((m, t) => Math.max(m, t.seeders), 0),
    [group.torrents],
  );
  const stream = useMemo(() => streamabilityOf(group), [group]);
  const bestQuality = useMemo(() => bestQualityLabel(group.torrents), [group.torrents]);

  const [metadata, setMetadata] = useState<MovieMetadata | null>(null);
  const [userdata, setUserdata] = useState<UserdataMovieState>({
    myReaction: null,
    bookmarked: false,
    lastWatched: null,
  });

  // Fetch metadata + userdata in parallel on mount
  useEffect(() => {
    const ctrl = new AbortController();
    let cancelled = false;

    fetchMovieMetadata(group.title, group.year, ctrl.signal)
      .then((m) => { if (!cancelled) setMetadata(m); })
      .catch(() => { /* feature off — stay null */ });

    getUserdataMovie(group.id, ctrl.signal)
      .then((u) => { if (!cancelled) setUserdata(u); })
      .catch(() => { /* silent */ });

    return () => {
      cancelled = true;
      ctrl.abort();
    };
  }, [group.id, group.title, group.year]);

  // ── derived display values ────────────────────────────────────────────────

  const backdropUrl =
    (metadata && metadata.backdropUrl.length > 0 ? metadata.backdropUrl : '') ||
    group.posterUrl ||
    '';

  const runtime = formatRuntime(metadata?.runtimeMin ?? 0);
  const genresLine = (metadata?.genres ?? []).join(', ');
  const tmdbRating = metadata && metadata.voteAverage > 0 ? metadata.voteAverage.toFixed(1) : '';
  const imdbRating = metadata && metadata.imdbRating > 0 ? metadata.imdbRating.toFixed(1) : '';
  const kpRating = metadata && metadata.kpRating > 0 ? metadata.kpRating.toFixed(1) : '';
  const hasAnyRating = !!(tmdbRating || imdbRating || kpRating);

  const yearStr = group.year > 0 ? String(group.year) : (metadata?.year ?? 0) > 0 ? String(metadata!.year) : '';
  const countriesStr = (metadata?.countries ?? []).join(', ');
  const leadLine = [yearStr, countriesStr].filter(Boolean).join(', ');

  const statusRuStr = metadata ? statusRu(metadata.status) : '';
  const ageRating = metadata?.ageRating ?? '';
  const hasStatusPills = !!(ageRating || statusRuStr);

  const stripParts: string[] = [];
  if (runtime) stripParts.push(runtime);
  if (genresLine) stripParts.push(genresLine);
  if (bestQuality) stripParts.push(`Качество: ${bestQuality}`);

  // Footer: release date not in current type but budget + countries are
  const budgetStr = metadata ? formatBudget(metadata.budget) : '';
  const footerParts: string[] = [];
  if (budgetStr) footerParts.push(`Бюджет: ${budgetStr}`);
  if (countriesStr) footerParts.push(`Страны: ${countriesStr}`);

  const hasTrailer = metadata !== null && metadata.trailerKey.length > 0;

  // First available torrent for the Watch button
  const firstTorrent = sortedTorrents[0] ?? null;

  // ── reaction handler ──────────────────────────────────────────────────────

  const handleReaction = useCallback(
    async (emoji: Reaction) => {
      const prev = userdata.myReaction;
      const next: Reaction | null = prev === emoji ? null : emoji;
      // Optimistic update
      setUserdata((u) => ({ ...u, myReaction: next }));
      try {
        await setReaction(group.id, next);
      } catch {
        // Revert on failure
        setUserdata((u) => ({ ...u, myReaction: prev }));
        showToast('error', 'Не удалось сохранить реакцию');
      }
    },
    [group.id, userdata.myReaction, showToast],
  );

  // ── bookmark handler ──────────────────────────────────────────────────────

  const handleBookmark = useCallback(async () => {
    const prev = userdata.bookmarked;
    const next = !prev;
    setUserdata((u) => ({ ...u, bookmarked: next }));
    try {
      await setBookmark(group.id, next, {
        title: group.title,
        posterUrl: group.posterUrl || '',
        year: group.year,
      });
    } catch {
      setUserdata((u) => ({ ...u, bookmarked: prev }));
      showToast('error', 'Не удалось сохранить закладку');
    }
  }, [group.id, group.title, group.posterUrl, group.year, userdata.bookmarked, showToast]);

  // ── cast overlay ──────────────────────────────────────────────────────────

  const castNames = (metadata?.cast ?? []).slice(0, 15).map((p) => p.name);

  return (
    <div className="animate-fade-in relative">
      {/* BACKDROP */}
      {backdropUrl && (
        <div
          aria-hidden
          className="pointer-events-none absolute -top-32 left-1/2 -translate-x-1/2 w-screen h-[700px] md:h-[750px] overflow-hidden -z-10"
        >
          <div
            className="absolute inset-0 bg-cover bg-center"
            style={{ backgroundImage: `url(${backdropUrl})` }}
          />
          {/* Darken overlay — "heavy" per spec */}
          <div
            className="absolute inset-0"
            style={{
              backgroundImage:
                'linear-gradient(to bottom, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.88) 55%, #08090d 100%)',
            }}
          />
          {/* Side fades */}
          <div
            className="absolute inset-0"
            style={{
              backgroundImage:
                'linear-gradient(to right, #08090d 0%, rgba(0,0,0,0) 15%, rgba(0,0,0,0) 85%, #08090d 100%)',
            }}
          />
          {/* Cast names overlay — faint large column on the right of backdrop */}
          {castNames.length > 0 && (
            <div
              aria-hidden
              className="absolute right-[6%] top-8 bottom-8 flex flex-col justify-start gap-1 pointer-events-none select-none overflow-hidden"
              style={{ opacity: 0.18 }}
            >
              {castNames.map((name, i) => (
                <span
                  key={i}
                  className="text-bone-100 text-[11px] leading-tight tracking-wide whitespace-nowrap"
                >
                  {name}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="mt-10 md:mt-14">
        {/* ── TWO-COLUMN HERO ────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 md:grid-cols-[220px_minmax(0,1fr)] lg:grid-cols-[260px_minmax(0,1fr)] gap-8 md:gap-12">
          {/* LEFT: poster */}
          <div className="md:sticky md:top-20 self-start">
            <Poster posterUrl={group.posterUrl} title={group.title} />
          </div>

          {/* RIGHT: meta column */}
          <div className="min-w-0">
            {/* Lead line: year, countries */}
            {leadLine && (
              <p className="text-[11px] uppercase tracking-[0.25em] text-bone-300/70 mb-3 tabular-nums">
                {leadLine}
              </p>
            )}

            {/* Title */}
            <h1 className="text-5xl md:text-6xl font-bold text-bone-50 leading-[1.02] tracking-tight break-words line-clamp-2">
              {group.title}
            </h1>

            {/* Tagline */}
            {metadata?.tagline && (
              <p className="mt-2 text-lg italic text-bone-200/85 max-w-3xl leading-snug">
                «{metadata.tagline}»
              </p>
            )}

            {/* Rating chips row */}
            {hasAnyRating && (
              <div className="mt-5 flex items-center flex-wrap gap-2">
                {tmdbRating && (
                  <RatingChip label="TMDB" value={tmdbRating} />
                )}
                {imdbRating && (
                  <RatingChip label="IMDB" value={imdbRating} />
                )}
                {kpRating && (
                  <RatingChip label="КП" value={kpRating} />
                )}
              </div>
            )}

            {/* Status pills row */}
            {hasStatusPills && (
              <div className="mt-3 flex items-center flex-wrap gap-2">
                {ageRating && (
                  <span
                    className="
                      inline-flex items-center
                      px-2.5 py-0.5
                      text-[11px] font-semibold uppercase tracking-[0.15em]
                      text-bone-200 ring-1 ring-bone-300/20
                      bg-white/[0.05]
                    "
                    style={{ borderRadius: 3 }}
                  >
                    {ageRating}
                  </span>
                )}
                {statusRuStr && (
                  <span
                    className="
                      inline-flex items-center
                      px-2.5 py-0.5
                      text-[11px] font-medium
                      text-bone-300/80 ring-1 ring-bone-300/15
                      bg-white/[0.04]
                    "
                    style={{ borderRadius: 3 }}
                  >
                    {statusRuStr}
                  </span>
                )}
              </div>
            )}

            {/* Info strip: runtime · genres · quality */}
            {stripParts.length > 0 && (
              <div className="mt-4 flex items-center flex-wrap gap-x-2 gap-y-1 text-[12px] text-bone-200/85 tracking-tight">
                {stripParts.map((part, i) => (
                  <span key={i} className="flex items-center gap-2">
                    {i > 0 && <span className="text-bone-300/30">·</span>}
                    <span>{part}</span>
                  </span>
                ))}
              </div>
            )}

            {/* Seeder summary chips */}
            <div className="mt-3 flex items-center flex-wrap gap-x-3 gap-y-1 text-[11px] uppercase tracking-[0.25em] tabular-nums">
              <span className="text-ember-300 font-semibold">
                {group.torrents.length}
              </span>
              <span className="text-bone-300/70">
                release{group.torrents.length === 1 ? '' : 's'}
              </span>
              {totalSeeders > 0 && (
                <>
                  <span className="text-bone-300/30">·</span>
                  <span className="text-ember-300 font-semibold">{totalSeeders}</span>
                  <span className="text-bone-300/70">seeders</span>
                </>
              )}
              {maxSeeders > 0 && (
                <>
                  <span className="text-bone-300/30">·</span>
                  <span className="text-bone-300/70">best</span>
                  <span className={`font-semibold ${STREAMABILITY_TEXT[stream]}`}>
                    {maxSeeders}
                  </span>
                </>
              )}
            </div>

            {/* Reactions row */}
            <ReactionsRow myReaction={userdata.myReaction} onReact={handleReaction} />

            {/* Action rail */}
            <ActionRail
              bookmarked={userdata.bookmarked}
              onBookmark={handleBookmark}
              onWatch={() => { if (firstTorrent) onPick(firstTorrent, 'stream'); }}
              watchDisabled={!firstTorrent || busy !== null}
              trailerKey={metadata?.trailerKey ?? ''}
            />

            {/* "Подробно" section */}
            {metadata && metadata.overview && (
              <div className="mt-8 md:mt-10">
                <SectionLabel>Подробно</SectionLabel>
                <p className="text-bone-200/90 text-sm md:text-[15px] leading-relaxed tracking-tight max-w-[60ch]">
                  {metadata.overview}
                </p>
              </div>
            )}

            {/* Footer info row */}
            {footerParts.length > 0 && (
              <div className="mt-6 flex items-center flex-wrap gap-x-2 gap-y-1 text-[12px] text-bone-300/60 tracking-tight tabular-nums">
                {footerParts.map((part, i) => (
                  <span key={i} className="flex items-center gap-2">
                    {i > 0 && <span className="text-bone-300/20">·</span>}
                    <span>{part}</span>
                  </span>
                ))}
              </div>
            )}

            {/* Trailer */}
            {hasTrailer && metadata && (
              <div className="mt-8 md:mt-10">
                <SectionLabel>Трейлер</SectionLabel>
                <div
                  className="relative w-full overflow-hidden bg-ink-900 ring-1 ring-ink-700/60"
                  style={{ aspectRatio: '16 / 9', borderRadius: 2 }}
                >
                  <iframe
                    src={`https://www.youtube.com/embed/${metadata.trailerKey}?rel=0`}
                    title="Trailer"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                    className="absolute inset-0 w-full h-full border-0"
                  />
                </div>
              </div>
            )}

            {metadata && (
              <p className="mt-6 text-bone-300/40 text-[10px] uppercase tracking-[0.25em]">
                Powered by TMDB
              </p>
            )}
          </div>
        </div>

        {/* ── TORRENTS ─────────────────────────────────────────────────────── */}
        <div className="mt-12 md:mt-14">
          <SectionLabel>Доступные раздачи</SectionLabel>

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
                  busy={busy && busy.id === t.id ? busy.mode : null}
                  disabled={busy !== null && busy.id !== t.id}
                  onPick={onPick}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── RatingChip ────────────────────────────────────────────────────────────────

function RatingChip({ label, value }: { label: string; value: string }) {
  return (
    <span
      className="
        inline-flex items-center gap-1.5
        px-3 py-1
        bg-white/[0.06] ring-1 ring-white/10
        tabular-nums
      "
      style={{ borderRadius: 20 }}
    >
      <span className="text-[15px] font-bold leading-none text-bone-50">{value}</span>
      <span className="text-[10px] uppercase tracking-[0.18em] text-bone-300/60 leading-none">{label}</span>
    </span>
  );
}

// ── ReactionsRow ──────────────────────────────────────────────────────────────

type ReactionDef = {
  key: Reaction;
  emoji: string;
  activeBg: string;
  activeRing: string;
};

const REACTIONS: ReactionDef[] = [
  { key: 'fire', emoji: '🔥', activeBg: 'bg-red-500/20',    activeRing: 'ring-red-400/60' },
  { key: 'like', emoji: '👍', activeBg: 'bg-blue-500/20',   activeRing: 'ring-blue-400/60' },
  { key: 'meh',  emoji: '😕', activeBg: 'bg-yellow-500/20', activeRing: 'ring-yellow-400/60' },
  { key: 'wow',  emoji: '😍', activeBg: 'bg-pink-500/20',   activeRing: 'ring-pink-400/60' },
  { key: 'poop', emoji: '💩', activeBg: 'bg-amber-900/30',  activeRing: 'ring-amber-700/50' },
];

function ReactionsRow({
  myReaction,
  onReact,
}: {
  myReaction: Reaction | null;
  onReact: (r: Reaction) => void;
}) {
  return (
    <div className="mt-5 flex items-center gap-2 flex-wrap">
      {REACTIONS.map(({ key, emoji, activeBg, activeRing }) => {
        const active = myReaction === key;
        const count = active ? 1 : 0;
        return (
          <button
            key={key}
            type="button"
            onClick={() => onReact(key)}
            className={`
              focus-ring
              inline-flex items-center gap-1.5
              px-3 py-1.5
              text-[13px] leading-none
              transition-all
              ${active
                ? `${activeBg} ring-1 ${activeRing}`
                : 'bg-white/[0.05] ring-1 ring-white/[0.08] hover:bg-white/[0.10]'
              }
            `}
            style={{ borderRadius: 20 }}
            aria-pressed={active}
            aria-label={key}
          >
            <span>{emoji}</span>
            <span className="text-[11px] font-semibold tabular-nums text-bone-200/80">{count}</span>
          </button>
        );
      })}
    </div>
  );
}

// ── ActionRail ────────────────────────────────────────────────────────────────

function ActionRail({
  bookmarked,
  onBookmark,
  onWatch,
  watchDisabled,
  trailerKey,
}: {
  bookmarked: boolean;
  onBookmark: () => void;
  onWatch: () => void;
  watchDisabled: boolean;
  trailerKey: string;
}) {
  const btnBase = `
    focus-ring
    flex items-center justify-center gap-1.5
    h-11 px-4
    text-[11px] uppercase tracking-[0.15em] font-medium
    bg-white/[0.06] hover:bg-white/[0.12]
    text-bone-100
    transition-colors
    disabled:opacity-40 disabled:cursor-not-allowed
  `;

  return (
    <div className="mt-5 flex items-center flex-wrap gap-2">
      {/* Watch */}
      <button
        type="button"
        disabled={watchDisabled}
        onClick={onWatch}
        className={`${btnBase} min-w-[100px]`}
        style={{ borderRadius: 22 }}
        aria-label="Watch"
      >
        <PlaySvg />
        <span>Смотреть</span>
      </button>

      {/* Bookmark */}
      <button
        type="button"
        onClick={onBookmark}
        className={`${btnBase} w-11 px-0 ${bookmarked ? 'text-ember-300 bg-ember-400/[0.12] ring-1 ring-ember-300/40' : ''}`}
        style={{ borderRadius: 22 }}
        aria-label="Bookmark"
        aria-pressed={bookmarked}
      >
        <BookmarkSvg filled={bookmarked} />
      </button>

      {/* Random (decorative) */}
      <button
        type="button"
        className={`${btnBase} w-11 px-0`}
        style={{ borderRadius: 22 }}
        aria-label="Random"
        disabled
      >
        <DiceSvg />
      </button>

      {/* More (decorative) */}
      <button
        type="button"
        className={`${btnBase} w-11 px-0`}
        style={{ borderRadius: 22 }}
        aria-label="More"
        disabled
      >
        <MoreSvg />
      </button>

      {/* Comments (decorative) */}
      <button
        type="button"
        className={`${btnBase} w-11 px-0`}
        style={{ borderRadius: 22 }}
        aria-label="Comments"
        disabled
      >
        <CommentSvg />
      </button>

      {/* Trailer link — only when we have a key */}
      {trailerKey && (
        <a
          href={`https://www.youtube.com/watch?v=${trailerKey}`}
          target="_blank"
          rel="noopener noreferrer"
          className={`${btnBase} min-w-[90px] no-underline`}
          style={{ borderRadius: 22 }}
          aria-label="Trailer"
        >
          <TrailerSvg />
          <span>Трейлер</span>
        </a>
      )}
    </div>
  );
}

// ── SVG icons (inline, no library) ───────────────────────────────────────────

function PlaySvg() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M6 4l14 8-14 8z" />
    </svg>
  );
}

function BookmarkSvg({ filled }: { filled: boolean }) {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function DiceSvg() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="2" y="2" width="20" height="20" rx="3" ry="3" />
      <circle cx="8" cy="8" r="1.5" fill="currentColor" />
      <circle cx="16" cy="8" r="1.5" fill="currentColor" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" />
      <circle cx="8" cy="16" r="1.5" fill="currentColor" />
      <circle cx="16" cy="16" r="1.5" fill="currentColor" />
    </svg>
  );
}

function MoreSvg() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <circle cx="5" cy="12" r="2" />
      <circle cx="12" cy="12" r="2" />
      <circle cx="19" cy="12" r="2" />
    </svg>
  );
}

function CommentSvg() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function TrailerSvg() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polygon points="23 7 16 12 23 17 23 7" />
      <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
    </svg>
  );
}

// ── Poster ────────────────────────────────────────────────────────────────────

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
        shadow-2xl shadow-ink-950/60
      "
      style={{ aspectRatio: '2 / 3', borderRadius: 4 }}
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
            className="font-display text-bone-50/40 tracking-tightest leading-none select-none"
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

// ── MissingState ──────────────────────────────────────────────────────────────

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

// ── SectionLabel ──────────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-4 flex items-center gap-4">
      <span className="text-bone-300/50 text-[11px] uppercase tracking-[0.25em]">
        {children}
      </span>
      <span className="flex-1 h-px bg-ink-700/60" />
    </div>
  );
}
