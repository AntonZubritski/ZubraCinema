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
	doc, err := s.fetchDoc(ctx, u)
	if err != nil {
		return nil, err
	}
	return parseRows(doc), nil
}

func (s *Source) fetchDoc(ctx context.Context, u string) (*goquery.Document, error) {
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
	return goquery.NewDocumentFromReader(resp.Body)
}

// BrowseLatest fetches rutor's "Movies HD" category (first page) and parses
// it the same way as a search result page. Used by the featured endpoint.
func (s *Source) BrowseLatest(ctx context.Context) ([]sources.Torrent, error) {
	doc, err := s.fetchDoc(ctx, baseURL+"/browse/0/4/000/0")
	if err != nil {
		return nil, err
	}
	return parseRows(doc), nil
}

// parseRows extracts torrents from a rutor table page (search or browse).
// The two share the same row structure.
func parseRows(doc *goquery.Document) []sources.Torrent {
	var out []sources.Torrent
	doc.Find("table tr").Each(func(_ int, tr *goquery.Selection) {
		tds := tr.Find("td")
		if tds.Length() < 4 {
			return
		}
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
		var title, detailURL string
		tr.Find("a").EachWithBreak(func(_ int, a *goquery.Selection) bool {
			href, _ := a.Attr("href")
			if strings.HasPrefix(href, "/torrent/") {
				title = strings.TrimSpace(a.Text())
				detailURL = baseURL + href
				return false
			}
			return true
		})
		if title == "" {
			title = strings.TrimSpace(tds.Eq(1).Text())
		}

		var seedStr, leechStr string
		n := tds.Length()
		var size int64
		for i := n - 1; i >= 0; i-- {
			if v := sources.ParseSize(strings.TrimSpace(tds.Eq(i).Text())); v > 0 {
				size = v
				break
			}
		}
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
		quality := sources.DetectQuality(title)
		language := sources.DetectLanguage(title)
		id := sources.MagnetInfoHash(magnet)

		out = append(out, sources.Torrent{
			ID:        id,
			Title:     title,
			Size:      size,
			Seeders:   seeders,
			Leechers:  leechers,
			Quality:   quality,
			Source:    name,
			Magnet:    magnet,
			DetailURL: detailURL,
			Language:  language,
		})
	})
	return out
}

// FetchPoster fetches a rutor detail page and extracts a likely poster URL.
// Returns "" if no candidate is found or the request fails.
func (s *Source) FetchPoster(ctx context.Context, detailURL string) (string, error) {
	if detailURL == "" {
		return "", nil
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, detailURL, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("User-Agent", sources.UserAgent)
	resp, err := s.http.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("rutor detail http %d", resp.StatusCode)
	}
	doc, err := goquery.NewDocumentFromReader(resp.Body)
	if err != nil {
		return "", err
	}

	// Search descriptive area first.
	scopes := []*goquery.Selection{
		doc.Find("#index"),
		doc.Find(".index2"),
		doc.Find("table#details"),
		doc.Selection,
	}
	for _, sc := range scopes {
		if sc == nil || sc.Length() == 0 {
			continue
		}
		var found string
		sc.Find("img").EachWithBreak(func(_ int, img *goquery.Selection) bool {
			src, ok := img.Attr("src")
			if !ok {
				return true
			}
			src = strings.TrimSpace(src)
			if src == "" || strings.HasPrefix(src, "data:") {
				return true
			}
			low := strings.ToLower(src)
			// Skip tracker chrome, tiny icons, and known ad/placeholder hosts.
			if strings.Contains(low, "smile") || strings.Contains(low, "icon") ||
				strings.Contains(low, "logo") || strings.Contains(low, "rating") ||
				strings.Contains(low, "cdnbunny") || strings.Contains(low, "smartadserver") ||
				strings.Contains(low, "/ad/") || strings.Contains(low, "banner") ||
				strings.Contains(low, "/m.png") || strings.Contains(low, "spacer") ||
				strings.HasSuffix(low, ".gif") {
				return true
			}
			if strings.HasPrefix(src, "//") {
				src = "http:" + src
			} else if strings.HasPrefix(src, "/") {
				src = baseURL + src
			}
			found = src
			return false
		})
		if found != "" {
			return found, nil
		}
	}
	return "", nil
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
