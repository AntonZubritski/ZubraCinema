// Package metadata wraps the TMDB v3 REST API to enrich torrent search hits
// with localized titles, overviews, posters, runtime, ratings, and trailer
// links. We only consume the public "free" endpoints (search/movie and
// movie/{id}) which require nothing more than an API key.
//
// Feature gating: New("") returns nil so callers can do `if c.Available()`
// without a separate `if c == nil` check. All exported methods on *Client
// are nil-safe in that sense.
package metadata

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"
)

// Metadata is the trimmed-down view of a TMDB movie record we expose to the
// frontend. Field names match the JSON the API serves.
type Metadata struct {
	Title       string   `json:"title"`
	Overview    string   `json:"overview"`    // RU preferred, falls back to EN
	Genres      []string `json:"genres"`
	RuntimeMin  int      `json:"runtimeMin"`
	VoteAverage float64  `json:"voteAverage"`
	Year        int      `json:"year"`
	PosterURL   string   `json:"posterUrl"`
	BackdropURL string   `json:"backdropUrl"`
	TrailerKey  string   `json:"trailerKey"` // YouTube video id; "" if none
	TmdbID      int      `json:"tmdbId"`
	Tagline     string   `json:"tagline"`    // RU preferred, EN fallback, "" if missing
	Status      string   `json:"status"`     // "Released", "In Production", etc.
	Countries   []string `json:"countries"`  // production_countries names
	Budget      int      `json:"budget"`     // 0 if unknown
	AgeRating   string   `json:"ageRating"`  // best cert from release_dates
	ImdbID      string   `json:"imdbId"`     // "tt..." or ""
	Cast        []Person `json:"cast"`       // top-15 by order
}

// Person is a single cast member.
type Person struct {
	Name      string `json:"name"`
	Character string `json:"character"`
	PhotoURL  string `json:"photoUrl"` // "" if no profile photo
}

// ErrNotFound is returned by Lookup when TMDB has nothing plausible for the
// requested (title, year). Callers should map this to HTTP 404.
var ErrNotFound = errors.New("metadata: not found")

const (
	apiBase      = "https://api.themoviedb.org/3"
	imgPosterURL = "https://image.tmdb.org/t/p/w500"
	imgBackdrop  = "https://image.tmdb.org/t/p/original"
	imgProfile   = "https://image.tmdb.org/t/p/w185"
)

// Client wraps an http.Client + TMDB API key. The zero value is not usable —
// construct via New().
type Client struct {
	apiKey string
	http   *http.Client
}

// New returns nil if apiKey is empty so callers can early-bail without
// nil-checking everywhere ("if c == nil ..."). Empty key = TMDB disabled.
func New(apiKey string) *Client {
	apiKey = strings.TrimSpace(apiKey)
	if apiKey == "" {
		return nil
	}
	return &Client{
		apiKey: apiKey,
		http:   &http.Client{Timeout: 15 * time.Second},
	}
}

// Available reports whether the client has a key. nil-safe.
func (c *Client) Available() bool { return c != nil && c.apiKey != "" }

// searchResponse models only the fields we read from /search/movie.
type searchResponse struct {
	Results []struct {
		ID          int    `json:"id"`
		Title       string `json:"title"`
		ReleaseDate string `json:"release_date"`
		VoteCount   int    `json:"vote_count"`
	} `json:"results"`
}

// detailResponse models only the fields we read from /movie/{id}.
type detailResponse struct {
	ID           int     `json:"id"`
	Title        string  `json:"title"`
	Overview     string  `json:"overview"`
	Tagline      string  `json:"tagline"`
	Status       string  `json:"status"`
	Budget       int     `json:"budget"`
	ReleaseDate  string  `json:"release_date"`
	Runtime      int     `json:"runtime"`
	VoteAverage  float64 `json:"vote_average"`
	PosterPath   string  `json:"poster_path"`
	BackdropPath string  `json:"backdrop_path"`
	Genres       []struct {
		Name string `json:"name"`
	} `json:"genres"`
	ProductionCountries []struct {
		Name string `json:"name"`
	} `json:"production_countries"`
	Videos struct {
		Results []struct {
			Site     string `json:"site"`
			Type     string `json:"type"`
			Key      string `json:"key"`
			Official bool   `json:"official"`
		} `json:"results"`
	} `json:"videos"`
	Credits struct {
		Cast []struct {
			Name        string `json:"name"`
			Character   string `json:"character"`
			ProfilePath string `json:"profile_path"`
			Order       int    `json:"order"`
		} `json:"cast"`
	} `json:"credits"`
	ReleaseDates struct {
		Results []struct {
			Iso31661     string `json:"iso_3166_1"`
			ReleaseDates []struct {
				Certification string `json:"certification"`
			} `json:"release_dates"`
		} `json:"results"`
	} `json:"release_dates"`
	ExternalIDs struct {
		ImdbID string `json:"imdb_id"`
	} `json:"external_ids"`
}

// Lookup searches TMDB for (title, year) and fetches the matched detail
// page. Returns ErrNotFound when the search is empty or the top hit looks
// like a stale stub (no votes AND year mismatch).
func (c *Client) Lookup(ctx context.Context, title string, year int) (Metadata, error) {
	if !c.Available() {
		return Metadata{}, ErrNotFound
	}

	// Step 1: search.
	sq := url.Values{}
	sq.Set("api_key", c.apiKey)
	sq.Set("language", "ru-RU")
	sq.Set("query", title)
	if year > 0 {
		sq.Set("year", strconv.Itoa(year))
	}
	var sr searchResponse
	if err := c.getJSON(ctx, apiBase+"/search/movie?"+sq.Encode(), &sr); err != nil {
		return Metadata{}, err
	}
	if len(sr.Results) == 0 {
		return Metadata{}, ErrNotFound
	}
	top := sr.Results[0]
	// Reject obvious junk: zero votes AND a year that doesn't match the
	// caller's hint. A zero-vote hit with a matching year is still a useful
	// match (very fresh release).
	if top.VoteCount == 0 && year > 0 && parseYear(top.ReleaseDate) != year {
		return Metadata{}, ErrNotFound
	}

	// Step 2: detail (RU).
	d, err := c.fetchDetail(ctx, top.ID, "ru-RU")
	if err != nil {
		return Metadata{}, err
	}

	// Step 3: if RU overview (or tagline) is empty, retry once in EN. Capped
	// to 2 calls total per the spec.
	if strings.TrimSpace(d.Overview) == "" || strings.TrimSpace(d.Tagline) == "" {
		dEN, err := c.fetchDetail(ctx, top.ID, "en-US")
		if err == nil {
			if strings.TrimSpace(d.Overview) == "" {
				d.Overview = dEN.Overview
			}
			if strings.TrimSpace(d.Tagline) == "" {
				d.Tagline = dEN.Tagline
			}
		}
	}

	return buildMetadata(d, year), nil
}

// fetchDetail GETs /movie/{id} with the given language plus all sub-objects
// needed to build a full detail page. include_video_language widens the
// trailer search so we still get a YouTube key for RU pages where the only
// trailer is the EN one.
func (c *Client) fetchDetail(ctx context.Context, id int, language string) (detailResponse, error) {
	q := url.Values{}
	q.Set("api_key", c.apiKey)
	q.Set("language", language)
	q.Set("append_to_response", "videos,credits,release_dates,external_ids")
	q.Set("include_video_language", "ru,en,null")
	var d detailResponse
	if err := c.getJSON(ctx, fmt.Sprintf("%s/movie/%d?%s", apiBase, id, q.Encode()), &d); err != nil {
		return detailResponse{}, err
	}
	return d, nil
}

func (c *Client) getJSON(ctx context.Context, u string, into any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "application/json")
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
	return json.NewDecoder(resp.Body).Decode(into)
}

// buildMetadata projects a detailResponse onto our flat Metadata, filling in
// the year from the detail's release_date when present and falling back to
// the caller's hint when not.
func buildMetadata(d detailResponse, fallbackYear int) Metadata {
	m := Metadata{
		Title:       d.Title,
		Overview:    d.Overview,
		Tagline:     strings.TrimSpace(d.Tagline),
		Status:      d.Status,
		Budget:      d.Budget,
		RuntimeMin:  d.Runtime,
		VoteAverage: d.VoteAverage,
		Year:        fallbackYear,
		TmdbID:      d.ID,
		ImdbID:      d.ExternalIDs.ImdbID,
	}
	if y := parseYear(d.ReleaseDate); y > 0 {
		m.Year = y
	}
	for _, g := range d.Genres {
		if g.Name != "" {
			m.Genres = append(m.Genres, g.Name)
		}
	}
	for _, c := range d.ProductionCountries {
		if c.Name != "" {
			m.Countries = append(m.Countries, c.Name)
		}
	}
	if d.PosterPath != "" {
		m.PosterURL = imgPosterURL + d.PosterPath
	}
	if d.BackdropPath != "" {
		m.BackdropURL = imgBackdrop + d.BackdropPath
	}
	m.TrailerKey = pickTrailerKey(d.Videos.Results)
	m.AgeRating = pickAgeRating(d.ReleaseDates.Results)
	m.Cast = buildCast(d.Credits.Cast)
	return m
}

// pickAgeRating selects the best certification from release_dates results.
// Priority: RU → US → any other country's first non-empty cert.
func pickAgeRating(results []struct {
	Iso31661     string `json:"iso_3166_1"`
	ReleaseDates []struct {
		Certification string `json:"certification"`
	} `json:"release_dates"`
}) string {
	firstCert := func(entries []struct {
		Certification string `json:"certification"`
	}) string {
		for _, e := range entries {
			if e.Certification != "" {
				return e.Certification
			}
		}
		return ""
	}

	var fallback string
	for _, r := range results {
		cert := firstCert(r.ReleaseDates)
		if cert == "" {
			continue
		}
		switch r.Iso31661 {
		case "RU":
			return cert
		case "US":
			fallback = cert // keep looking for RU
		default:
			if fallback == "" {
				fallback = cert
			}
		}
	}
	return fallback
}

// buildCast sorts cast by order, takes top 15, and maps profile paths to URLs.
func buildCast(raw []struct {
	Name        string `json:"name"`
	Character   string `json:"character"`
	ProfilePath string `json:"profile_path"`
	Order       int    `json:"order"`
}) []Person {
	if len(raw) == 0 {
		return nil
	}
	sort.Slice(raw, func(i, j int) bool { return raw[i].Order < raw[j].Order })
	if len(raw) > 15 {
		raw = raw[:15]
	}
	cast := make([]Person, 0, len(raw))
	for _, r := range raw {
		p := Person{Name: r.Name, Character: r.Character}
		if r.ProfilePath != "" {
			p.PhotoURL = imgProfile + r.ProfilePath
		}
		cast = append(cast, p)
	}
	return cast
}

// pickTrailerKey scans video results for the best YouTube trailer match.
// First pass: official YouTube trailer. Second pass: any YouTube trailer.
// Returns "" when nothing matches.
func pickTrailerKey(vids []struct {
	Site     string `json:"site"`
	Type     string `json:"type"`
	Key      string `json:"key"`
	Official bool   `json:"official"`
}) string {
	for _, v := range vids {
		if v.Site == "YouTube" && v.Type == "Trailer" && v.Official && v.Key != "" {
			return v.Key
		}
	}
	for _, v := range vids {
		if v.Site == "YouTube" && v.Type == "Trailer" && v.Key != "" {
			return v.Key
		}
	}
	return ""
}

// parseYear extracts the year from a YYYY-MM-DD string. Returns 0 for any
// malformed/empty input — callers treat 0 as "unknown".
func parseYear(date string) int {
	if len(date) < 4 {
		return 0
	}
	y, err := strconv.Atoi(date[:4])
	if err != nil {
		return 0
	}
	return y
}
