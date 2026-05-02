import type { Group, GroupTorrent } from '../api';
import { languageScore, normalizeLanguage, type Language } from './lang';

export type SortKey = 'relevance' | 'seeders' | 'size' | 'title' | 'year';

export const SORT_LABELS: Record<SortKey, string> = {
  relevance: 'По релевантности',
  seeders: 'По сидерам',
  size: 'По размеру',
  title: 'По названию',
  year: 'По году',
};

export type QualityBucket = '4k' | '1080p' | '720p' | 'other';

export const ALL_QUALITIES: QualityBucket[] = ['4k', '1080p', '720p', 'other'];

export const QUALITY_LABELS: Record<QualityBucket, string> = {
  '4k': '4K',
  '1080p': '1080p',
  '720p': '720p',
  other: 'Другое',
};

export function classifyQuality(quality: string | null | undefined): QualityBucket {
  const q = (quality ?? '').toLowerCase();
  if (!q) return 'other';
  if (q.includes('2160') || q.includes('4k') || q.includes('uhd')) return '4k';
  if (q.includes('1080')) return '1080p';
  if (q.includes('720')) return '720p';
  return 'other';
}

function totalSeeders(group: Group): number {
  let sum = 0;
  for (const t of group.torrents) sum += t.seeders;
  return sum;
}

function maxSize(group: Group): number {
  let max = 0;
  for (const t of group.torrents) if (t.size > max) max = t.size;
  return max;
}

function topTorrentLanguage(group: Group): Language {
  if (group.torrents.length === 0) return 'other';
  const ranked = [...group.torrents].sort((a, b) => {
    const ls = languageScore(normalizeLanguage(b.language)) - languageScore(normalizeLanguage(a.language));
    if (ls !== 0) return ls;
    return b.seeders - a.seeders;
  });
  return normalizeLanguage(ranked[0].language);
}

export function sortTorrentsByLanguagePriority(torrents: GroupTorrent[]): GroupTorrent[] {
  return [...torrents].sort((a, b) => {
    const ls = languageScore(normalizeLanguage(b.language)) - languageScore(normalizeLanguage(a.language));
    if (ls !== 0) return ls;
    return b.seeders - a.seeders;
  });
}

export function sortGroups(groups: Group[], sortKey: SortKey): Group[] {
  const arr = [...groups];
  switch (sortKey) {
    case 'relevance':
      arr.sort((a, b) => {
        const ls = languageScore(topTorrentLanguage(b)) - languageScore(topTorrentLanguage(a));
        if (ls !== 0) return ls;
        return totalSeeders(b) - totalSeeders(a);
      });
      break;
    case 'seeders':
      arr.sort((a, b) => totalSeeders(b) - totalSeeders(a));
      break;
    case 'size':
      arr.sort((a, b) => maxSize(b) - maxSize(a));
      break;
    case 'title':
      arr.sort((a, b) => a.title.localeCompare(b.title, ['ru', 'uk', 'en']));
      break;
    case 'year':
      arr.sort((a, b) => {
        const ay = a.year > 0 ? a.year : -Infinity;
        const by = b.year > 0 ? b.year : -Infinity;
        return by - ay;
      });
      break;
  }
  return arr;
}

export function filterGroups(
  groups: Group[],
  langs: Language[],
  qualities: QualityBucket[],
): Group[] {
  const langSet = new Set(langs);
  const qSet = new Set(qualities);
  const allLangs = langSet.size === 0;
  const allQ = qSet.size === 0;
  return groups.filter((g) => {
    return g.torrents.some((t) => {
      const langOk = allLangs || langSet.has(normalizeLanguage(t.language));
      const qOk = allQ || qSet.has(classifyQuality(t.quality));
      return langOk && qOk;
    });
  });
}

