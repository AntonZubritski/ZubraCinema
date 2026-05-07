import { useEffect, useState, type JSX } from 'react';

// TopBar — Lampa CUB-style top chrome. Left cluster: back arrow OR hamburger,
// then "Главная — ZubraCinema" breadcrumb. Right cluster: full Lampa icon
// rail (search, cast, notifications, settings, profile, scan, refresh,
// kebab) followed by a tabular clock + date column. Most chrome icons are
// no-ops for now — they are visible to mimic the dashboard density of CUB
// without us having to ship every feature behind them.

type Props = {
  /** Page title shown next to the logo, e.g. "Главная — ZubraCinema". */
  title?: string;
  /** Show the back arrow on the left instead of the hamburger. */
  showBack?: boolean;
  /** Back-arrow click handler. Only matters when `showBack` is true. */
  onBack?: () => void;
  /** Hamburger click handler — typically opens the sidebar. */
  onMenu: () => void;
  /** Search-icon click. If omitted the icon is still rendered but no-ops. */
  onSearch?: () => void;
  /** Gear-icon click — typically opens the SettingsModal. */
  onSettings: () => void;
};

const ICON_BTN =
  'focus-ring relative inline-flex items-center justify-center w-9 h-9 rounded-full text-bone-200/80 hover:text-bone-50 hover:bg-white/10 transition-colors';

export function TopBar(props: Props): JSX.Element {
  const { title, showBack = false, onBack, onMenu, onSearch, onSettings } = props;
  const { hhmm, dateLine, dayLine } = useClock();

  return (
    <header
      className="
        sticky top-0 z-30
        bg-gradient-to-b from-black/60 via-black/35 to-transparent
        backdrop-blur-sm
      "
    >
      <div className="max-w-[1500px] mx-auto px-4 lg:px-6 h-14 flex items-center gap-2">
        {/* Left cluster: app logo + optional back arrow + hamburger +
            breadcrumb. Lampa CUB stacks back + menu side-by-side on
            detail pages so users can drop directly to home OR pop one
            frame back. On the home page only the hamburger renders. */}
        <img
          src="/logo-icon.svg"
          alt=""
          className="h-7 w-auto select-none pointer-events-none"
          draggable={false}
          aria-hidden="true"
        />
        {showBack && (
          <button
            type="button"
            onClick={onBack}
            className={ICON_BTN}
            aria-label="Назад"
          >
            <BackIcon />
          </button>
        )}
        <button
          type="button"
          onClick={onMenu}
          className={ICON_BTN}
          aria-label="Меню"
        >
          <HamburgerIcon />
        </button>

        <span className="ml-1 text-[15px] font-medium tracking-tight text-bone-50/95 truncate">
          {title || 'Главная'} <span className="text-bone-300/55">— ZubraCinema</span>
        </span>

        <div className="flex-1" />

        {/* Right cluster: only the icons we actually wire up. Cast / bell /
            profile / scan / refresh / kebab were decorative — gone. */}
        <button type="button" onClick={onSearch} className={ICON_BTN} aria-label="Поиск">
          <SearchIcon />
        </button>
        <button type="button" onClick={onSettings} className={ICON_BTN} aria-label="Настройки">
          <GearIcon />
        </button>

        {/* Clock + date column — informational, not interactive. */}
        <div className="ml-3 flex items-center gap-2.5">
          <span className="text-bone-50 text-[18px] font-medium tabular-nums leading-none">
            {hhmm}
          </span>
          <span className="text-bone-200/85 text-[10px] leading-tight tabular-nums hidden sm:flex flex-col">
            <span>{dateLine}</span>
            <span className="text-bone-300/65">{dayLine}</span>
          </span>
        </div>
      </div>
    </header>
  );
}

// useClock — ticks the displayed time once a minute. Aligns the next tick
// to the wall-clock minute boundary so all open instances flip together.
function useClock() {
  const [now, setNow] = useState<Date>(() => new Date());
  useEffect(() => {
    let timeoutId: number;
    let intervalId: number;
    const tick = () => setNow(new Date());
    const msToNextMinute = 60_000 - (Date.now() % 60_000);
    timeoutId = window.setTimeout(() => {
      tick();
      intervalId = window.setInterval(tick, 60_000);
    }, msToNextMinute);
    return () => {
      window.clearTimeout(timeoutId);
      if (intervalId) window.clearInterval(intervalId);
    };
  }, []);
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  return {
    hhmm: `${hh}:${mm}`,
    dateLine: now.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' }),
    dayLine: now.toLocaleDateString('ru-RU', { weekday: 'long' }),
  };
}

// All icons inherit currentColor + use a 1.6px stroke for the slightly
// heavier dashboard feel that Lampa CUB has. Sized 18px on a 36px button.

function HamburgerIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
      <path d="M3 6h18" />
      <path d="M3 12h18" />
      <path d="M3 18h18" />
    </svg>
  );
}

function BackIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 18l-6-6 6-6" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
    </svg>
  );
}

function GearIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

