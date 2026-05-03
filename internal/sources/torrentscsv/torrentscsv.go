package torrentscsv

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/AntonZubritski/ZubraCinema/internal/sources"
)

const (
	name    = "torrents-csv"
	baseURL = "https://torrents-csv.com"
)

type Source struct {
	http *http.Client
}

func New() *Source {
	return &Source{http: &http.Client{Timeout: 12 * time.Second}}
}

func (s *Source) Name() string { return name }

type apiResponse struct {
	Torrents []apiItem `json:"torrents"`
}

type apiItem struct {
	InfoHash    string `json:"infohash"`
	Name        string `json:"name"`
	SizeBytes   int64  `json:"size_bytes"`
	CreatedUnix int64  `json:"created_unix"`
	Seeders     int    `json:"seeders"`
	Leechers    int    `json:"leechers"`
	Completed   int    `json:"completed"`
	ScrapedDate int64  `json:"scraped_date"`
	ID          int64  `json:"id"`
}

func (s *Source) Search(ctx context.Context, query string) ([]sources.Torrent, error) {
	u := fmt.Sprintf("%s/service/search?q=%s&size=50", baseURL, url.QueryEscape(query))
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", sources.UserAgent)
	req.Header.Set("Accept", "application/json")
	resp, err := s.http.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("torrents-csv http %d", resp.StatusCode)
	}
	var body apiResponse
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return nil, err
	}

	out := make([]sources.Torrent, 0, len(body.Torrents))
	for _, it := range body.Torrents {
		hash := strings.TrimSpace(strings.ToLower(it.InfoHash))
		if len(hash) != 40 {
			continue
		}
		magnet := sources.BuildMagnet(hash, it.Name)
		out = append(out, sources.Torrent{
			ID:       hash,
			Title:    it.Name,
			Size:     it.SizeBytes,
			Seeders:  it.Seeders,
			Leechers: it.Leechers,
			Quality:  sources.DetectQuality(it.Name),
			Source:   name,
			Magnet:   magnet,
			Language: sources.DetectLanguage(it.Name),
		})
	}
	return out, nil
}

