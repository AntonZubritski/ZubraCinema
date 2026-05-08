// Package porevotorrent scrapes porevotorrent.net — a custom-PHP adult
// torrent index. Wired in as an optional 18+ source. Listings expose
// title, thumbnail, size and a numeric topic ID per row, but no magnet
// URI or seeder count: the actual torrent file is hidden behind an
// ad-redirect CDN at cdncontent.top. We side-step the CDN's popup chain
// by going straight to the final endpoint
// (https://cdncontent.top/opentorrent/torrent.php?id=<ID>) which serves
// `application/x-bittorrent` directly. The Manager's AddTorrentFileURL
// path takes care of decoding the .torrent and synthesising a magnet at
// playback time.
package porevotorrent

import (
	"context"
	"errors"
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

const (
	baseURL = "https://porevotorrent.net"
	// cdnURLFmt produces the direct .torrent endpoint that bypasses the
	// ad/popup interstitial. Verified to return Content-Type:
	// application/x-bittorrent with Content-Disposition: attachment.
	cdnURLFmt = "https://cdncontent.top/opentorrent/torrent.php?id=%s"
)

type Source struct {
	http *http.Client
}

func New() *Source {
	return &Source{
		http: &http.Client{Timeout: 15 * time.Second},
	}
}

func (s *Source) Name() string { return "porevotorrent" }

// Search is a stub. porevotorrent's search is its own endpoint with
// noisy results; we don't surface it in the global aggregator. Returning
// (nil, nil) keeps the sources.Source interface satisfied.
func (s *Source) Search(_ context.Context, _ string) ([]sources.Torrent, error) {
	return nil, nil
}

// BrowseCategory fetches one page of a porevotorrent tag listing. tag is
// the URL segment used in /tags/<tag>/ paths (e.g. "1080p", "Russian",
// "Anal", "2160p"). page is 0-indexed; page 0 → /tags/<tag>/, page N>0 →
// /tags/<tag>/page/<N+1>/. Returns parsed torrents with TorrentFileURL
// populated and Magnet empty.
func (s *Source) BrowseCategory(ctx context.Context, tag string, page int) ([]sources.Torrent, error) {
	if tag == "" {
		return nil, errors.New("porevotorrent: empty tag")
	}
	if page < 0 {
		page = 0
	}
	listURL := fmt.Sprintf("%s/tags/%s/", baseURL, tag)
	if page > 0 {
		// porevotorrent's pagination is human-1-indexed, hence the +1.
		listURL = fmt.Sprintf("%s/tags/%s/page/%d/", baseURL, tag, page+1)
	}
	doc, err := s.fetchDoc(ctx, listURL)
	if err != nil {
		return nil, fmt.Errorf("porevotorrent browse: %w", err)
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

// detailIDRe extracts the numeric topic id from a porevotorrent detail
// URL like "https://porevotorrent.net/3281572-top.html".
var detailIDRe = regexp.MustCompile(`/(\d{4,})-[^/]*\.html`)

// yearRe pulls a 4-digit release year out of porevotorrent titles. Most
// titles include "[2026 г., ...]" or "(07.05.2026)" near the end.
var yearRe = regexp.MustCompile(`\b(19\d{2}|20\d{2})\b`)

// parseRows walks every <table class="box"> on the page. The container
// for one torrent looks like:
//
//	<table class="box">
//	  <tr><td><table class="box_head">
//	    <tr><td class="box_hl"></td><td class="box_hc">521.7 MB</td><td class="box_hr"></td></tr>
//	  </table></td></tr>
//	  <tr><td class="box_pic">
//	    <a href="https://porevotorrent.net/3281655-top.html">
//	      <img src="//i127.fastpic.org/.../70.jpg" />
//	    </a>
//	  </td></tr>
//	  <tr><td><b>[PornHub.com] Title ...</b></td></tr>
//	</table>
func parseRows(doc *goquery.Document) []sources.Torrent {
	var out []sources.Torrent
	doc.Find("table.box").Each(func(_ int, box *goquery.Selection) {
		// Detail URL + ID — the only stable per-torrent identifier we get.
		// Without an ID we can't synthesise the cdncontent URL, so skip.
		detailHref, _ := box.Find("td.box_pic a[href]").First().Attr("href")
		if detailHref == "" {
			return
		}
		m := detailIDRe.FindStringSubmatch(detailHref)
		if len(m) < 2 {
			return
		}
		id := m[1]

		// Title lives in the last row's <b>, but a few entries use the
		// row's plain text (no <b>) — fall back accordingly.
		title := strings.TrimSpace(box.Find("b").First().Text())
		if title == "" {
			title = strings.TrimSpace(box.Find("tr").Last().Text())
		}
		if title == "" {
			return
		}

		// Thumbnail. "//host/path" (protocol-relative) → upgrade to https.
		thumb, _ := box.Find("td.box_pic a img").First().Attr("src")
		thumb = strings.TrimSpace(thumb)
		if strings.HasPrefix(thumb, "//") {
			thumb = "https:" + thumb
		}

		size := parseSize(strings.TrimSpace(box.Find("td.box_hc").First().Text()))

		// Synthesised .torrent URL. The site itself wraps this in two
		// ad-popup hops via cdncontent.top/opentorrent/d.php → dd.php →
		// torrent.php; we skip straight to torrent.php which works
		// without referrer/cookies and serves the .torrent directly.
		torrentURL := fmt.Sprintf(cdnURLFmt, id)

		// Detail URL — used by the API layer for poster enrichment if
		// we ever want to scrape larger backdrops from the topic page;
		// listing thumbnail is already populated via PosterURL so this
		// is currently informational only.
		detail := detailHref
		if !strings.HasPrefix(detail, "http") {
			detail = baseURL + ensureLeadingSlash(detailHref)
		}

		out = append(out, sources.Torrent{
			ID:             id,
			Title:          title,
			Size:           size,
			Source:         "porevotorrent",
			Quality:        sources.DetectQuality(title),
			Language:       sources.DetectLanguage(title),
			Magnet:         "",
			TorrentFileURL: torrentURL,
			DetailURL:      detail,
			PosterURL:      thumb,
		})
	})
	return out
}

func ensureLeadingSlash(s string) string {
	if strings.HasPrefix(s, "/") {
		return s
	}
	return "/" + s
}

// parseSize handles porevotorrent's "521.7 MB" / "3.61 GB" / "521.7&nbsp;MB"
// shapes. Returns 0 on anything unparseable rather than failing the whole
// listing — the size column is informational only.
func parseSize(s string) int64 {
	s = strings.ReplaceAll(s, " ", " ") // nbsp → ascii space
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

// EncodeTag is a small helper for callers that build URLs from arbitrary
// user-supplied tag strings. Currently unused but kept here so future
// search-by-tag entry points don't have to reinvent the encoding.
func EncodeTag(tag string) string { return url.PathEscape(tag) }
