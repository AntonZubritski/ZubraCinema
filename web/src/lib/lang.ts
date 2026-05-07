import type { GroupTorrent } from '../api';

export type Language = 'ru' | 'uk' | 'pl' | 'en' | 'multi' | 'other';

export const ALL_LANGUAGES: Language[] = ['ru', 'uk', 'pl', 'en', 'multi', 'other'];

export const LANG_LABELS: Record<Language, string> = {
  ru: 'Русский',
  uk: 'Українська',
  pl: 'Polski',
  en: 'English',
  multi: 'Multi',
  other: 'Other',
};

export const LANG_SHORT: Record<Language, string> = {
  ru: 'RU',
  uk: 'UK',
  pl: 'PL',
  en: 'EN',
  multi: 'MULTI',
  other: '—',
};

export function languageScore(lang: Language): number {
  switch (lang) {
    case 'ru':
      return 5;
    case 'uk':
      return 4;
    case 'pl':
      return 3;
    case 'en':
      return 2;
    case 'multi':
      return 1;
    case 'other':
      return 0;
  }
}

export function normalizeLanguage(value: string | null | undefined): Language {
  const v = (value ?? '').trim().toLowerCase();
  if (v === 'ru' || v === 'uk' || v === 'pl' || v === 'en' || v === 'multi') return v;
  return 'other';
}

export function dominantLanguage(torrents: GroupTorrent[]): Language {
  if (torrents.length === 0) return 'other';
  const counts: Record<Language, number> = { ru: 0, uk: 0, pl: 0, en: 0, multi: 0, other: 0 };
  for (const t of torrents) counts[normalizeLanguage(t.language)] += 1;
  let best: Language = 'other';
  let bestCount = -1;
  for (const lang of ALL_LANGUAGES) {
    const c = counts[lang];
    if (c > bestCount || (c === bestCount && languageScore(lang) > languageScore(best))) {
      best = lang;
      bestCount = c;
    }
  }
  return best;
}
