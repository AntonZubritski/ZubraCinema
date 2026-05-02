import { useState } from 'react';
import type { Movie } from '../api';

type Props = {
  movie: Movie;
  onClick: () => void;
};

export function MovieCard({ movie, onClick }: Props) {
  const [imgLoaded, setImgLoaded] = useState(false);
  const [imgFailed, setImgFailed] = useState(false);

  const hasCover = movie.posterUrl && movie.posterUrl.length > 0;

  return (
    <button
      onClick={onClick}
      className="focus-ring group text-left flex flex-col gap-3"
    >
      <div
        className="
          relative w-full overflow-hidden
          bg-ink-800
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

        {!hasCover || imgFailed ? (
          <div className="absolute inset-0 flex items-center justify-center text-bone-300/40 text-xs uppercase tracking-widest">
            no cover
          </div>
        ) : (
          <img
            src={movie.posterUrl}
            alt={movie.title}
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

        <div className="absolute inset-0 bg-gradient-to-t from-ink-950/80 via-transparent to-transparent opacity-60 group-hover:opacity-90 transition-opacity" />

        {movie.rating > 0 && (
          <div
            className="
              absolute top-3 right-3
              px-2 py-1
              text-[10px] uppercase tracking-[0.15em] font-semibold
              bg-ink-950/80 backdrop-blur-sm text-ember-200
              border border-ember-300/20
            "
            style={{ borderRadius: 1 }}
          >
            {movie.rating.toFixed(1)}
          </div>
        )}

        <div
          className="
            absolute inset-x-0 bottom-0 p-4
            opacity-0 group-hover:opacity-100
            translate-y-1 group-hover:translate-y-0
            transition-all duration-300
          "
        >
          <span className="inline-block text-[11px] uppercase tracking-[0.2em] text-ember-200/90 font-medium">
            Open
          </span>
        </div>
      </div>

      <div className="px-0.5">
        <h3 className="text-bone-50 text-base font-medium leading-snug line-clamp-2 group-hover:text-ember-100 transition-colors">
          {movie.title}
        </h3>
        <p className="text-bone-300/60 text-xs mt-1 tracking-wide">
          {movie.year !== null ? movie.year : '—'}
        </p>
      </div>
    </button>
  );
}
