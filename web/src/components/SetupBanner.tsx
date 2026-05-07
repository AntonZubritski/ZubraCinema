import { useEffect, useMemo, useState } from 'react';
import type { Capabilities, ToolName } from '../api';
import { useCapabilities } from '../lib/capabilities';
import { InstallPanel } from './InstallPanel';

// LocalStorage key for the dismissal record. The value is a JSON-encoded
// sorted list of missing tool names at the time of dismissal — that way if
// a NEW tool goes missing later (the user uninstalled mpv, say) the banner
// re-appears instead of staying hidden forever.
const DISMISS_KEY = 'zubracinema:setup-dismiss';

const DISPLAY: Record<ToolName, string> = {
  ffmpeg: 'FFmpeg',
  mpv: 'mpv',
  vlc: 'VLC',
};

// Friendly per-tool blurb used in the banner. Kept short — the banner is
// horizontal and runs out of room fast on narrow viewports.
const SUBTITLE: Record<ToolName, string> = {
  ffmpeg: 'нужен для просмотра mkv/avi в браузере',
  mpv: 'внешний плеер (рекомендуется)',
  vlc: 'внешний плеер (альтернатива mpv)',
};

// Compute the ordered list of tools that need attention.
//
// Two categories:
//   1) any `required: true` tool that's missing — always blocks (we surface
//      it in the banner with a plain "missing" message).
//   2) external player coverage: if BOTH mpv and vlc are missing the user
//      can't open files in an external player. We surface only ONE of
//      them as the recommended install (mpv first, fallback vlc) so the
//      banner doesn't double-list.
function missingTools(caps: Capabilities | null): ToolName[] {
  if (!caps) return [];
  const have = new Map(caps.tools.map((t) => [t.name, t]));
  const out: ToolName[] = [];

  for (const t of caps.tools) {
    if (t.required && !t.installed) out.push(t.name);
  }

  const mpv = have.get('mpv');
  const vlc = have.get('vlc');
  const mpvMissing = mpv ? !mpv.installed : true;
  const vlcMissing = vlc ? !vlc.installed : true;
  if (mpvMissing && vlcMissing) {
    // Neither external player is available — recommend mpv (smaller, faster
    // start, better with mkv).
    if (!out.includes('mpv')) out.push('mpv');
  }

  return out;
}

function loadDismissed(): string[] {
  try {
    const raw = localStorage.getItem(DISMISS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function saveDismissed(tools: ToolName[]) {
  try {
    localStorage.setItem(DISMISS_KEY, JSON.stringify([...tools].sort()));
  } catch {
    // localStorage unavailable (private mode on some browsers) — fall back
    // to in-memory dismissal: not ideal but the banner won't crash.
  }
}

// SetupBanner sits above the search bar on the home page. Self-hides when
// everything is installed OR when the user dismissed the banner for the
// current set of missing tools.
export function SetupBanner() {
  const caps = useCapabilities();
  const missing = useMemo(() => missingTools(caps), [caps]);
  const [dismissedFor, setDismissedFor] = useState<string[] | null>(null);
  const [installing, setInstalling] = useState<ToolName | null>(null);

  // Load dismissal record on mount. Done in an effect (not useState init)
  // so SSR / first render is deterministic.
  useEffect(() => {
    setDismissedFor(loadDismissed());
  }, []);

  if (!caps || dismissedFor === null) return null;
  if (missing.length === 0) return null;

  const sortedMissing = [...missing].sort();
  const dismissedMatches =
    dismissedFor.length === sortedMissing.length &&
    dismissedFor.every((t, i) => t === sortedMissing[i]);
  if (dismissedMatches) return null;

  const handleDismiss = () => {
    saveDismissed(sortedMissing as ToolName[]);
    setDismissedFor([...sortedMissing]);
  };

  // The "primary" install button drives the first missing tool; if the user
  // has more than one, after installing the first the banner re-renders
  // with the next.
  const primary = missing[0];

  return (
    <>
      <div
        className="
          relative w-full
          bg-ember-400/[0.08]
          border border-ember-300/40
          px-4 py-3
          flex items-center gap-4
          animate-fade-in
        "
        style={{ borderRadius: 2 }}
        role="status"
      >
        <WarnIcon />
        <div className="flex-1 min-w-0 text-bone-100/90 text-xs leading-snug">
          <span className="text-ember-200 uppercase tracking-[0.2em] text-[10px] mr-2">
            Не установлено
          </span>
          <span className="text-bone-100">
            {missing.map((t, i) => (
              <span key={t}>
                {i > 0 && <span className="text-bone-300/40 mx-1">·</span>}
                <span className="font-medium">{DISPLAY[t]}</span>
                <span className="text-bone-300/60"> ({SUBTITLE[t]})</span>
              </span>
            ))}
          </span>
        </div>
        <button
          type="button"
          onClick={() => setInstalling(primary)}
          className="
            focus-ring
            flex-shrink-0
            px-4 py-2
            text-[10px] uppercase tracking-[0.22em] font-medium
            text-bone-50 bg-ember-400 hover:bg-ember-300
            transition-colors
          "
          style={{ borderRadius: 1 }}
        >
          {caps.packageManager
            ? `Установить ${DISPLAY[primary]}`
            : `Как установить ${DISPLAY[primary]}`}
        </button>
        <button
          type="button"
          onClick={handleDismiss}
          aria-label="Скрыть"
          className="
            focus-ring
            flex-shrink-0
            text-bone-300/50 hover:text-bone-100
            p-1
            transition-colors
          "
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M6 6l12 12" />
            <path d="M18 6l-12 12" />
          </svg>
        </button>
      </div>

      {installing && (
        <InstallPanel
          tool={installing}
          caps={caps}
          onClose={() => setInstalling(null)}
        />
      )}
    </>
  );
}

function WarnIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="flex-shrink-0 text-ember-300"
      aria-hidden="true"
    >
      <path d="M12 3l10 17H2L12 3z" />
      <path d="M12 10v5" />
      <path d="M12 18.5v.01" />
    </svg>
  );
}
