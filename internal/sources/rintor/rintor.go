// Package rintor scrapes rintor.org — a phpBB-based RU adult-content
// torrent tracker. It's wired in as an optional source for ZubraCinema's
// 18+ section. The site responds with magnet links inline on each forum
// listing row, so listing → torrents is one HTTP round trip per page.
//
// We deliberately don't implement the Search() method beyond a stub for
// now; rintor's search is a POST form on each forum page (`nm` field) and
// returns only that forum's matches. The category-browse URLs already
// give us tag-style entry points, which is the primary v1 use case.
package rintor

import (
	"context"
	"errors"
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
	baseURL = "https://rintor.org"
	// rintor's phpBB template paginates at 50 topics per page (verified
	// against /viewforum.php?f=26&start=15 returning the next 50 rows).
	perPage = 50
)

type Source struct {
	http *http.Client
}

func New() *Source {
	return &Source{
		http: &http.Client{Timeout: 15 * time.Second},
	}
}

func (s *Source) Name() string { return "rintor" }

// Search is a stub — rintor's search is forum-scoped and returns its own
// listing format, but we don't currently surface 18+ results in the
// global /api/search aggregator. Returning (nil, nil) makes it a no-op
// when included in the aggregator.
func (s *Source) Search(_ context.Context, _ string) ([]sources.Torrent, error) {
	return nil, nil
}

// BrowseCategory fetches one page of a rintor forum (= category). forumID
// is the numeric `f` parameter on rintor's /viewforum.php URL (e.g. "26"
// = "HD Порнофильмы"). page is 0-indexed and maps to the `start=`
// query string via start = page * 50.
func (s *Source) BrowseCategory(ctx context.Context, forumID string, page int) ([]sources.Torrent, error) {
	if forumID == "" {
		return nil, errors.New("rintor: empty forumID")
	}
	if page < 0 {
		page = 0
	}
	start := page * perPage
	u := fmt.Sprintf("%s/viewforum.php?f=%s&start=%d", baseURL, url.QueryEscape(forumID), start)

	doc, err := s.fetchDoc(ctx, u)
	if err != nil {
		return nil, fmt.Errorf("rintor browse: %w", err)
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
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("status %d", resp.StatusCode)
	}
	return goquery.NewDocumentFromReader(resp.Body)
}

// parseRows extracts torrents from a rintor /viewforum.php response. Row
// structure (from a real-world page):
//
//	<tr id="tr-22353">
//	  <td>...icon...</td>
//	  <td class="tt">
//	    <div class="torTopic">
//	      <a href="./viewtopic.php?t=22353" class="torTopic tt-text"><b>TITLE</b></a>
//	    </div>
//	  </td>
//	  <td class="tCenter">
//	    <span class="seedmed"><b>0</b></span> | <span class="leechmed"><b>0</b></span>
//	    <a href="./dl.php?id=22567" class="small">4.27&nbsp;GB</a>
//	    <a href="magnet:?xt=urn:btih:..."><img ... /></a>
//	  </td>
//	</tr>
func parseRows(doc *goquery.Document) []sources.Torrent {
	var out []sources.Torrent
	doc.Find("tr[id^='tr-']").Each(func(_ int, row *goquery.Selection) {
		titleA := row.Find("a.torTopic.tt-text").First()
		title := strings.TrimSpace(titleA.Find("b").Text())
		if title == "" {
			title = strings.TrimSpace(titleA.Text())
		}
		if title == "" {
			return
		}

		magnet, _ := row.Find("a[href^='magnet:']").First().Attr("href")
		if magnet == "" {
			return
		}

		topicHref, _ := titleA.Attr("href")
		topicID := strings.TrimPrefix(topicHref, "./viewtopic.php?t=")
		topicID = strings.TrimPrefix(topicID, "viewtopic.php?t=")
		if topicID == "" {
			// Fall back to the row's id attribute (e.g. "tr-22353" → "22353")
			rowID, _ := row.Attr("id")
			topicID = strings.TrimPrefix(rowID, "tr-")
		}

		seedersStr := strings.TrimSpace(row.Find("span.seedmed b").First().Text())
		seeders, _ := strconv.Atoi(seedersStr)

		leechersStr := strings.TrimSpace(row.Find("span.leechmed b").First().Text())
		leechers, _ := strconv.Atoi(leechersStr)

		sizeText := strings.TrimSpace(row.Find("a[href^='./dl.php']").First().Text())
		if sizeText == "" {
			sizeText = strings.TrimSpace(row.Find("a[href^='dl.php']").First().Text())
		}
		size := parseSize(sizeText)

		detailURL := ""
		if topicID != "" {
			detailURL = fmt.Sprintf("%s/viewtopic.php?t=%s", baseURL, topicID)
		}

		out = append(out, sources.Torrent{
			ID:        topicID,
			Title:     title,
			Magnet:    magnet,
			Seeders:   seeders,
			Leechers:  leechers,
			Size:      size,
			Source:    "rintor",
			Quality:   sources.DetectQuality(title),
			Language:  sources.DetectLanguage(title),
			DetailURL: detailURL,
		})
	})
	return out
}

// FetchPoster scrapes the topic page for the first non-thumbnail content
// image. Rintor lazy-loads images via `<var class="postImg" title="URL">`,
// where the URL points at an external image-hosting service (shotcan.com,
// pilot007.org, etc.). We can hand it back as-is — TMDB image CDNs aren't
// involved. Returns "" with no error when no usable poster is found.
func (s *Source) FetchPoster(ctx context.Context, detailURL string) (string, error) {
	if detailURL == "" {
		return "", nil
	}
	doc, err := s.fetchDoc(ctx, detailURL)
	if err != nil {
		return "", fmt.Errorf("rintor poster: %w", err)
	}

	var firstAny, firstNonThumb string
	doc.Find("var.postImg[title]").EachWithBreak(func(_ int, v *goquery.Selection) bool {
		raw, ok := v.Attr("title")
		if !ok {
			return true
		}
		u := strings.TrimSpace(raw)
		if u == "" {
			return true
		}
		if firstAny == "" {
			firstAny = u
		}
		if !strings.Contains(strings.ToLower(u), ".th.") {
			firstNonThumb = u
			return false
		}
		return true
	})

	if firstNonThumb != "" {
		return firstNonThumb, nil
	}
	return firstAny, nil
}

// parseSize handles rintor's "4.27 GB" / "456.7 MB" / "1.2 TB" format,
// including the &nbsp;-separated variants that show up in HTML.
func parseSize(s string) int64 {
	s = strings.ReplaceAll(s, " ", " ") // nbsp
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
