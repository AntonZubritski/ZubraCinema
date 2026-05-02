import type { Movie } from '../api';
import { MovieCard } from './MovieCard';

type Props = {
  movies: Movie[];
  onSelect: (movie: Movie) => void;
};

export function MovieGrid({ movies, onSelect }: Props) {
  return (
    <div
      className="
        grid gap-x-6 gap-y-10
        grid-cols-2
        sm:grid-cols-3
        md:grid-cols-4
        lg:grid-cols-5
        xl:grid-cols-6
        animate-fade-in
      "
    >
      {movies.map((m, i) => (
        <div
          key={m.tmdbId}
          className="animate-rise-in"
          style={{ animationDelay: `${Math.min(i, 12) * 30}ms`, animationFillMode: 'backwards' }}
        >
          <MovieCard movie={m} onClick={() => onSelect(m)} />
        </div>
      ))}
    </div>
  );
}

export function MovieGridSkeleton({ count = 12 }: { count?: number }) {
  return (
    <div
      className="
        grid gap-x-6 gap-y-10
        grid-cols-2
        sm:grid-cols-3
        md:grid-cols-4
        lg:grid-cols-5
        xl:grid-cols-6
      "
    >
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex flex-col gap-3">
          <div
            className="w-full skeleton-shimmer"
            style={{ aspectRatio: '2 / 3', borderRadius: 2 }}
          />
          <div className="h-4 skeleton-shimmer w-3/4" style={{ borderRadius: 1 }} />
          <div className="h-3 skeleton-shimmer w-1/4" style={{ borderRadius: 1 }} />
        </div>
      ))}
    </div>
  );
}
