import type { Torrent } from '../api';
import { formatBytes } from '../lib/format';
import { Spinner } from './Spinner';

type Props = {
  torrent: Torrent;
  busy: boolean;
  disabled: boolean;
  onPick: (torrent: Torrent) => void;
};

export function TorrentRow({ torrent, busy, disabled, onPick }: Props) {
  const seedersTone =
    torrent.seeders >= 50
      ? 'text-ember-200'
      : torrent.seeders >= 10
        ? 'text-bone-50'
        : 'text-bone-300/50';

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onPick(torrent)}
      className="
        focus-ring group
        w-full flex items-center gap-4 md:gap-6
        px-4 md:px-5 py-3 md:py-4
        bg-ink-900/60
        border border-ink-700/60
        hover:border-ember-300/40 hover:bg-ink-850
        disabled:opacity-50 disabled:cursor-not-allowed
        transition-all
        text-left
      "
      style={{ borderRadius: 2 }}
    >
      <div className={`flex-shrink-0 w-16 md:w-20 text-xs md:text-sm tabular-nums tracking-wide ${seedersTone}`}>
        <span className="font-medium">{torrent.seeders}</span>
        <span className="text-bone-300/30 mx-1">/</span>
        <span className="text-bone-300/40">{torrent.leechers}</span>
      </div>

      {torrent.quality && (
        <span
          className="
            flex-shrink-0
            hidden sm:inline-block
            px-2 py-0.5
            text-[10px] uppercase tracking-[0.18em] font-semibold
            text-ember-200 border border-ember-300/30
            bg-ember-400/[0.04]
          "
          style={{ borderRadius: 1 }}
        >
          {torrent.quality}
        </span>
      )}

      <div className="flex-shrink-0 w-20 text-xs text-bone-300/70 tabular-nums">
        {formatBytes(torrent.size)}
      </div>

      <span
        className="
          flex-shrink-0
          hidden md:inline-block
          px-2 py-0.5
          text-[10px] uppercase tracking-[0.2em] font-medium
          text-bone-300/70 border border-ink-600
        "
        style={{ borderRadius: 1 }}
      >
        {torrent.source}
      </span>

      <div className="flex-1 min-w-0 text-sm text-bone-100/90 truncate" title={torrent.title}>
        {torrent.title}
      </div>

      <div
        className="
          flex-shrink-0 flex items-center gap-2
          px-3 md:px-4 py-1.5
          text-[11px] uppercase tracking-[0.2em] font-medium
          text-bone-50
          bg-ember-400 group-hover:bg-ember-300
          group-disabled:bg-ink-700 group-disabled:text-bone-300/40
          transition-colors
        "
        style={{ borderRadius: 1 }}
      >
        {busy ? (
          <>
            <Spinner size={12} />
            <span>Loading</span>
          </>
        ) : (
          <>
            <PlayIcon />
            <span>Watch</span>
          </>
        )}
      </div>
    </button>
  );
}

function PlayIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M6 4l14 8-14 8z" />
    </svg>
  );
}

export function TorrentRowSkeleton() {
  return (
    <div
      className="
        w-full flex items-center gap-4 md:gap-6
        px-4 md:px-5 py-3 md:py-4
        border border-ink-700/40
      "
      style={{ borderRadius: 2 }}
    >
      <div className="flex-shrink-0 w-16 md:w-20 h-3 skeleton-shimmer" style={{ borderRadius: 1 }} />
      <div className="flex-shrink-0 hidden sm:block w-12 h-4 skeleton-shimmer" style={{ borderRadius: 1 }} />
      <div className="flex-shrink-0 w-20 h-3 skeleton-shimmer" style={{ borderRadius: 1 }} />
      <div className="flex-shrink-0 hidden md:block w-14 h-4 skeleton-shimmer" style={{ borderRadius: 1 }} />
      <div className="flex-1 h-3 skeleton-shimmer" style={{ borderRadius: 1 }} />
      <div className="flex-shrink-0 w-20 h-7 skeleton-shimmer" style={{ borderRadius: 1 }} />
    </div>
  );
}
