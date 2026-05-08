package sources

import "context"

type Torrent struct {
	ID       string  `json:"id"`
	Title    string  `json:"title"`
	Size     int64   `json:"size"`
	Seeders  int     `json:"seeders"`
	Leechers int     `json:"leechers"`
	Quality  *string `json:"quality"`
	Source   string  `json:"source"`
	// Magnet is the BitTorrent magnet URI when the source exposes one.
	// Sources that only publish .torrent files (e.g. porevotorrent, which
	// hides the actual content behind an ad-redirect CDN) leave this empty
	// and populate TorrentFileURL instead — the manager fetches and decodes
	// the file at start time to recover the infohash.
	Magnet string `json:"magnet"`
	// TorrentFileURL points at a downloadable .torrent file. Used when
	// Magnet is empty. At least one of (Magnet, TorrentFileURL) must be set.
	TorrentFileURL string `json:"torrentFileUrl,omitempty"`
	DetailURL      string `json:"-"`
	PosterURL      string `json:"posterUrl"`
	Language       string `json:"language,omitempty"`
}

type Source interface {
	Name() string
	Search(ctx context.Context, query string) ([]Torrent, error)
}

// PosterFetcher is implemented by sources that can resolve a poster image
// from a torrent's detail-page URL. Implementations must be safe for
// concurrent use and respect ctx cancellation.
type PosterFetcher interface {
	FetchPoster(ctx context.Context, detailURL string) (string, error)
}
