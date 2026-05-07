import { useEffect, useRef, useState } from 'react';
import {
  installCommand,
  installTool,
  type Capabilities,
  type ToolName,
} from '../api';
import { Spinner } from './Spinner';
import { refreshCapabilities } from '../lib/capabilities';

type Status = 'installing' | 'success' | 'error' | 'cancelled';

type Props = {
  tool: ToolName;
  caps: Capabilities;
  onClose: () => void;
};

// Display names for the tools — shown in the panel title and elsewhere.
// Kept here (not in api.ts) because they're frontend-only copy.
const DISPLAY_NAMES: Record<ToolName, string> = {
  ffmpeg: 'FFmpeg',
  mpv: 'mpv',
  vlc: 'VLC',
};

function pmDisplayName(pm: Capabilities['packageManager']): string {
  if (pm === 'winget') return 'winget';
  if (pm === 'brew') return 'Homebrew';
  if (pm === 'apt') return 'apt';
  if (pm === 'dnf') return 'dnf';
  return '';
}

// InstallPanel drives the SSE install flow for a single tool. Drops a
// modal-like overlay that hosts: live log, status banner, and a Cancel/Done
// pair. When no package manager is detected it shows the manual command +
// a Copy button instead.
export function InstallPanel({ tool, caps, onClose }: Props) {
  const noPackageManager = caps.packageManager === '';
  const manualCommand = installCommand(caps, tool);
  const [logLines, setLogLines] = useState<string[]>([]);
  const [status, setStatus] = useState<Status>('installing');
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [copied, setCopied] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);

  // Drive the SSE consumer when the panel mounts (and there IS a PM to
  // drive). The cleanup aborts mid-install if the user closes the panel,
  // which terminates the underlying fetch and (server-side) the package
  // manager process.
  useEffect(() => {
    if (noPackageManager) return;
    const ac = new AbortController();
    abortRef.current = ac;
    let cancelled = false;
    (async () => {
      try {
        for await (const evt of installTool(tool, ac.signal)) {
          if (cancelled) return;
          if (evt.event === 'log') {
            setLogLines((prev) => {
              const next = [...prev, evt.data];
              // Cap at 500 lines — winget can be chatty and we don't want
              // to balloon the DOM if a sub-process gets into a retry loop.
              return next.length > 500 ? next.slice(-500) : next;
            });
          } else if (evt.event === 'done') {
            if (evt.data === 'success') {
              setStatus('success');
              // Cache-bust so the SetupBanner re-evaluates with the newly
              // installed tool. Without this the user would have to reload
              // the page before the banner notices the install worked.
              void refreshCapabilities();
            } else {
              setStatus('error');
              setErrorMsg('Установка завершилась с ошибкой.');
            }
          }
        }
      } catch (err) {
        if (cancelled) return;
        if (err instanceof Error && err.name === 'AbortError') {
          setStatus('cancelled');
          return;
        }
        setStatus('error');
        setErrorMsg(
          err instanceof Error ? err.message : 'Не удалось запустить установку',
        );
      }
    })();
    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [tool, noPackageManager]);

  // Auto-scroll the log to the bottom so the user always sees the latest
  // line. Smoothness disabled — a long install would otherwise spend
  // animation frames on every line.
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ block: 'end' });
  }, [logLines]);

  const handleCancel = () => {
    abortRef.current?.abort();
    setStatus('cancelled');
  };

  const handleCopy = async () => {
    if (!manualCommand) return;
    try {
      await navigator.clipboard.writeText(manualCommand);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API can fail in non-secure contexts. As a last resort,
      // prompt the user with the command so they can copy it themselves.
      window.prompt('Скопируй команду:', manualCommand);
    }
  };

  const pmLabel = pmDisplayName(caps.packageManager);
  const displayName = DISPLAY_NAMES[tool];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm animate-fade-in"
      onClick={(e) => {
        // Click outside the panel closes it (only when the install isn't in
        // flight — don't let a stray click kill an active package install).
        if (e.target === e.currentTarget && status !== 'installing') {
          onClose();
        }
      }}
    >
      <div
        className="
          w-full max-w-2xl mx-4
          bg-ink-900 border border-ember-300/40
          shadow-2xl
        "
        style={{ borderRadius: 2 }}
        role="dialog"
        aria-modal="true"
      >
        <header className="px-5 py-4 border-b border-ink-700/60 flex items-center justify-between">
          <div>
            <p className="text-[10px] uppercase tracking-[0.25em] text-ember-300/80">
              {noPackageManager
                ? 'Ручная установка'
                : `Установка через ${pmLabel}`}
            </p>
            <h2 className="text-bone-50 text-lg tracking-tight mt-1">
              {displayName}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={status === 'installing'}
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

        <div className="px-5 py-4">
          {noPackageManager ? (
            <ManualCommand
              command={manualCommand}
              os={caps.os}
              copied={copied}
              onCopy={handleCopy}
            />
          ) : (
            <>
              <StatusLine status={status} errorMsg={errorMsg} />

              <div
                className="
                  mt-4 bg-black/60 border border-ink-700/60
                  font-mono text-[11px] text-bone-100/80
                  p-3
                  h-64 overflow-y-auto
                  whitespace-pre-wrap break-all
                "
                style={{ borderRadius: 2 }}
              >
                {logLines.length === 0 ? (
                  <p className="text-bone-300/40 italic">
                    Ожидаем менеджер пакетов…
                  </p>
                ) : (
                  logLines.map((line, i) => (
                    <div key={i}>{line}</div>
                  ))
                )}
                <div ref={logEndRef} />
              </div>

              {status === 'error' && manualCommand && (
                <div className="mt-3 text-xs text-bone-300/70">
                  <p className="mb-2">
                    Авто-установка не удалась. Попробуй вручную:
                  </p>
                  <ManualCommand
                    command={manualCommand}
                    os={caps.os}
                    copied={copied}
                    onCopy={handleCopy}
                    compact
                  />
                </div>
              )}
            </>
          )}
        </div>

        <footer className="px-5 py-3 border-t border-ink-700/60 flex justify-end gap-2">
          {!noPackageManager && status === 'installing' && (
            <button
              type="button"
              onClick={handleCancel}
              className="
                focus-ring
                px-4 py-2
                text-[11px] uppercase tracking-[0.2em] font-medium
                text-bone-300/80 hover:text-bone-50
                border border-ink-700/60 hover:border-ink-600
                transition-colors
              "
              style={{ borderRadius: 1 }}
            >
              Отмена
            </button>
          )}
          {status === 'success' && (
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="
                focus-ring
                px-5 py-2
                text-[11px] uppercase tracking-[0.2em] font-medium
                text-bone-50 bg-ember-400 hover:bg-ember-300
                transition-colors
              "
              style={{ borderRadius: 1 }}
            >
              Перезагрузить
            </button>
          )}
          {(status === 'error' || status === 'cancelled' || noPackageManager) && (
            <button
              type="button"
              onClick={onClose}
              className="
                focus-ring
                px-4 py-2
                text-[11px] uppercase tracking-[0.2em] font-medium
                text-bone-100 hover:text-bone-50
                border border-ink-700/60 hover:border-ink-600
                transition-colors
              "
              style={{ borderRadius: 1 }}
            >
              Закрыть
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}

function StatusLine({ status, errorMsg }: { status: Status; errorMsg: string }) {
  if (status === 'installing') {
    return (
      <div className="flex items-center gap-2 text-bone-200/90 text-xs">
        <Spinner size={14} />
        <span>Устанавливаем — это может занять минуту-другую.</span>
      </div>
    );
  }
  if (status === 'success') {
    return (
      <div className="flex items-center gap-2 text-ember-200 text-xs">
        <DotIcon />
        <span>Готово. Перезагрузи страницу, чтобы плеер увидел инструмент.</span>
      </div>
    );
  }
  if (status === 'cancelled') {
    return (
      <div className="text-bone-300/70 text-xs">
        Установка отменена.
      </div>
    );
  }
  return (
    <div className="text-ember-200 text-xs">
      {errorMsg || 'Что-то пошло не так.'}
    </div>
  );
}

function ManualCommand({
  command,
  os,
  copied,
  onCopy,
  compact = false,
}: {
  command: string;
  os: string;
  copied: boolean;
  onCopy: () => void;
  compact?: boolean;
}) {
  if (!command) {
    return (
      <p className="text-bone-300/70 text-xs">
        Не нашли способ установить автоматически. Поставь инструмент вручную и
        перезагрузи страницу.
      </p>
    );
  }
  return (
    <div className="space-y-2">
      {!compact && (
        <p className="text-bone-300/70 text-xs">
          {os === 'windows'
            ? 'Открой PowerShell и выполни:'
            : os === 'darwin'
              ? 'Открой Terminal и выполни:'
              : 'Открой терминал и выполни:'}
        </p>
      )}
      <div className="flex items-stretch gap-2">
        <code
          className="
            flex-1 min-w-0
            bg-black/70 border border-ink-700/60
            font-mono text-[11px] text-bone-100
            px-3 py-2.5
            overflow-x-auto whitespace-nowrap
          "
          style={{ borderRadius: 1 }}
        >
          {command}
        </code>
        <button
          type="button"
          onClick={onCopy}
          className="
            focus-ring
            px-3
            text-[10px] uppercase tracking-[0.2em] font-medium
            text-ember-200 hover:text-bone-50
            border border-ember-300/40 hover:bg-ember-400 hover:border-ember-400
            transition-colors
            whitespace-nowrap
          "
          style={{ borderRadius: 1 }}
        >
          {copied ? 'Скопировано' : 'Копировать'}
        </button>
      </div>
    </div>
  );
}

function DotIcon() {
  return (
    <span
      className="inline-block w-1.5 h-1.5 bg-ember-300"
      aria-hidden="true"
      style={{ borderRadius: '50%' }}
    />
  );
}
