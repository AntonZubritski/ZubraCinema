import { useEffect, useState } from 'react';
import type { Group } from '../api';
import { useHoverBackdrop } from '../lib/hoverBackdrop';
import { classifyQuality, type QualityBucket } from '../lib/sortFilter';

type Props = {
  group: Group;
  onClick: () => void;
};

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

// Pick the best quality bucket among a group's torrents.
// Order: 4k > 1080p > 720p > other. Returns null when nothing > other.
function bestQualityOf(group: Group): Exclude<QualityBucket, 'other'> | null {
  let has4k = false;
  let has1080 = false;
  let has720 = false;
  for (const t of group.torrents) {
    const q = classifyQuality(t.quality);
    if (q === '4k') has4k = true;
    else if (q === '1080p') has1080 = true;
    else if (q === '720p') has720 = true;
  }
  if (has4k) return '4k';
  if (has1080) return '1080p';
  if (has720) return '720p';
  return null;
}

// Total seeders across a group's torrents — used as the "rating-shaped"
// chip in the bottom-right corner. Lampa surfaces a TMDB rating there;
// we don't have per-card metadata yet, so we surface the swarm health
// instead. Same shape, honest data.
function totalSeeders(group: Group): number {
  let s = 0;
  for (const t of group.torrents) s += t.seeders;
  return s;
}

export function MovieCard({ group, onClick }: Props) {
  const [imgLoaded, setImgLoaded] = useState(false);
  const [imgFailed, setImgFailed] = useState(false);
  const { setHovered } = useHoverBackdrop();

  const hasCover = group.posterUrl.length > 0;
  const showFallback = !hasCover || imgFailed;
  const initials = initialsOf(group.title);
  const seeders = totalSeeders(group);
  const bestQ = bestQualityOf(group);

  // Tell the global hover-backdrop layer to clear when this card unmounts
  // (e.g. user navigates away mid-hover).
  useEffect(() => () => setHovered(null), [setHovered]);

  return (
    <button
      onClick={onClick}
      onMouseEnter={() => {
        if (hasCover && !imgFailed) setHovered(group.posterUrl);
      }}
      onMouseLeave={() => setHovered(null)}
      onFocus={() => {
        if (hasCover && !imgFailed) setHovered(group.posterUrl);
      }}
      onBlur={() => setHovered(null)}
      className="focus-ring group text-left flex flex-col gap-2 w-full"
    >
      <div
        className="
          relative w-full overflow-hidden
          bg-ink-850
          ring-1 ring-white/[0.04]
          shadow-md shadow-black/40
          transition-all duration-300
          group-hover:ring-white/30 group-hover:shadow-xl group-hover:shadow-black/60
          group-hover:-translate-y-0.5
        "
        style={{ aspectRatio: '2 / 3', borderRadius: 10 }}
      >
        {!imgLoaded && !imgFailed && hasCover && (
          <div className="absolute inset-0 skeleton-shimmer" />
        )}

        {showFallback ? (
          <PosterFallback initials={initials} />
        ) : (
          <img
            src={group.posterUrl}
            alt={group.title}
            loading="lazy"
            onLoad={() => setImgLoaded(true)}
            onError={() => setImgFailed(true)}
            className={`
              absolute inset-0 w-full h-full object-cover
              transition-all duration-500
              ${imgLoaded ? 'opacity-100' : 'opacity-0'}
              group-hover:scale-[1.02]
            `}
          />
        )}

        {/* Soft floor gradient — keeps the bottom chips legible on light
            posters without darkening the whole card. */}
        <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/65 via-black/30 to-transparent pointer-events-none" />

        {/* Hover dim — adds a soft black wash across the whole poster
            on hover so the active card visually drops back relative to
            the still-bright neighbours. Pointer-events-none so it doesn't
            block the click on the underlying button. */}
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors duration-300 pointer-events-none" />

        {/* Bottom-LEFT: quality chip. Lampa CUB anchors the format token
            here (yellow for premium tiers). */}
        {bestQ && (
          <div className="absolute bottom-2 left-2">
            <QualityChip quality={bestQ} />
          </div>
        )}

        {/* Bottom-RIGHT: dark pill shaped like Lampa's rating chip. We have
            no per-card rating yet, so we surface seeder count — the most
            honest at-a-glance signal we have for "is this worth opening". */}
        {seeders > 0 && (
          <div className="absolute bottom-2 right-2">
            <SeederChip seeders={seeders} />
          </div>
        )}
      </div>

      <div className="px-0.5">
        <h3 className="text-bone-50 text-[14px] font-medium leading-snug line-clamp-2 group-hover:text-white transition-colors">
          {group.title}
        </h3>
        <p className="text-bone-300/55 text-[11px] mt-0.5 tabular-nums">
          {group.year > 0 ? group.year : '—'}
        </p>
      </div>
    </button>
  );
}

// QualityChip — Lampa CUB-style format chip. Yellow/amber for 4K and
// FHD (the "premium" badges), grey for plain HD. Solid colour blocks
// match the look in the user's reference screenshots.
function QualityChip({ quality }: { quality: Exclude<QualityBucket, 'other'> }) {
  const palette: Record<Exclude<QualityBucket, 'other'>, { tone: string; label: string }> = {
    '4k': {
      tone: 'text-ink-950 bg-amber-400',
      label: '4K',
    },
    '1080p': {
      tone: 'text-ink-950 bg-yellow-400',
      label: 'FHD',
    },
    '720p': {
      tone: 'text-bone-50 bg-black/70',
      label: 'HD',
    },
  };
  const { tone, label } = palette[quality];
  return (
    <span
      className={`
        inline-block px-1.5 py-[2px]
        text-[10px] uppercase tracking-[0.06em] font-bold
        ${tone}
      `}
      style={{ borderRadius: 3 }}
    >
      {label}
    </span>
  );
}

// SeederChip — Lampa-rating-shaped pill. Number is colour-coded by swarm
// health so users see at a glance whether the release is streamable.
function SeederChip({ seeders }: { seeders: number }) {
  const tone =
    seeders >= 30
      ? 'text-emerald-300'
      : seeders >= 5
        ? 'text-amber-300'
        : 'text-red-400';
  const formatted = seeders >= 1000 ? `${Math.round(seeders / 100) / 10}K` : String(seeders);
  return (
    <span
      className="
        inline-flex items-center gap-1
        px-1.5 py-[2px]
        text-[11px] font-semibold tabular-nums
        bg-black/65 text-bone-50
        backdrop-blur-sm
      "
      style={{ borderRadius: 3 }}
      title={`${seeders} seeders`}
    >
      <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor" className={tone} aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
      </svg>
      {formatted}
    </span>
  );
}

function PosterFallback({ initials }: { initials: string }) {
  return (
    <div
      className="
        absolute inset-0
        bg-ink-900
        border border-ember-300/15
        flex items-center justify-center
        overflow-hidden
      "
    >
      <div className="absolute inset-0 bg-gradient-to-br from-ember-400/[0.04] via-transparent to-ember-400/[0.02] pointer-events-none" />
      <span
        className="
          font-display text-bone-50/40
          tracking-tightest leading-none
          select-none
        "
        style={{ fontSize: 'clamp(2.5rem, 6vw, 4rem)' }}
      >
        {initials}
      </span>
    </div>
  );
}
