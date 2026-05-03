package yts

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
	name    = "yts"
	baseURL = "https://yts.mx"
)

type Source struct {
	http *http.Client
}

func New() *Source {
	return &Source{http: &http.Client{Timeout: 10 * time.Second}}
}

func (s *Source) Name() string { return name }

type apiResponse struct {
	Status string `json:"status"`
	Data   struct {
		Movies []apiMovie `json:"movies"`
	} `json:"data"`
}

type apiMovie struct {
	Title             string       `json:"title"`
	Year              int          `json:"year"`
	LargeCoverImage   string       `json:"large_cover_image"`
	MediumCoverImage  string       `json:"medium_cover_image"`
	Torrents          []apiTorrent `json:"torrents"`
}

type apiTorrent struct {
	Hash      string `json:"hash"`
	Quality   string `json:"quality"`
	Type      string `json:"type"`
	SizeBytes int64  `json:"size_bytes"`
	Seeds     int    `json:"seeds"`
	Peers     int    `json:"peers"`
}

func (s *Source) Search(ctx context.Context, query string) ([]sources.Torrent, error) {
	u := fmt.Sprintf("%s/api/v2/list_movies.json?query_term=%s&limit=20&sort_by=seeds", baseURL, url.QueryEscape(query))
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
		return nil, fmt.Errorf("yts http %d", resp.StatusCode)
	}
	var body apiResponse
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return nil, err
	}
	if body.Status != "ok" {
		return nil, nil
	}

	var out []sources.Torrent
	for _, m := range body.Data.Movies {
		poster := m.LargeCoverImage
		if poster == "" {
			poster = m.MediumCoverImage
		}
		for _, t := range m.Torrents {
			hash := strings.TrimSpace(strings.ToLower(t.Hash))
			if len(hash) != 40 {
				continue
			}
			parts := []string{m.Title}
			if m.Year > 0 {
				parts = append(parts, fmt.Sprintf("(%d)", m.Year))
			}
			if t.Quality != "" {
				parts = append(parts, t.Quality)
			}
			if t.Type != "" {
				parts = append(parts, t.Type)
			}
			title := strings.Join(parts, " ")
			magnet := sources.BuildMagnet(hash, title)
			out = append(out, sources.Torrent{
				ID:        hash,
				Title:     title,
				Size:      t.SizeBytes,
				Seeders:   t.Seeds,
				Leechers:  t.Peers,
				Quality:   sources.DetectQuality(title),
				Source:    name,
				Magnet:    magnet,
				PosterURL: poster,
				Language:  sources.DetectLanguage(title),
			})
		}
	}
	return out, nil
}

