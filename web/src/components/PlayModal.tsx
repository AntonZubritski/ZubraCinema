import { useEffect, useState } from 'react';
import type { Movie, Magnet } from '../api';

type Props = {
  movie: Movie;
  onClose: () => void;
  onPlay: (magnet: Magnet) => Promise<void>;
};

export function PlayModal({ movie, onClose, onPlay }: Props) {
  const [busyQuality, setBusyQuality] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  const handlePick = async (m: Magnet) => {
    if (busyQuality) return;
    setBusyQuality(m.quality);
    setErrorMsg(null);
    try {
      await onPlay(m);
    } catch (e) {
      setBusyQuality(null);
      setErrorMsg(e instanceof Error ? e.message : 'Failed to start playback');
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-6 animate-fade-in"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-ink-950/85 backdrop-blur-md" />

      <div
        onClick={(e) => e.stopPropagation()}
        className="
          relative w-full max-w-md
          bg-ink-900 border border-ink-700/80
          shadow-2xl shadow-black/60
          animate-rise-in
        "
        style={{ borderRadius: 2 }}
      >
        <div className="flex gap-5 p-6 border-b border-ink-700/60">
          <div
            className="flex-shrink-0 w-20 bg-ink-800 overflow-hidden"
            style={{ aspectRatio: '2 / 3', borderRadius: 2 }}
          >
            <img
              src={movie.coverUrl}
              alt=""
              className="w-full h-full object-cover"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = 'none';
              }}
            />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] uppercase tracking-[0.2em] text-ember-300/70 mb-2">
              Choose quality
            </p>
            <h2 className="font-display text-2xl text-bone-50 leading-tight tracking-tightest">
              {movie.title}
            </h2>
            <p className="text-bone-300/60 text-sm mt-1">
              {movie.year > 0 && <span>{movie.year}</span>}
              {movie.rating > 0 && (
                <>
                  <span className="mx-2 text-bone-300/30">·</span>
                  <span className="text-ember-200">{movie.rating.toFixed(1)}</span>
                </>
              )}
            </p>
          </div>
        </div>

        <div className="p-6 space-y-2">
          {movie.magnets.length === 0 ? (
            <p className="text-bone-300/60 text-sm py-4 text-center">
              No magnets available for this title.
            </p>
          ) : (
            movie.magnets.map((m) => {
              const isBusy = busyQuality === m.quality;
              return (
                <button
                  key={`${m.quality}-${m.url}`}
                  onClick={() => handlePick(m)}
                  disabled={busyQuality !== null}
                  className="
                    focus-ring
                    w-full flex items-center justify-between
                    px-5 py-4
                    bg-ink-850 hover:bg-ink-800
                    border border-ink-700/60 hover:border-ember-300/40
                    transition-all
                    disabled:opacity-50
                    group
                  "
                  style={{ borderRadius: 2 }}
                >
                  <span className="text-bone-50 font-medium tracking-wide">
                    {m.quality}
                  </span>
                  <span
                    className={`
                      text-[10px] uppercase tracking-[0.2em]
                      ${isBusy ? 'text-ember-200' : 'text-bone-300/40 group-hover:text-ember-200'}
                      transition-colors
                    `}
                  >
                    {isBusy ? 'Opening…' : 'Play →'}
                  </span>
                </button>
              );
            })
          )}

          {errorMsg && (
            <p className="text-ember-200 text-sm pt-2 animate-fade-in">{errorMsg}</p>
          )}
        </div>

        <button
          onClick={onClose}
          aria-label="Close"
          className="focus-ring absolute top-3 right-3 p-2 text-bone-300/50 hover:text-bone-50 transition-colors"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
            <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    </div>
  );
}
