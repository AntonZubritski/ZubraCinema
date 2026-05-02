package sources

import "context"

type Torrent struct {
	ID        string  `json:"id"`
	Title     string  `json:"title"`
	Size      int64   `json:"size"`
	Seeders   int     `json:"seeders"`
	Leechers  int     `json:"leechers"`
	Quality   *string `json:"quality"`
	Source    string  `json:"source"`
	Magnet    string  `json:"magnet"`
	DetailURL string  `json:"-"`
	PosterURL string  `json:"posterUrl"`
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
