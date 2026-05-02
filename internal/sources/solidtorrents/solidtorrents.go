package solidtorrents

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
	name    = "solidtorrents"
	baseURL = "https://solidtorrents.to"
)

var trackers = []string{
	"udp://tracker.coppersurfer.tk:6969/announce",
	"udp://tracker.openbittorrent.com:6969/announce",
	"udp://9.rarbg.to:2920/announce",
	"udp://tracker.opentrackr.org:1337",
	"udp://tracker.internetwarriors.net:1337/announce",
	"udp://tracker.leechers-paradise.org:6969/announce",
	"udp://tracker.pirateparty.gr:6969/announce",
	"udp://tracker.cyberia.is:6969/announce",
}

type Source struct {
	http *http.Client
}

func New() *Source {
	return &Source{http: &http.Client{Timeout: 10 * time.Second}}
}

func (s *Source) Name() string { return name }

type apiResponse struct {
	Success bool      `json:"success"`
	Query   string    `json:"query"`
	Results []apiItem `json:"results"`
}

type apiItem struct {
	ID        string `json:"id"`
	InfoHash  string `json:"infohash"`
	Title     string `json:"title"`
	Size      int64  `json:"size"`
	Category  int    `json:"category"`
	Seeders   int    `json:"seeders"`
	Leechers  int    `json:"leechers"`
	Downloads int    `json:"downloads"`
	Verified  bool   `json:"verified"`
	UpdatedAt string `json:"updatedAt"`
}

func (s *Source) Search(ctx context.Context, query string) ([]sources.Torrent, error) {
	u := fmt.Sprintf("%s/api/v1/search?q=%s&limit=50&sort=seeders&order=desc", baseURL, url.QueryEscape(query))
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
		return nil, fmt.Errorf("solidtorrents http %d", resp.StatusCode)
	}
	var body apiResponse
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return nil, err
	}
	if !body.Success {
		return nil, nil
	}

	out := make([]sources.Torrent, 0, len(body.Results))
	for _, it := range body.Results {
		hash := strings.TrimSpace(strings.ToLower(it.InfoHash))
		if len(hash) != 40 {
			continue
		}
		magnet := buildMagnet(hash, it.Title)
		out = append(out, sources.Torrent{
			ID:       hash,
			Title:    it.Title,
			Size:     it.Size,
			Seeders:  it.Seeders,
			Leechers: it.Leechers,
			Quality:  sources.DetectQuality(it.Title),
			Source:   name,
			Magnet:   magnet,
			Language: sources.DetectLanguage(it.Title),
		})
	}
	return out, nil
}

func buildMagnet(hash, displayName string) string {
	var b strings.Builder
	b.WriteString("magnet:?xt=urn:btih:")
	b.WriteString(hash)
	if displayName != "" {
		b.WriteString("&dn=")
		b.WriteString(url.QueryEscape(displayName))
	}
	for _, t := range trackers {
		b.WriteString("&tr=")
		b.WriteString(url.QueryEscape(t))
	}
	return b.String()
}
