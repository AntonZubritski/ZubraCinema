package apibay

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/AntonZubritski/ZubraCinema/internal/sources"
)

const (
	name    = "apibay"
	baseURL = "https://apibay.org"
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

type apiItem struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	InfoHash string `json:"info_hash"`
	Leechers string `json:"leechers"`
	Seeders  string `json:"seeders"`
	Size     string `json:"size"`
	Category string `json:"category"`
}

func (s *Source) Search(ctx context.Context, query string) ([]sources.Torrent, error) {
	u := fmt.Sprintf("%s/q.php?q=%s&cat=200", baseURL, url.QueryEscape(query))
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
		return nil, fmt.Errorf("apibay http %d", resp.StatusCode)
	}
	var items []apiItem
	if err := json.NewDecoder(resp.Body).Decode(&items); err != nil {
		return nil, err
	}
	if len(items) == 1 && (items[0].ID == "0" || strings.EqualFold(items[0].Name, "No results returned")) {
		return nil, nil
	}

	out := make([]sources.Torrent, 0, len(items))
	for _, it := range items {
		hash := strings.TrimSpace(strings.ToLower(it.InfoHash))
		if len(hash) != 40 {
			continue
		}
		size, _ := strconv.ParseInt(it.Size, 10, 64)
		seeders, _ := strconv.Atoi(it.Seeders)
		leechers, _ := strconv.Atoi(it.Leechers)
		magnet := buildMagnet(hash, it.Name)
		out = append(out, sources.Torrent{
			ID:       hash,
			Title:    it.Name,
			Size:     size,
			Seeders:  seeders,
			Leechers: leechers,
			Quality:  sources.DetectQuality(it.Name),
			Source:   name,
			Magnet:   magnet,
			Language: sources.DetectLanguage(it.Name),
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
