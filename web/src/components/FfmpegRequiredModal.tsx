import { useEffect, useState } from 'react';
import { installCommand } from '../api';
import { useCapabilities } from '../lib/capabilities';
import { InstallPanel } from './InstallPanel';

// Blocking modal shown on first launch when FFmpeg is missing. The app
// degrades to "external player only" without it (no mkv/avi in browser),
// so we want first-time visitors to see a clear explanation rather than
// just a small banner they might click past. Once the user dismisses it
// (or installs ffmpeg) the modal stays out of the way.

const DISMISS_KEY = 'zubracinema:ffmpeg-modal-dismissed';

export function FfmpegRequiredModal() {
  const caps = useCapabilities();
  const [dismissed, setDismissed] = useState<boolean | null>(null);
  const [installing, setInstalling] = useState(false);
  const [copied, setCopied] = useState(false);

  // Load the dismissal flag asynchronously so first render is deterministic.
  useEffect(() => {
    try {
      setDismissed(localStorage.getItem(DISMISS_KEY) === '1');
    } catch {
      setDismissed(false);
    }
  }, []);

  // Compute ffmpegMissing without an early return so all hooks fire on
  // every render (Rules of Hooks). caps may be null on the first paint —
  // treat that as "not yet known", which makes the effect a no-op until
  // the probe lands.
  const ffmpeg = caps?.tools.find((t) => t.name === 'ffmpeg');
  const ffmpegKnown = caps !== null;
  const ffmpegMissing = ffmpegKnown && (!ffmpeg || !ffmpeg.installed);

  // Once ffmpeg is installed, drop the dismissal so the modal will fire
  // again on a future ffmpeg uninstall — it's about the tool's state, not
  // a one-shot "user clicked never". Must sit BEFORE any early return so
  // the hook count stays stable across renders.
  useEffect(() => {
    if (ffmpegKnown && !ffmpegMissing) {
      try {
        localStorage.removeItem(DISMISS_KEY);
      } catch {
        // ignore
      }
    }
  }, [ffmpegKnown, ffmpegMissing]);

  // Now that all hooks have run, it's safe to bail.
  if (!caps || dismissed === null) return null;
  if (!ffmpegMissing) return null;
  if (dismissed) return null;

  const cmd = installCommand(caps, 'ffmpeg');

  const handleDismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      // ignore
    }
    setDismissed(true);
  };

  const handleCopy = async () => {
    if (!cmd) return;
    try {
      await navigator.clipboard.writeText(cmd);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      window.prompt('Скопируй команду:', cmd);
    }
  };

  return (
    <>
      <div
        className="fixed inset-0 z-[60] flex items-center justify-center bg-black/85 backdrop-blur-md animate-fade-in"
        role="dialog"
        aria-modal="true"
      >
        <div
          className="
            w-full max-w-xl mx-4
            bg-ink-900 border border-ember-300/40
            shadow-2xl
          "
          style={{ borderRadius: 12 }}
        >
          <header className="px-6 py-5 border-b border-ink-700/60">
            <p className="text-[10px] uppercase tracking-[0.3em] text-ember-300/80 mb-2">
              Требуется установка
            </p>
            <h2 className="text-bone-50 text-2xl tracking-tight font-semibold">
              FFmpeg обязателен
            </h2>
          </header>

          <div className="px-6 py-5 space-y-4 text-bone-100/90 text-sm leading-relaxed">
            <p>
              Без FFmpeg ZubraCinema не сможет проиграть mkv / avi и любые
              другие неMP4-форматы прямо в браузере. Это бесплатная утилита
              командной строки, ставится в один клик.
            </p>

            {cmd ? (
              <div className="space-y-2">
                <p className="text-bone-300/70 text-xs uppercase tracking-[0.2em]">
                  Команда установки
                </p>
                <div className="flex items-stretch gap-2">
                  <code
                    className="
                      flex-1 min-w-0
                      bg-black/60 border border-ink-700/60
                      font-mono text-[12px] text-bone-100
                      px-3 py-2.5
                      overflow-x-auto whitespace-nowrap
                    "
                    style={{ borderRadius: 6 }}
                  >
                    {cmd}
                  </code>
                  <button
                    type="button"
                    onClick={handleCopy}
                    className="
                      focus-ring
                      px-3
                      text-[10px] uppercase tracking-[0.2em] font-medium
                      text-ember-200 hover:text-bone-50
                      border border-ember-300/40 hover:bg-ember-400 hover:border-ember-400
                      transition-colors
                      whitespace-nowrap
                    "
                    style={{ borderRadius: 6 }}
                  >
                    {copied ? 'Скопировано' : 'Копировать'}
                  </button>
                </div>
              </div>
            ) : (
              <p className="text-bone-300/70 text-xs">
                Менеджер пакетов не найден. Скачай FFmpeg вручную с{' '}
                <a
                  href="https://ffmpeg.org/download.html"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-ember-300 underline hover:text-ember-200"
                >
                  ffmpeg.org
                </a>{' '}
                и добавь в PATH.
              </p>
            )}

            {caps.packageManager && (
              <p className="text-bone-300/55 text-xs">
                Можно нажать «Установить» — приложение само вызовет{' '}
                <code className="font-mono text-bone-200">
                  {caps.packageManager}
                </code>
                . После завершения перезапусти бинарь.
              </p>
            )}
          </div>

          <footer className="px-6 py-4 border-t border-ink-700/60 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={handleDismiss}
              className="
                focus-ring
                px-4 py-2.5
                text-[11px] uppercase tracking-[0.2em] font-medium
                text-bone-300/70 hover:text-bone-50
                border border-ink-700/60 hover:border-ink-600
                transition-colors
              "
              style={{ borderRadius: 6 }}
            >
              Я установлю сам
            </button>
            {caps.packageManager && (
              <button
                type="button"
                onClick={() => setInstalling(true)}
                className="
                  focus-ring
                  px-5 py-2.5
                  text-[11px] uppercase tracking-[0.2em] font-medium
                  text-bone-50 bg-ember-400 hover:bg-ember-300
                  transition-colors
                "
                style={{ borderRadius: 6 }}
              >
                Установить через {caps.packageManager}
              </button>
            )}
          </footer>
        </div>
      </div>

      {installing && (
        <InstallPanel
          tool="ffmpeg"
          caps={caps}
          onClose={() => setInstalling(false)}
        />
      )}
    </>
  );
}
