// Package btdig scrapes btdig.com — a DHT-based torrent meta-search. It
// indexes the whole BitTorrent DHT, so it surfaces Polish, Ukrainian,
// and other long-tail releases that the dedicated trackers (rutor /
// 1337x / apibay) miss. Trade-off: btdig has no seeder/leecher counts,
// so torrents that come ONLY from btdig will show as 0 seeders (red
// streamability dot). When the same infohash is present in another
// source, the aggregator's grouping picks that source's seeder count.
package btdig

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/PuerkitoBio/goquery"

	"github.com/AntonZubritski/ZubraCinema/internal/sources"
)

const baseURL = "https://btdig.com"

type Source struct {
	http *http.Client
}

func New() *Source {
	return &Source{http: &http.Client{Timeout: 15 * time.Second}}
}

func (s *Source) Name() string { return "btdig" }

// Search hits btdig's HTML search page and parses results. Order=2 is
// "by seeds" on btdig's UI which orders by DHT-observed peers (best-
// effort signal). We don't paginate beyond page 0 — the global search
// aggregator caps results to ~80 anyway.
func (s *Source) Search(ctx context.Context, query string) ([]sources.Torrent, error) {
	q := strings.TrimSpace(query)
	if q == "" {
		return nil, nil
	}
	u := fmt.Sprintf("%s/search?q=%s&order=2", baseURL, url.QueryEscape(q))
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", sources.UserAgent)
	resp, err := s.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("btdig: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("btdig: status %d", resp.StatusCode)
	}
	doc, err := goquery.NewDocumentFromReader(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("btdig parse: %w", err)
	}

	var out []sources.Torrent
	doc.Find("div.one_result").Each(func(_ int, row *goquery.Selection) {
		title := strings.TrimSpace(row.Find("div.torrent_name a").First().Text())
		if title == "" {
			return
		}
		magnet, _ := row.Find("a[href^='magnet:']").First().Attr("href")
		if magnet == "" {
			return
		}
		// Pull infohash out of the magnet for a stable ID. Falls back
		// to the title if parsing fails (rare).
		id := title
		if m := infohashRe.FindStringSubmatch(magnet); len(m) >= 2 {
			id = strings.ToLower(m[1])
		}
		size := parseSize(strings.TrimSpace(row.Find("span.torrent_size").First().Text()))
		out = append(out, sources.Torrent{
			ID:       id,
			Title:    title,
			Magnet:   magnet,
			Size:     size,
			Source:   "btdig",
			Quality:  sources.DetectQuality(title),
			Language: sources.DetectLanguage(title),
		})
	})
	return out, nil
}

var infohashRe = regexp.MustCompile(`btih:([0-9a-fA-F]+)`)

// parseSize handles btdig's "33.36 GB" / "189.26 KB" / "1.2 TB" format.
// Whitespace-trimmed input expected.
func parseSize(s string) int64 {
	s = strings.ReplaceAll(s, " ", " ")
	s = strings.TrimSpace(s)
	parts := strings.Fields(s)
	if len(parts) < 2 {
		return 0
	}
	n, err := strconv.ParseFloat(strings.Replace(parts[0], ",", ".", 1), 64)
	if err != nil {
		return 0
	}
	switch strings.ToUpper(parts[1]) {
	case "B":
		return int64(n)
	case "KB":
		return int64(n * 1024)
	case "MB":
		return int64(n * 1024 * 1024)
	case "GB":
		return int64(n * 1024 * 1024 * 1024)
	case "TB":
		return int64(n * 1024 * 1024 * 1024 * 1024)
	}
	return 0
}
