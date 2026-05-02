import { useState } from 'react';
import type { Group } from '../api';

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

export function MovieCard({ group, onClick }: Props) {
  const [imgLoaded, setImgLoaded] = useState(false);
  const [imgFailed, setImgFailed] = useState(false);

  const hasCover = group.posterUrl.length > 0;
  const showFallback = !hasCover || imgFailed;
  const initials = initialsOf(group.title);
  const torrentCount = group.torrents.length;

  return (
    <button
      onClick={onClick}
      className="focus-ring group text-left flex flex-col gap-3"
    >
      <div
        className="
          relative w-full overflow-hidden
          bg-ink-900
          ring-1 ring-ink-700/60
          transition-all duration-300
          group-hover:ring-ember-300/40
          group-hover:-translate-y-0.5
        "
        style={{ aspectRatio: '2 / 3', borderRadius: 2 }}
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
              group-hover:scale-[1.03]
            `}
          />
        )}

        <div className="absolute inset-0 bg-gradient-to-t from-ink-950/80 via-transparent to-transparent opacity-60 group-hover:opacity-90 transition-opacity pointer-events-none" />

        {torrentCount > 0 && (
          <div
            className="
              absolute top-3 right-3
              px-2 py-1
              text-[10px] uppercase tracking-[0.15em] font-semibold
              bg-ink-950/80 backdrop-blur-sm text-ember-200
              border border-ember-300/20
              tabular-nums
            "
            style={{ borderRadius: 1 }}
          >
            {torrentCount}×
          </div>
        )}

        <div
          className="
            absolute inset-x-0 bottom-0 p-4
            opacity-0 group-hover:opacity-100
            translate-y-1 group-hover:translate-y-0
            transition-all duration-300
            pointer-events-none
          "
        >
          <span className="inline-block text-[11px] uppercase tracking-[0.2em] text-ember-200/90 font-medium">
            Open
          </span>
        </div>
      </div>

      <div className="px-0.5">
        <h3 className="text-bone-50 text-base font-medium leading-snug line-clamp-2 group-hover:text-ember-100 transition-colors">
          {group.title}
        </h3>
        <p className="text-bone-300/60 text-xs mt-1 tracking-wide tabular-nums">
          {group.year > 0 ? group.year : '—'}
        </p>
      </div>
    </button>
  );
}

function PosterFallback({ initials }: { initials: string }) {
  return (
    <div
      className="
        absolute inset-0
        bg-ink-900
        border border-ember-300/20
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
        style={{ fontSize: 'clamp(2.75rem, 6vw, 4.5rem)' }}
      >
        {initials}
      </span>
    </div>
  );
}
