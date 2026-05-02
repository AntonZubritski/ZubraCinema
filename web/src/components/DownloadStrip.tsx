import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { listActiveTorrents, type ActiveTorrent } from '../api';
import { ProgressBar } from './ProgressBar';

const POLL_MS = 3000;

export function DownloadStrip() {
  const [torrents, setTorrents] = useState<ActiveTorrent[]>([]);
  const navigate = useNavigate();
  const location = useLocation();
  const onPlayPage = location.pathname.startsWith('/play/');

  useEffect(() => {
    if (onPlayPage) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      try {
        const ac = new AbortController();
        const list = await listActiveTorrents(ac.signal);
        if (!cancelled) setTorrents(list);
      } catch {
        // silent — strip is best-effort
      } finally {
        if (!cancelled) {
          timer = setTimeout(tick, POLL_MS);
        }
      }
    };

    tick();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [onPlayPage]);

  if (onPlayPage) return null;
  if (torrents.length === 0) return null;

  return (
    <div className="fixed bottom-6 left-6 z-40 flex flex-col gap-2 max-w-[320px] animate-fade-in">
      <p className="text-[10px] uppercase tracking-[0.25em] text-bone-300/50 pl-1">
        Active
      </p>
      {torrents.map((t) => (
        <button
          key={t.id}
          onClick={() => navigate(`/play/${encodeURIComponent(t.id)}`)}
          className="
            focus-ring text-left
            bg-ink-900/90 backdrop-blur-md
            border border-ink-700/60 hover:border-ember-300/40
            px-3 py-2.5
            transition-colors
            group
          "
          style={{ borderRadius: 2 }}
        >
          <div className="flex items-center gap-2 mb-1.5">
            <span className="inline-block w-1 h-1 bg-ember-300 rounded-full animate-pulse flex-shrink-0" />
            <span className="text-xs text-bone-100/90 truncate group-hover:text-ember-100 transition-colors">
              {t.name}
            </span>
          </div>
          <ProgressBar progress={t.progress} thin />
          <div className="flex items-center justify-between mt-1.5 text-[10px] tabular-nums text-bone-300/50">
            <span>{(Math.max(0, Math.min(1, t.progress)) * 100).toFixed(0)}%</span>
            <span>{t.peers} peer{t.peers === 1 ? '' : 's'}</span>
          </div>
        </button>
      ))}
    </div>
  );
}
