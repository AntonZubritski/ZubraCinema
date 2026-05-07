import { useEffect, useState } from 'react';
import {
  ApiError,
  getSettings,
  pickFolder,
  updateSettings,
  type Settings,
} from '../api';
import { Spinner } from './Spinner';

type Props = {
  onClose: () => void;
};

type Status = 'loading' | 'idle' | 'saving' | 'picking';

// SettingsModal lets the user change the downloads folder (where torrent
// piece data lives). Browser-driven settings also need persistence + a hot-
// swap on the running torrent client; the backend handles both, this UI
// just drives it.
export function SettingsModal({ onClose }: Props) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [path, setPath] = useState('');
  // Pending value of the 18+ checkbox. Mirrors `path` — both are dirty-
  // tracked separately from `settings` (the saved server state) and only
  // committed when the user clicks "Сохранить". Cancel discards them.
  const [pendingAdult, setPendingAdult] = useState(false);
  const [status, setStatus] = useState<Status>('loading');
  const [error, setError] = useState<string>('');
  const [info, setInfo] = useState<string>('');

  // Initial fetch. We don't keep this in flight on unmount because the
  // settings response is tiny — a stale set on a closed modal is harmless.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const s = await getSettings();
        if (cancelled) return;
        setSettings(s);
        setPath(s.downloadsDir);
        setPendingAdult(s.adult);
        setStatus('idle');
      } catch (err) {
        if (cancelled) return;
        setError(
          err instanceof Error ? err.message : 'Не удалось загрузить настройки',
        );
        setStatus('idle');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ESC closes the modal (when not in the middle of a save). Mirrors the
  // backdrop-click behaviour from InstallPanel.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && status !== 'saving') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, status]);

  const handleBrowse = async () => {
    setStatus('picking');
    setError('');
    setInfo('');
    try {
      const picked = await pickFolder();
      if (picked) setPath(picked);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось открыть диалог');
    } finally {
      setStatus('idle');
    }
  };

  const handleSave = async () => {
    if (!settings) return;
    const trimmed = path.trim();
    if (!trimmed) {
      setError('Укажи путь к папке');
      return;
    }
    const dirPatch = trimmed !== settings.downloadsDir ? trimmed : undefined;
    const adultPatch = pendingAdult !== settings.adult ? pendingAdult : undefined;
    if (dirPatch === undefined && adultPatch === undefined) {
      onClose();
      return;
    }
    setStatus('saving');
    setError('');
    setInfo('');
    try {
      const res = await updateSettings({
        downloadsDir: dirPatch,
        adult: adultPatch,
      });
      if (res.warning) {
        setInfo(res.warning);
        setSettings({ ...settings, downloadsDir: res.downloadsDir, adult: res.adult });
        setStatus('idle');
        return;
      }
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setError(
          'Сначала удали активные торренты — клиент не может переключить папку, пока они качаются.',
        );
      } else {
        setError(
          err instanceof Error ? err.message : 'Не удалось сохранить настройки',
        );
      }
      setStatus('idle');
    }
  };

  const dirty = settings
    ? path.trim() !== settings.downloadsDir || pendingAdult !== settings.adult
    : false;
  const blocked = settings ? settings.activeTorrents > 0 : false;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm animate-fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget && status !== 'saving') onClose();
      }}
    >
      <div
        className="w-full max-w-2xl mx-4 bg-ink-900 border border-ember-300/40 shadow-2xl"
        style={{ borderRadius: 2 }}
        role="dialog"
        aria-modal="true"
      >
        <header className="px-5 py-4 border-b border-ink-700/60 flex items-center justify-between">
          <div>
            <p className="text-[10px] uppercase tracking-[0.25em] text-ember-300/80">
              Настройки
            </p>
            <h2 className="text-bone-50 text-lg tracking-tight mt-1">
              Папка буфера
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={status === 'saving'}
            className="
              focus-ring
              text-bone-300/60 hover:text-bone-50
              disabled:opacity-30 disabled:cursor-not-allowed
              transition-colors
              p-1
            "
            aria-label="Закрыть"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M6 6l12 12" />
              <path d="M18 6l-12 12" />
            </svg>
          </button>
        </header>

        <div className="px-5 py-5">
          {status === 'loading' && (
            <div className="flex items-center gap-2 text-bone-300/70 text-xs">
              <Spinner size={14} />
              <span>Загружаем настройки…</span>
            </div>
          )}

          {settings && (
            <>
              <p className="text-bone-300/70 text-xs leading-relaxed mb-4">
                Здесь хранятся скачанные куски торрентов. Можно перенести на
                другой диск, если на C: мало места.
                {settings.configPath && (
                  <span className="block mt-1 text-bone-300/40">
                    Конфиг: <code className="font-mono">{settings.configPath}</code>
                  </span>
                )}
              </p>

              <label className="block text-[10px] uppercase tracking-[0.2em] text-bone-300/60 mb-2">
                Путь к папке
              </label>
              <div className="flex items-stretch gap-2">
                <input
                  type="text"
                  value={path}
                  onChange={(e) => setPath(e.target.value)}
                  spellCheck={false}
                  disabled={status === 'saving' || status === 'picking'}
                  className="
                    flex-1 min-w-0
                    bg-black/40 border border-ink-700/60 focus:border-ember-300/60
                    font-mono text-[12px] text-bone-100
                    px-3 py-2.5
                    outline-none transition-colors
                    disabled:opacity-50
                  "
                  style={{ borderRadius: 1 }}
                  placeholder="C:\Users\…\ZubraCinema\downloads"
                />
                {settings.canPickFolder && (
                  <button
                    type="button"
                    onClick={handleBrowse}
                    disabled={status === 'saving' || status === 'picking'}
                    className="
                      focus-ring
                      px-4
                      text-[10px] uppercase tracking-[0.2em] font-medium
                      text-ember-200 hover:text-bone-50
                      border border-ember-300/40 hover:bg-ember-400 hover:border-ember-400
                      disabled:opacity-50 disabled:cursor-not-allowed
                      transition-colors
                      whitespace-nowrap
                    "
                    style={{ borderRadius: 1 }}
                  >
                    {status === 'picking' ? '…' : 'Обзор…'}
                  </button>
                )}
              </div>

              {(settings.free > 0 || settings.total > 0) && (
                <p className="mt-3 text-[11px] text-bone-300/50">
                  Свободно: <span className="text-bone-200">{formatBytes(settings.free)}</span>{' '}
                  из {formatBytes(settings.total)} на диске с текущей папкой
                </p>
              )}

              {blocked && (
                <div className="mt-4 px-3 py-2 bg-ember-400/[0.08] border border-ember-300/30 text-bone-200 text-xs" style={{ borderRadius: 1 }}>
                  Сейчас активно {settings.activeTorrents}{' '}
                  торрент(а). Чтобы поменять папку, сначала удали их в
                  плеере.
                </div>
              )}

              <div className="mt-6 pt-5 border-t border-ink-700/60">
                <label className="flex items-start gap-3 cursor-pointer select-none group">
                  <input
                    type="checkbox"
                    className="mt-0.5 w-4 h-4 cursor-pointer accent-ember-400"
                    checked={pendingAdult}
                    disabled={status === 'saving'}
                    onChange={(e) => setPendingAdult(e.target.checked)}
                  />
                  <span className="flex-1 min-w-0">
                    <span className="block text-[11px] uppercase tracking-[0.2em] text-bone-300/70 group-hover:text-bone-100 transition-colors">
                      18+ контент
                    </span>
                    <span className="block mt-1 text-xs text-bone-300/50 leading-relaxed">
                      Показывать категории «Эротика» и адалт-источники на
                      главной. По умолчанию выключено. Изменение применится
                      после нажатия «Сохранить».
                    </span>
                  </span>
                </label>
              </div>

              {error && (
                <div className="mt-4 text-ember-200 text-xs leading-relaxed">
                  {error}
                </div>
              )}

              {info && (
                <div className="mt-4 text-bone-200 text-xs leading-relaxed">
                  {info}
                </div>
              )}
            </>
          )}
        </div>

        <footer className="px-5 py-3 border-t border-ink-700/60 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={status === 'saving'}
            className="
              focus-ring
              px-4 py-2
              text-[11px] uppercase tracking-[0.2em] font-medium
              text-bone-300/80 hover:text-bone-50
              border border-ink-700/60 hover:border-ink-600
              disabled:opacity-30 disabled:cursor-not-allowed
              transition-colors
            "
            style={{ borderRadius: 1 }}
          >
            Отмена
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!dirty || status === 'saving' || status === 'picking' || status === 'loading'}
            className="
              focus-ring
              px-5 py-2
              text-[11px] uppercase tracking-[0.2em] font-medium
              text-bone-50 bg-ember-400 hover:bg-ember-300
              disabled:opacity-30 disabled:cursor-not-allowed
              transition-colors
              flex items-center gap-2
            "
            style={{ borderRadius: 1 }}
          >
            {status === 'saving' && <Spinner size={12} />}
            Сохранить
          </button>
        </footer>
      </div>
    </div>
  );
}

function formatBytes(n: number): string {
  if (n <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  const digits = v >= 100 ? 0 : v >= 10 ? 1 : 2;
  return `${v.toFixed(digits)} ${units[i]}`;
}
