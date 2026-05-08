// Package categories defines the canonical, hand-picked list of rutor
// categories browseable from the ZubraCinema home page.
//
// Rutor exposes ~12 top-level categories, but ZubraCinema is a movie-
// and series-focused app, so we deliberately skip Music, Games,
// Software, Books and other non-video sections. The order of entries
// here is the display order on the home page.
package categories

type Category struct {
	Slug    string // URL-safe ASCII, e.g. "movies-foreign"
	LabelRU string // human label in Russian
	// Source picks which scraper handles the listing. Empty = "rutor"
	// (back-compat default). Other supported values: "rintor",
	// "porevotorrent".
	Source string
	// RutorID is the rutor numeric category id (used when Source=="rutor").
	RutorID string
	// RutorTag, when non-empty (and Source=="rutor"), narrows the listing
	// to a specific genre tag via rutor's /tag/{catID}/{label} URL. Genre
	// tags are Cyrillic literals copied verbatim from rutor's /categories
	// page; the URL builder handles percent-encoding. Tag-based listings
	// have no pagination on rutor (~27 latest entries per tag), so the
	// API forces hasMore=false on tag listings.
	RutorTag string
	// RintorID is the rintor.org forum id (used when Source=="rintor").
	// Maps to /viewforum.php?f=<RintorID>.
	RintorID string
	// PorevoTag is the porevotorrent.net tag slug (used when
	// Source=="porevotorrent"). Maps to /tags/<PorevoTag>/. Tags include
	// resolution buckets like "1080p" or "2160p", studio names like
	// "Brazzers.com", and broad genre labels like "Anal" or "Russian".
	PorevoTag string
	// Adult marks 18+ categories. The home page hides these unless the
	// user opted in via Settings (config.Adult). The backend itself
	// doesn't gate /api/category — that stays open so deep links work
	// for users who already enabled the flag and bookmarked a URL.
	Adult bool
}

var all = []Category{
	// Top-level categories — full /browse/ paginated listings.
	{Slug: "movies-foreign", RutorID: "1", LabelRU: "Зарубежные фильмы"},
	{Slug: "movies-russian", RutorID: "5", LabelRU: "Наши фильмы"},
	{Slug: "series-foreign", RutorID: "4", LabelRU: "Зарубежные сериалы"},
	{Slug: "series-russian", RutorID: "16", LabelRU: "Наши сериалы"},
	{Slug: "animation", RutorID: "7", LabelRU: "Мультипликация"},
	{Slug: "anime", RutorID: "10", LabelRU: "Аниме"},

	// Genre rows for foreign films (catID=1). Tag labels match rutor's
	// /categories page exactly — including the trailing `*` rutor uses
	// for prefix-match tags (Биограф*, Романти*, Короткометраж*).
	{Slug: "action-foreign", RutorID: "1", LabelRU: "Боевики", RutorTag: "Боевик"},
	{Slug: "comedy-foreign", RutorID: "1", LabelRU: "Комедии", RutorTag: "Комедия"},
	{Slug: "drama-foreign", RutorID: "1", LabelRU: "Драмы", RutorTag: "Драма"},
	{Slug: "horror-foreign", RutorID: "1", LabelRU: "Ужасы", RutorTag: "Ужасы"},
	{Slug: "scifi-foreign", RutorID: "1", LabelRU: "Фантастика", RutorTag: "Фантастика"},
	{Slug: "thriller-foreign", RutorID: "1", LabelRU: "Триллеры", RutorTag: "Триллер"},
	{Slug: "adventure-foreign", RutorID: "1", LabelRU: "Приключения", RutorTag: "Приключения"},
	{Slug: "fantasy-foreign", RutorID: "1", LabelRU: "Фэнтези", RutorTag: "Фэнтези"},
	{Slug: "detective-foreign", RutorID: "1", LabelRU: "Детективы", RutorTag: "Детектив"},
	{Slug: "melodrama-foreign", RutorID: "1", LabelRU: "Мелодрамы", RutorTag: "Мелодрама"},

	// 18+ rows — visible only when Settings → Adult is enabled.
	// Rutor "Эротика" tag (works alongside the rintor source below).
	{Slug: "adult-erotica-foreign", Source: "rutor", RutorID: "1", LabelRU: "Эротика (зарубежное)", RutorTag: "Эротика", Adult: true},
	{Slug: "adult-erotica-russian", Source: "rutor", RutorID: "5", LabelRU: "Эротика (наше)", RutorTag: "Эротика", Adult: true},
	// rintor.org forums. RintorID is the `f` query param on /viewforum.php.
	// Pornotrack.net, domaha.tv, xxxtor.net all sit behind an IP-deny WAF
	// for non-RU/CIS traffic; rintor is the one of the four that's
	// currently scrapable.
	{Slug: "adult-rintor-hd", Source: "rintor", RintorID: "26", LabelRU: "HD Порнофильмы", Adult: true},
	{Slug: "adult-rintor-feature", Source: "rintor", RintorID: "21", LabelRU: "Фильмы с сюжетом", Adult: true},
	{Slug: "adult-rintor-russian", Source: "rintor", RintorID: "36", LabelRU: "Русские порнофильмы", Adult: true},
	{Slug: "adult-rintor-4k", Source: "rintor", RintorID: "71", LabelRU: "4K Порно", Adult: true},
	{Slug: "adult-rintor-gonzo", Source: "rintor", RintorID: "20", LabelRU: "Гонзо", Adult: true},
	{Slug: "adult-rintor-lesbo", Source: "rintor", RintorID: "22", LabelRU: "Лесбо", Adult: true},
	{Slug: "adult-rintor-ethnic", Source: "rintor", RintorID: "23", LabelRU: "Этнические", Adult: true},
	{Slug: "adult-rintor-classic", Source: "rintor", RintorID: "25", LabelRU: "Классика / Ретро", Adult: true},
	{Slug: "adult-rintor-japan", Source: "rintor", RintorID: "35", LabelRU: "Японское", Adult: true},
	{Slug: "adult-rintor-hentai", Source: "rintor", RintorID: "58", LabelRU: "Хентай", Adult: true},

	// porevotorrent.net — tag-based listings; no seeders/leechers data
	// (it's a meta-index that hides .torrent files behind an ad CDN).
	// Picked the tags that map cleanly to "what kind of release" rather
	// than trying to mirror the site's full 80-tag taxonomy.
	{Slug: "adult-porevo-2160p", Source: "porevotorrent", PorevoTag: "2160p", LabelRU: "4K Порно (porevo)", Adult: true},
	{Slug: "adult-porevo-1080p", Source: "porevotorrent", PorevoTag: "1080p", LabelRU: "FHD Порно (porevo)", Adult: true},
	{Slug: "adult-porevo-russian", Source: "porevotorrent", PorevoTag: "Russian", LabelRU: "Русские (porevo)", Adult: true},
	{Slug: "adult-porevo-anal", Source: "porevotorrent", PorevoTag: "Anal", LabelRU: "Anal (porevo)", Adult: true},
	{Slug: "adult-porevo-amateur", Source: "porevotorrent", PorevoTag: "Amateur", LabelRU: "Amateur (porevo)", Adult: true},
	{Slug: "adult-porevo-milf", Source: "porevotorrent", PorevoTag: "MILF", LabelRU: "MILF (porevo)", Adult: true},
	{Slug: "adult-porevo-teen", Source: "porevotorrent", PorevoTag: "Teen", LabelRU: "Teen (porevo)", Adult: true},
	{Slug: "adult-porevo-pov", Source: "porevotorrent", PorevoTag: "POV", LabelRU: "POV (porevo)", Adult: true},
}

// All returns the canonical category list in home-page display order.
// The returned slice is a defensive copy; mutating it does not affect
// the package-level state.
func All() []Category {
	out := make([]Category, len(all))
	copy(out, all)
	return out
}

// BySlug looks up a category by its URL-safe slug. The second return
// value is false if no category matches.
func BySlug(slug string) (Category, bool) {
	for _, c := range all {
		if c.Slug == slug {
			return c, true
		}
	}
	return Category{}, false
}
