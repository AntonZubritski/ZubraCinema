import { LANG_SHORT, type Language } from '../lib/lang';

type Props = {
  language: Language;
  variant?: 'inline' | 'corner';
};

export function LanguageBadge({ language, variant = 'inline' }: Props) {
  const label = LANG_SHORT[language];

  if (variant === 'corner') {
    const tone =
      language === 'ru' || language === 'uk'
        ? 'bg-ember-400/60 border-ember-300/40 text-bone-50'
        : language === 'en'
          ? 'bg-ink-950/80 border-bone-200/30 text-bone-100'
          : 'bg-ink-950/80 border-ink-600 text-bone-300/70';
    return (
      <span
        className={`
          inline-block px-1.5 py-0.5
          text-[10px] uppercase tracking-[0.2em] font-semibold
          backdrop-blur-sm border ${tone}
        `}
        style={{ borderRadius: 1 }}
      >
        {label}
      </span>
    );
  }

  const tone =
    language === 'ru' || language === 'uk'
      ? 'text-ember-300 border-ember-300/30'
      : 'text-bone-200 border-bone-300/25';

  return (
    <span
      className={`
        inline-block px-1.5 py-0.5
        text-[10px] uppercase tracking-[0.2em] font-semibold
        border ${tone}
      `}
      style={{ borderRadius: 1 }}
    >
      {label}
    </span>
  );
}
