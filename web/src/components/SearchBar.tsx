import { useEffect, useRef } from 'react';

type Props = {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  loading: boolean;
};

export function SearchBar({ value, onChange, onSubmit, loading }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
      className="relative w-full"
    >
      <div className="absolute inset-y-0 left-5 flex items-center pointer-events-none text-bone-300/60">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
      </div>

      <input
        ref={inputRef}
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Поиск фильма, года, режиссёра…"
        spellCheck={false}
        autoComplete="off"
        className="
          focus-ring
          w-full
          bg-ink-900/70 backdrop-blur-md
          border border-ink-700/80
          text-bone-50 placeholder:text-bone-300/40
          text-lg tracking-tight
          pl-14 pr-32 py-5
          transition-colors
          hover:border-ink-600
          focus:border-ember-300/40
          focus:bg-ink-900
        "
        style={{ borderRadius: 14 }}
      />

      <button
        type="submit"
        disabled={loading || value.trim().length === 0}
        className="
          focus-ring
          absolute inset-y-2 right-2
          px-6
          text-xs uppercase tracking-[0.18em] font-semibold
          text-bone-50
          bg-ember-400 hover:bg-ember-300
          disabled:bg-ink-700 disabled:text-bone-300/40
          transition-colors
          flex items-center
        "
        style={{ borderRadius: 10 }}
      >
        {loading ? 'Ищем…' : 'Найти'}
      </button>
    </form>
  );
}
