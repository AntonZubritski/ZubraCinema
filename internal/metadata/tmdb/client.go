package tmdb

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"time"
)

const (
	apiBase     = "https://api.themoviedb.org/3"
	posterBase  = "https://image.tmdb.org/t/p/w500"
	backdrBase  = "https://image.tmdb.org/t/p/w780"
	defaultLang = "en-US"
)

var ErrNotConfigured = errors.New("TMDB_API_KEY not configured")
var ErrNotFound = errors.New("not found")

type Client struct {
	apiKey string
	http   *http.Client
}

func NewClient(apiKey string) *Client {
	return &Client{
		apiKey: apiKey,
		http:   &http.Client{Timeout: 10 * time.Second},
	}
}

func (c *Client) Configured() bool {
	return c != nil && c.apiKey != ""
}

type rawSearchResp struct {
	Results []rawMovie `json:"results"`
}

type rawMovie struct {
	ID            int64   `json:"id"`
	Title         string  `json:"title"`
	OriginalTitle string  `json:"original_title"`
	ReleaseDate   string  `json:"release_date"`
	VoteAverage   float64 `json:"vote_average"`
	PosterPath    string  `json:"poster_path"`
	BackdropPath  string  `json:"backdrop_path"`
	Overview      string  `json:"overview"`
}

type rawDetail struct {
	rawMovie
	Runtime *int `json:"runtime"`
	Genres  []struct {
		Name string `json:"name"`
	} `json:"genres"`
}

func (c *Client) Search(ctx context.Context, query string) ([]Movie, error) {
	if !c.Configured() {
		return nil, ErrNotConfigured
	}
	u, _ := url.Parse(apiBase + "/search/movie")
	q := u.Query()
	q.Set("api_key", c.apiKey)
	q.Set("query", query)
	q.Set("include_adult", "false")
	q.Set("language", defaultLang)
	u.RawQuery = q.Encode()

	var resp rawSearchResp
	if err := c.do(ctx, u.String(), &resp); err != nil {
		return nil, err
	}
	out := make([]Movie, 0, len(resp.Results))
	for _, r := range resp.Results {
		out = append(out, toMovie(r, nil, nil))
	}
	return out, nil
}

func (c *Client) Get(ctx context.Context, tmdbID int64) (*Movie, error) {
	if !c.Configured() {
		return nil, ErrNotConfigured
	}
	u, _ := url.Parse(apiBase + "/movie/" + strconv.FormatInt(tmdbID, 10))
	q := u.Query()
	q.Set("api_key", c.apiKey)
	q.Set("language", defaultLang)
	u.RawQuery = q.Encode()

	var d rawDetail
	if err := c.do(ctx, u.String(), &d); err != nil {
		return nil, err
	}
	if d.ID == 0 {
		return nil, ErrNotFound
	}
	genres := make([]string, 0, len(d.Genres))
	for _, g := range d.Genres {
		genres = append(genres, g.Name)
	}
	m := toMovie(d.rawMovie, d.Runtime, genres)
	return &m, nil
}

func (c *Client) do(ctx context.Context, urlStr string, out any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, urlStr, nil)
	if err != nil {
		return err
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusNotFound {
		return ErrNotFound
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("tmdb http %d", resp.StatusCode)
	}
	return json.NewDecoder(resp.Body).Decode(out)
}

func toMovie(r rawMovie, runtime *int, genres []string) Movie {
	var year *int
	if len(r.ReleaseDate) >= 4 {
		if y, err := strconv.Atoi(r.ReleaseDate[:4]); err == nil {
			year = &y
		}
	}
	var poster string
	if r.PosterPath != "" {
		poster = posterBase + r.PosterPath
	}
	var backdrop *string
	if r.BackdropPath != "" {
		s := backdrBase + r.BackdropPath
		backdrop = &s
	}
	return Movie{
		TmdbID:        r.ID,
		Title:         r.Title,
		OriginalTitle: r.OriginalTitle,
		Year:          year,
		Rating:        r.VoteAverage,
		PosterURL:     poster,
		BackdropURL:   backdrop,
		Overview:      r.Overview,
		Runtime:       runtime,
		Genres:        genres,
	}
}
