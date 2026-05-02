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
	Magnet   string  `json:"magnet"`
}

type Source interface {
	Name() string
	Search(ctx context.Context, query string) ([]Torrent, error)
}
