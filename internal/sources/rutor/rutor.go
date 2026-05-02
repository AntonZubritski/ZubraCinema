package rutor

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/PuerkitoBio/goquery"

	"github.com/AntonZubritski/ZubraCinema/internal/sources"
)

const (
	name    = "rutor"
	baseURL = "http://rutor.info"
)

type Source struct {
	http *http.Client
}

func New() *Source {
	return &Source{
		http: &http.Client{
			Timeout: 10 * time.Second,
			CheckRedirect: func(req *http.Request, via []*http.Request) error {
				if len(via) > 5 {
					return http.ErrUseLastResponse
				}
				return nil
			},
		},
	}
}

func (s *Source) Name() string { return name }

func (s *Source) Search(ctx context.Context, query string) ([]sources.Torrent, error) {
	q := url.PathEscape(query)
	u := fmt.Sprintf("%s/search/0/0/000/0/%s", baseURL, q)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", sources.UserAgent)
	resp, err := s.http.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("rutor http %d", resp.StatusCode)
	}
	doc, err := goquery.NewDocumentFromReader(resp.Body)
	if err != nil {
		return nil, err
	}

	var out []sources.Torrent
	doc.Find("table tr").Each(func(_ int, tr *goquery.Selection) {
		// Skip header/empty rows.
		tds := tr.Find("td")
		if tds.Length() < 4 {
			return
		}
		// Find magnet link inside the row.
		var magnet string
		tr.Find("a").EachWithBreak(func(_ int, a *goquery.Selection) bool {
			href, _ := a.Attr("href")
			if strings.HasPrefix(href, "magnet:") {
				magnet = href
				return false
			}
			return true
		})
		if magnet == "" {
			return
		}
		// Title — first <a> that points to /torrent/<id> usually carries the human title.
		var title string
		tr.Find("a").EachWithBreak(func(_ int, a *goquery.Selection) bool {
			href, _ := a.Attr("href")
			if strings.HasPrefix(href, "/torrent/") {
				title = strings.TrimSpace(a.Text())
				return false
			}
			return true
		})
		if title == "" {
			// Fallback: take whole row text from the title cell.
			title = strings.TrimSpace(tds.Eq(1).Text())
		}

		// Size: typically tds.Eq(tds.Length()-3) or so. rutor layout has columns:
		// [date] [name] [comments?] [size] [seeders] [leechers]
		var sizeStr, seedStr, leechStr string
		n := tds.Length()
		if n >= 4 {
			sizeStr = strings.TrimSpace(tds.Eq(n - 3).Text())
		}
		// seeders/leechers are usually inside <span class="green">/<span class="red"> in the last cell or last two cells.
		if greens := tr.Find("span.green").First(); greens.Length() > 0 {
			seedStr = strings.TrimSpace(greens.Text())
		}
		if reds := tr.Find("span.red").First(); reds.Length() > 0 {
			leechStr = strings.TrimSpace(reds.Text())
		}
		if seedStr == "" && n >= 2 {
			seedStr = strings.TrimSpace(tds.Eq(n - 2).Text())
		}
		if leechStr == "" && n >= 1 {
			leechStr = strings.TrimSpace(tds.Eq(n - 1).Text())
		}

		seeders, _ := strconv.Atoi(stripNonDigits(seedStr))
		leechers, _ := strconv.Atoi(stripNonDigits(leechStr))
		size := sources.ParseSize(sizeStr)
		quality := sources.DetectQuality(title)
		id := sources.MagnetInfoHash(magnet)

		out = append(out, sources.Torrent{
			ID:       id,
			Title:    title,
			Size:     size,
			Seeders:  seeders,
			Leechers: leechers,
			Quality:  quality,
			Source:   name,
			Magnet:   magnet,
		})
	})
	return out, nil
}

func stripNonDigits(s string) string {
	var b strings.Builder
	for _, r := range s {
		if r >= '0' && r <= '9' {
			b.WriteRune(r)
		}
	}
	return b.String()
}
