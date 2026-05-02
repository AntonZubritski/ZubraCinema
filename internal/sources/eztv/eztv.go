package eztv

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/AntonZubritski/ZubraCinema/internal/sources"
)

const (
	name    = "eztv"
	baseURL = "https://eztv.re"
)

type Source struct {
	http *http.Client
}

func New() *Source {
	return &Source{http: &http.Client{Timeout: 10 * time.Second}}
}

func (s *Source) Name() string { return name }

type apiResponse struct {
	TorrentsCount int        `json:"torrents_count"`
	Limit         int        `json:"limit"`
	Page          int        `json:"page"`
	Torrents      []apiItem  `json:"torrents"`
}

type apiItem struct {
	ID               int64  `json:"id"`
	Hash             string `json:"hash"`
	Filename         string `json:"filename"`
	MagnetURL        string `json:"magnet_url"`
	Title            string `json:"title"`
	IMDBID           string `json:"imdb_id"`
	Season           string `json:"season"`
	Episode          string `json:"episode"`
	SmallScreenshot  string `json:"small_screenshot"`
	LargeScreenshot  string `json:"large_screenshot"`
	TorrentURL       string `json:"torrent_url"`
	SizeBytes        string `json:"size_bytes"`
	DateReleasedUnix int64  `json:"date_released_unix"`
	Seeds            int    `json:"seeds"`
	Peers            int    `json:"peers"`
}

func (s *Source) Search(ctx context.Context, query string) ([]sources.Torrent, error) {
	u := fmt.Sprintf("%s/api/get-torrents?limit=50&page=1", baseURL)
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
		return nil, fmt.Errorf("eztv http %d", resp.StatusCode)
	}
	var body apiResponse
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return nil, err
	}

	q := strings.ToLower(strings.TrimSpace(query))
	out := make([]sources.Torrent, 0, len(body.Torrents))
	for _, it := range body.Torrents {
		title := it.Title
		if title == "" {
			title = it.Filename
		}
		if q != "" && !strings.Contains(strings.ToLower(title), q) {
			continue
		}
		hash := strings.TrimSpace(strings.ToLower(it.Hash))
		magnet := it.MagnetURL
		if magnet == "" {
			continue
		}
		if hash == "" {
			hash = sources.MagnetInfoHash(magnet)
		}
		size, _ := strconv.ParseInt(strings.TrimSpace(it.SizeBytes), 10, 64)
		poster := it.LargeScreenshot
		if poster == "" {
			poster = it.SmallScreenshot
		}
		out = append(out, sources.Torrent{
			ID:        hash,
			Title:     title,
			Size:      size,
			Seeders:   it.Seeds,
			Leechers:  it.Peers,
			Quality:   sources.DetectQuality(title),
			Source:    name,
			Magnet:    magnet,
			PosterURL: poster,
			Language:  sources.DetectLanguage(title),
		})
	}
	sort.SliceStable(out, func(i, j int) bool {
		return out[i].Seeders > out[j].Seeders
	})
	return out, nil
}
