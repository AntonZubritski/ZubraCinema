// Home-page browse categories — movie-focused subset of rutor's 12 sections
// (skips music, games, software, etc.). The list mixes top-level rutor
// categories (full paginated browse) and genre rows (single page from
// rutor's /tag/ endpoint — backend handles the routing). Display order
// here is the home-page row order.

export type CategorySlug = string;

export type CategoryDescriptor = {
  slug: string;
  label: string;
  rutorId: string;
  adult?: boolean;   // 18+ row — visible only when Settings → Adult is on
};

export const CATEGORIES: readonly CategoryDescriptor[] = [
  // Top-level categories (full browse).
  { slug: 'movies-foreign', label: 'Зарубежные фильмы',  rutorId: '1' },
  { slug: 'movies-russian', label: 'Наши фильмы',        rutorId: '5' },
  { slug: 'series-foreign', label: 'Зарубежные сериалы', rutorId: '4' },
  { slug: 'series-russian', label: 'Наши сериалы',       rutorId: '16' },
  { slug: 'animation',      label: 'Мультипликация',     rutorId: '7' },
  { slug: 'anime',          label: 'Аниме',              rutorId: '10' },

  // Genre rows for foreign films (rutorId=1). Single-page listings.
  { slug: 'action-foreign',     label: 'Боевики',     rutorId: '1' },
  { slug: 'comedy-foreign',     label: 'Комедии',     rutorId: '1' },
  { slug: 'drama-foreign',      label: 'Драмы',       rutorId: '1' },
  { slug: 'horror-foreign',     label: 'Ужасы',       rutorId: '1' },
  { slug: 'scifi-foreign',      label: 'Фантастика',  rutorId: '1' },
  { slug: 'thriller-foreign',   label: 'Триллеры',    rutorId: '1' },
  { slug: 'adventure-foreign',  label: 'Приключения', rutorId: '1' },
  { slug: 'fantasy-foreign',    label: 'Фэнтези',     rutorId: '1' },
  { slug: 'detective-foreign',  label: 'Детективы',   rutorId: '1' },
  { slug: 'melodrama-foreign',  label: 'Мелодрамы',   rutorId: '1' },

  // 18+ — visible only with Settings → Adult enabled. Two source families:
  //   1. rutor "Эротика" tag (works alongside the regular movie catalogue).
  //   2. rintor.org forums (dedicated adult tracker). pornotrack.net /
  //      domaha.tv / xxxtor.net all sit behind an IP-deny WAF for non-
  //      RU/CIS traffic; rintor is the only one of the four currently
  //      scrapable from the agent's IP.
  { slug: 'adult-erotica-foreign', label: 'Эротика (зарубежное)',  rutorId: '1', adult: true },
  { slug: 'adult-erotica-russian', label: 'Эротика (наше)',        rutorId: '5', adult: true },
  { slug: 'adult-rintor-hd',       label: 'HD Порнофильмы',        rutorId: '',  adult: true },
  { slug: 'adult-rintor-feature',  label: 'Фильмы с сюжетом',      rutorId: '',  adult: true },
  { slug: 'adult-rintor-russian',  label: 'Русские порнофильмы',   rutorId: '',  adult: true },
  { slug: 'adult-rintor-4k',       label: '4K Порно',              rutorId: '',  adult: true },
  { slug: 'adult-rintor-gonzo',    label: 'Гонзо',                 rutorId: '',  adult: true },
  { slug: 'adult-rintor-lesbo',    label: 'Лесбо',                 rutorId: '',  adult: true },
  { slug: 'adult-rintor-ethnic',   label: 'Этнические',            rutorId: '',  adult: true },
  { slug: 'adult-rintor-classic',  label: 'Классика / Ретро',      rutorId: '',  adult: true },
  { slug: 'adult-rintor-japan',    label: 'Японское',              rutorId: '',  adult: true },
  { slug: 'adult-rintor-hentai',   label: 'Хентай',                rutorId: '',  adult: true },
];

const SLUGS: ReadonlySet<string> = new Set(CATEGORIES.map((c) => c.slug));

export function categoryBySlug(slug: string): CategoryDescriptor | null {
  return CATEGORIES.find((c) => c.slug === slug) ?? null;
}

export function isCategorySlug(value: string): value is CategorySlug {
  return SLUGS.has(value);
}
