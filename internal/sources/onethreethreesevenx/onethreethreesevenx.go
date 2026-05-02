package onethreethreesevenx

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/PuerkitoBio/goquery"

	"github.com/AntonZubritski/ZubraCinema/internal/sources"
)

const (
	name    = "1337x"
	baseURL = "https://1337x.to"
	maxDetailFetches = 10
)

type Source struct {
	http *http.Client
}

func New() *Source {
	return &Source{http: &http.Client{Timeout: 10 * time.Second}}
}

func (s *Source) Name() string { return name }

func (s *Source) Search(ctx context.Context, query string) ([]sources.Torrent, error) {
	q := url.PathEscape(query)
	u := fmt.Sprintf("%s/sort-search/%s/seeders/desc/1/", baseURL, q)
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
		return nil, fmt.Errorf("1337x http %d", resp.StatusCode)
	}
	doc, err := goquery.NewDocumentFromReader(resp.Body)
	if err != nil {
		return nil, err
	}

	type listEntry struct {
		title    string
		detail   string
		size     int64
		seeders  int
		leechers int
	}
	var entries []listEntry

	doc.Find("table.table-list tbody tr").Each(func(_ int, tr *goquery.Selection) {
		nameLinks := tr.Find("td.name a")
		if nameLinks.Length() < 2 {
			return
		}
		titleA := nameLinks.Eq(1)
		title := strings.TrimSpace(titleA.Text())
		href, _ := titleA.Attr("href")
		if title == "" || href == "" {
			return
		}
		detail := href
		if strings.HasPrefix(detail, "/") {
			detail = baseURL + detail
		}
		seeders, _ := strconv.Atoi(strings.TrimSpace(tr.Find("td.seeds").Text()))
		leechers, _ := strconv.Atoi(strings.TrimSpace(tr.Find("td.leeches").Text()))
		sizeStr := strings.TrimSpace(tr.Find("td.size").Contents().First().Text())
		entries = append(entries, listEntry{
			title:    title,
			detail:   detail,
			size:     sources.ParseSize(sizeStr),
			seeders:  seeders,
			leechers: leechers,
		})
	})

	if len(entries) > maxDetailFetches {
		entries = entries[:maxDetailFetches]
	}

	out := make([]sources.Torrent, len(entries))
	var wg sync.WaitGroup
	for i := range entries {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			e := entries[i]
			magnet, err := s.fetchMagnet(ctx, e.detail)
			if err != nil || magnet == "" {
				return
			}
			out[i] = sources.Torrent{
				ID:       sources.MagnetInfoHash(magnet),
				Title:    e.title,
				Size:     e.size,
				Seeders:  e.seeders,
				Leechers: e.leechers,
				Quality:  sources.DetectQuality(e.title),
				Source:   name,
				Magnet:   magnet,
			}
		}(i)
	}
	wg.Wait()

	filtered := out[:0]
	for _, t := range out {
		if t.Magnet != "" {
			filtered = append(filtered, t)
		}
	}
	return filtered, nil
}

func (s *Source) fetchMagnet(ctx context.Context, detailURL string) (string, error) {
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
		return "", fmt.Errorf("1337x detail http %d", resp.StatusCode)
	}
	doc, err := goquery.NewDocumentFromReader(resp.Body)
	if err != nil {
		return "", err
	}
	var magnet string
	doc.Find("a").EachWithBreak(func(_ int, a *goquery.Selection) bool {
		href, _ := a.Attr("href")
		if strings.HasPrefix(href, "magnet:") {
			magnet = href
			return false
		}
		return true
	})
	return magnet, nil
}
