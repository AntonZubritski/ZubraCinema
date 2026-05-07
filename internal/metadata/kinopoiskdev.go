package metadata

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// KPRating holds КиноПоиск scores returned by the kinopoisk.dev API.
// Zero values mean "unknown / not yet rated" — callers should hide the column.
type KPRating struct {
	KpRating float64 // 0..10, kinopoisk.ru's own rating
	KpVotes  int     // total ratings count on kinopoisk.ru
}

// KPClient pulls КиноПоиск ratings by IMDb id via the kinopoisk.dev API.
// Construct via NewKP; nil is a valid no-op value.
type KPClient struct {
	apiKey string
	http   *http.Client
}

// NewKP returns nil when apiKey is empty so callers can gate on Available()
// rather than nil-checking directly.
func NewKP(apiKey string) *KPClient {
	apiKey = strings.TrimSpace(apiKey)
	if apiKey == "" {
		return nil
	}
	return &KPClient{
		apiKey: apiKey,
		http:   &http.Client{Timeout: 10 * time.Second},
	}
}

// Available reports whether the client is configured. nil-safe.
func (c *KPClient) Available() bool { return c != nil && c.apiKey != "" }

// kpListResponse models the paginated envelope returned by
// GET /v1.4/movie?externalId.imdb=...
type kpListResponse struct {
	Docs  []kpDoc `json:"docs"`
	Total int     `json:"total"`
}

type kpDoc struct {
	Rating struct {
		KP float64 `json:"kp"`
	} `json:"rating"`
	Votes struct {
		KP int `json:"kp"`
	} `json:"votes"`
}

// LookupByImdbID fetches the КиноПоиск rating for the given IMDb id
// (e.g. "tt0814314"). Returns ErrNotFound when the movie is not in the
// kinopoisk.dev catalogue, on HTTP 401/403, or on bad input.
func (c *KPClient) LookupByImdbID(ctx context.Context, imdbID string) (KPRating, error) {
	if !c.Available() {
		return KPRating{}, ErrNotFound
	}
	if !validImdbID(imdbID) {
		return KPRating{}, ErrNotFound
	}

	q := url.Values{}
	// The dot in "externalId.imdb" is the API's own query-parameter convention.
	q.Set("externalId.imdb", imdbID)

	req, err := http.NewRequestWithContext(
		ctx,
		http.MethodGet,
		"https://api.kinopoisk.dev/v1.4/movie?"+q.Encode(),
		nil,
	)
	if err != nil {
		return KPRating{}, err
	}
	// kinopoisk.dev uses a custom header, not Authorization.
	req.Header.Set("X-API-KEY", c.apiKey)
	req.Header.Set("Accept", "application/json")

	resp, err := c.http.Do(req)
	if err != nil {
		return KPRating{}, err
	}
	defer resp.Body.Close()

	// Treat auth failures the same as "not found" so the caller can simply
	// hide the KP column rather than surface a user-facing error.
	if resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden {
		return KPRating{}, ErrNotFound
	}
	if resp.StatusCode == http.StatusNotFound {
		return KPRating{}, ErrNotFound
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return KPRating{}, fmt.Errorf("kinopoisk.dev http %d", resp.StatusCode)
	}

	var raw kpListResponse
	if err := json.NewDecoder(resp.Body).Decode(&raw); err != nil {
		return KPRating{}, err
	}

	if raw.Total == 0 || len(raw.Docs) == 0 {
		return KPRating{}, ErrNotFound
	}

	doc := raw.Docs[0]
	kpRating := doc.Rating.KP
	kpVotes := doc.Votes.KP

	// No useful data — API returned a stub entry without any ratings yet.
	if kpRating == 0 && kpVotes == 0 {
		return KPRating{}, ErrNotFound
	}

	return KPRating{
		KpRating: kpRating,
		KpVotes:  kpVotes,
	}, nil
}
