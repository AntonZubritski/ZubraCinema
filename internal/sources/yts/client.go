package yts

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const baseURL = "https://yts.mx/api/v2/list_movies.json"

var trackers = []string{
	"udp://open.demonii.com:1337/announce",
	"udp://tracker.openbittorrent.com:80",
	"udp://tracker.coppersurfer.tk:6969",
	"udp://glotorrents.pw:6969/announce",
	"udp://tracker.opentrackr.org:1337/announce",
	"udp://torrent.gresille.org:80/announce",
	"udp://p4p.arenabg.com:1337",
	"udp://tracker.leechers-paradise.org:6969",
}

type Magnet struct {
	Quality string `json:"quality"`
	URL     string `json:"url"`
}

type Movie struct {
	Title    string   `json:"title"`
	Year     int      `json:"year"`
	Rating   float64  `json:"rating"`
	CoverURL string   `json:"coverUrl"`
	Magnets  []Magnet `json:"magnets"`
}

type Client struct {
	http *http.Client
}

func NewClient() *Client {
	return &Client{
		http: &http.Client{Timeout: 10 * time.Second},
	}
}

type ytsResponse struct {
	Data struct {
		Movies []ytsMovie `json:"movies"`
	} `json:"data"`
}

type ytsMovie struct {
	Title             string       `json:"title"`
	Year              int          `json:"year"`
	Rating            float64      `json:"rating"`
	LargeCoverImage   string       `json:"large_cover_image"`
	MediumCoverImage  string       `json:"medium_cover_image"`
	Torrents          []ytsTorrent `json:"torrents"`
}

type ytsTorrent struct {
	Hash    string `json:"hash"`
	Quality string `json:"quality"`
}

func (c *Client) Search(ctx context.Context, query string) ([]Movie, error) {
	q := url.Values{}
	q.Set("query_term", query)
	q.Set("limit", "20")
	q.Set("sort_by", "seeds")

	reqURL := baseURL + "?" + q.Encode()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, reqURL, nil)
	if err != nil {
		return nil, err
	}

	resp, err := c.http.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("yts: unexpected status %d", resp.StatusCode)
	}

	var parsed ytsResponse
	if err := json.NewDecoder(resp.Body).Decode(&parsed); err != nil {
		return nil, fmt.Errorf("yts: decode: %w", err)
	}

	movies := make([]Movie, 0, len(parsed.Data.Movies))
	for _, m := range parsed.Data.Movies {
		cover := m.LargeCoverImage
		if cover == "" {
			cover = m.MediumCoverImage
		}

		magnets := make([]Magnet, 0, len(m.Torrents))
		for _, t := range m.Torrents {
			if t.Hash == "" {
				continue
			}
			magnets = append(magnets, Magnet{
				Quality: t.Quality,
				URL:     buildMagnet(t.Hash, m.Title),
			})
		}

		movies = append(movies, Movie{
			Title:    m.Title,
			Year:     m.Year,
			Rating:   m.Rating,
			CoverURL: cover,
			Magnets:  magnets,
		})
	}
	return movies, nil
}

func buildMagnet(hash, title string) string {
	var b strings.Builder
	b.WriteString("magnet:?xt=urn:btih:")
	b.WriteString(hash)
	b.WriteString("&dn=")
	b.WriteString(url.QueryEscape(title))
	for _, tr := range trackers {
		b.WriteString("&tr=")
		b.WriteString(url.QueryEscape(tr))
	}
	return b.String()
}
