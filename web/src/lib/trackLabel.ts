import type { TrackInfo } from '../api';

// Map a small set of ISO 639-2 / 639-1 codes to human-readable RU labels.
// Codes are normalized to lower-case before lookup. Unknown codes fall
// through to the title/codec fallback chain in trackLabel().
const LANG_NAMES: Record<string, string> = {
  rus: 'Русский',
  ru: 'Русский',
  eng: 'English',
  en: 'English',
  ukr: 'Українська',
  uk: 'Українська',
  jpn: 'Japanese',
  ja: 'Japanese',
  fre: 'Français',
  fra: 'Français',
  fr: 'Français',
  ger: 'Deutsch',
  deu: 'Deutsch',
  de: 'Deutsch',
  spa: 'Español',
  es: 'Español',
  ita: 'Italiano',
  it: 'Italiano',
  chi: '中文',
  zho: '中文',
  kor: '한국어',
  ko: '한국어',
  mul: 'Multi',
};

// trackLabel builds a compact human-readable label from a TrackInfo. Strategy:
//   1. lang + codec → "Русский (AC3)"
//   2. lang only    → "Русский"
//   3. title only   → "Director's Commentary"
//   4. fallback     → "Track #2 (aac)"
// codec is upper-cased only when paired with a language; the bare-codec
// fallback keeps the original casing because some backends return e.g.
// "ac3"/"AC3"/"truehd" with subtle differences we don't want to flatten.
export function trackLabel(t: TrackInfo): string {
  const langKey = (t.language || '').trim().toLowerCase();
  const lang = langKey ? LANG_NAMES[langKey] || t.language : '';
  const codec = (t.codec || '').trim();
  const title = (t.title || '').trim();
  if (lang && codec) return `${lang} (${codec.toUpperCase()})`;
  if (lang) return lang;
  if (title) return title;
  if (codec) return `Track #${t.index} (${codec})`;
  return `Track #${t.index}`;
}
