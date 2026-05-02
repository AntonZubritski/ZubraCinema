type Props = {
  progress: number;
  thin?: boolean;
  className?: string;
};

export function ProgressBar({ progress, thin = false, className = '' }: Props) {
  const pct = Math.max(0, Math.min(1, progress)) * 100;
  return (
    <div
      className={`relative w-full bg-ink-800 overflow-hidden ${thin ? 'h-0.5' : 'h-1'} ${className}`}
      style={{ borderRadius: 1 }}
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className="absolute inset-y-0 left-0 bg-ember-400 transition-[width] duration-500 ease-out"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
