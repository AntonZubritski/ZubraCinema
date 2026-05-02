import type { GroupTorrent, TorrentMode } from '../api';
import { formatBytes } from '../lib/format';
import { normalizeLanguage } from '../lib/lang';
import { LanguageBadge } from './LanguageBadge';
import { Spinner } from './Spinner';

type Props = {
  torrent: GroupTorrent;
  busy: TorrentMode | null;
  disabled: boolean;
  onPick: (torrent: GroupTorrent, mode: TorrentMode) => void;
};

export function TorrentRow({ torrent, busy, disabled, onPick }: Props) {
  const seedersTone =
    torrent.seeders >= 50
      ? 'text-ember-200'
      : torrent.seeders >= 10
        ? 'text-bone-50'
        : 'text-bone-300/50';

  const lang = normalizeLanguage(torrent.language);

  return (
    <div
      className="
        group
        w-full flex items-center gap-3 md:gap-5
        px-4 md:px-5 py-3 md:py-4
        bg-ink-900/60
        border border-ink-700/60
        hover:border-ember-300/40 hover:bg-ink-850
        transition-colors
        text-left
      "
      style={{ borderRadius: 2 }}
    >
      <div className={`flex-shrink-0 w-16 md:w-20 text-xs md:text-sm tabular-nums tracking-wide ${seedersTone}`}>
        <span className="font-medium">{torrent.seeders}</span>
        <span className="text-bone-300/30 mx-1">/</span>
        <span className="text-bone-300/40">{torrent.leechers}</span>
      </div>

      <div className="flex-shrink-0 flex items-center gap-1.5">
        {torrent.quality && (
          <span
            className="
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
        <LanguageBadge language={lang} variant="inline" />
      </div>

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

      <div className="flex-shrink-0 flex items-center gap-1.5">
        <ActionButton
          variant="primary"
          busy={busy === 'stream'}
          disabled={disabled}
          onClick={() => onPick(torrent, 'stream')}
          icon={<PlayIcon />}
          label="Watch"
        />
        <ActionButton
          variant="outline"
          busy={busy === 'download'}
          disabled={disabled}
          onClick={() => onPick(torrent, 'download')}
          icon={<DownloadIcon />}
          label="Download"
        />
      </div>
    </div>
  );
}

function ActionButton({
  variant,
  busy,
  disabled,
  onClick,
  icon,
  label,
}: {
  variant: 'primary' | 'outline';
  busy: boolean;
  disabled: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  const base =
    'focus-ring flex items-center gap-1.5 px-2.5 md:px-3 py-1.5 text-[11px] uppercase tracking-[0.2em] font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed';
  const skin =
    variant === 'primary'
      ? 'text-bone-50 bg-ember-400 hover:bg-ember-300'
      : 'text-ember-200 border border-ember-300/40 hover:bg-ember-400/[0.08] hover:border-ember-300/70';

  return (
    <button
      type="button"
      disabled={disabled || busy}
      onClick={onClick}
      className={`${base} ${skin}`}
      style={{ borderRadius: 1 }}
      aria-label={label}
    >
      {busy ? <Spinner size={12} /> : icon}
      <span className="hidden sm:inline">{busy ? '…' : label}</span>
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

function DownloadIcon() {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 3v12" />
      <path d="m6 11 6 6 6-6" />
      <path d="M5 21h14" />
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
