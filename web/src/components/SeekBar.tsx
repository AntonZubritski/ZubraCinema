import { useRef, useState } from 'react';

type Props = {
  durationSec: number;
  positionSec: number;
  bufferedSec?: number;
  disabled?: boolean;
  onSeek: (newTimeSec: number) => void;
};

function formatTime(sec: number): string {
  if (!isFinite(sec) || sec < 0) return '0:00';
  const total = Math.round(sec);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function SeekBar({ durationSec, positionSec, bufferedSec = 0, disabled = false, onSeek }: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  const isDisabled = disabled || durationSec <= 0;

  // Hover preview state — pixel offset of the cursor inside the track (or
  // null when the cursor is outside / disabled). The tooltip renders the
  // time at that fraction so the user sees where a click would land.
  const [hover, setHover] = useState<{ x: number; t: number } | null>(null);

  const pos = Math.max(0, Math.min(positionSec, durationSec));
  const posPct = durationSec > 0 ? (pos / durationSec) * 100 : 0;
  const bufEnd = Math.max(pos, Math.min(bufferedSec, durationSec));
  const bufPct = durationSec > 0 ? (bufEnd / durationSec) * 100 : 0;

  function fracAt(e: React.MouseEvent<HTMLDivElement>): number | null {
    const el = trackRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0) return null;
    return Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  }

  function handleClick(e: React.MouseEvent<HTMLDivElement>) {
    if (isDisabled) return;
    const f = fracAt(e);
    if (f === null) return;
    onSeek(Math.max(0, Math.min(durationSec, f * durationSec)));
  }

  function handleMove(e: React.MouseEvent<HTMLDivElement>) {
    if (isDisabled) return;
    const el = trackRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0) return;
    const x = e.clientX - rect.left;
    const f = Math.max(0, Math.min(1, x / rect.width));
    setHover({ x, t: f * durationSec });
  }

  return (
    <div className={`w-full ${isDisabled ? 'opacity-40' : ''}`}>
      <div className="flex justify-between items-baseline text-[11px] text-bone-300/70 tabular-nums tracking-wide mb-1.5">
        <span>{formatTime(pos)}</span>
        <span>{durationSec > 0 ? formatTime(durationSec) : '—:—'}</span>
      </div>
      <div
        ref={trackRef}
        onClick={handleClick}
        onMouseMove={handleMove}
        onMouseLeave={() => setHover(null)}
        role="slider"
        aria-label="Прогресс воспроизведения"
        aria-valuemin={0}
        aria-valuemax={durationSec}
        aria-valuenow={pos}
        aria-disabled={isDisabled}
        className={`relative w-full h-2 bg-ink-700/40 overflow-visible ${isDisabled ? 'cursor-default' : 'cursor-pointer'}`}
        style={{ borderRadius: 1 }}
      >
        {bufPct > 0 && (
          <div
            className="absolute inset-y-0 left-0 bg-bone-300/30 rounded-[1px]"
            style={{ width: `${bufPct}%` }}
          />
        )}
        <div
          className="absolute inset-y-0 left-0 bg-ember-400 rounded-[1px] transition-[width] duration-150 ease-out"
          style={{ width: `${posPct}%` }}
        />
        {/* Hover tooltip + tick. Floats just above the track at the cursor's
            x. Pointer-events none so it doesn't block clicks on the track. */}
        {hover && !isDisabled && (
          <>
            <div
              className="absolute top-0 bottom-0 w-px bg-bone-50/40 pointer-events-none"
              style={{ left: hover.x }}
            />
            <div
              className="
                absolute -translate-x-1/2 -top-7
                px-2 py-0.5 rounded-md
                bg-ink-950/95 text-bone-50
                text-[11px] tabular-nums tracking-wide
                ring-1 ring-white/10
                shadow-lg
                pointer-events-none whitespace-nowrap
              "
              style={{ left: hover.x }}
            >
              {formatTime(hover.t)}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
