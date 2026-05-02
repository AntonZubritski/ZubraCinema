import { useState } from 'react';
import type { MovieDetail } from '../api';
import { formatDuration } from '../lib/format';

type Props = {
  movie: MovieDetail;
};

export function MovieHero({ movie }: Props) {
  const [posterFailed, setPosterFailed] = useState(false);
  const showOriginal =
    movie.originalTitle &&
    movie.originalTitle.trim().length > 0 &&
    movie.originalTitle !== movie.title;

  const metaParts: string[] = [];
  if (movie.year !== null) metaParts.push(String(movie.year));
  const runtime = formatDuration(movie.runtime);
  if (runtime) metaParts.push(runtime);
  for (const g of movie.genres) metaParts.push(g);

  return (
    <section className="relative w-full">
      <div
        className="relative w-full overflow-hidden"
        style={{ height: 'min(50vh, 540px)' }}
      >
        {movie.backdropUrl ? (
          <img
            src={movie.backdropUrl}
            alt=""
            className="absolute inset-0 w-full h-full object-cover"
          />
        ) : (
          <div className="absolute inset-0 bg-ink-900" />
        )}
        <div className="absolute inset-0 bg-gradient-to-b from-ink-950/40 via-ink-950/70 to-ink-950" />
        <div className="absolute inset-0 bg-gradient-to-r from-ink-950/80 via-transparent to-ink-950/20" />
      </div>

      <div className="max-w-[1500px] mx-auto px-8 lg:px-14 -mt-32 md:-mt-40 relative z-10">
        <div className="flex flex-col md:flex-row gap-8 md:gap-10 items-start">
          <div
            className="flex-shrink-0 w-44 md:w-[280px] bg-ink-800 ring-1 ring-ink-700/60 overflow-hidden"
            style={{ aspectRatio: '2 / 3', borderRadius: 2 }}
          >
            {movie.posterUrl && !posterFailed ? (
              <img
                src={movie.posterUrl}
                alt={movie.title}
                onError={() => setPosterFailed(true)}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-bone-300/40 text-xs uppercase tracking-widest">
                no cover
              </div>
            )}
          </div>

          <div className="flex-1 min-w-0 pt-2 md:pt-16">
            <h1 className="font-display text-4xl md:text-6xl text-bone-50 tracking-tightest leading-[1.05]">
              {movie.title}
            </h1>
            {showOriginal && (
              <p className="font-display italic text-bone-300/50 text-lg md:text-xl mt-2 tracking-tight">
                {movie.originalTitle}
              </p>
            )}

            {(metaParts.length > 0 || movie.rating > 0) && (
              <div className="mt-5 flex items-center flex-wrap gap-x-3 gap-y-1 text-[11px] uppercase tracking-[0.25em]">
                {movie.rating > 0 && (
                  <span className="text-ember-300 font-semibold">
                    {movie.rating.toFixed(1)}
                  </span>
                )}
                {movie.rating > 0 && metaParts.length > 0 && (
                  <span className="text-bone-300/30">·</span>
                )}
                {metaParts.map((part, i) => (
                  <span key={`${part}-${i}`} className="flex items-center gap-3">
                    <span className="text-bone-300/70">{part}</span>
                    {i < metaParts.length - 1 && (
                      <span className="text-bone-300/30">·</span>
                    )}
                  </span>
                ))}
              </div>
            )}

            {movie.overview && (
              <p className="mt-6 text-bone-200/80 text-base leading-relaxed max-w-2xl tracking-tight">
                {movie.overview}
              </p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
