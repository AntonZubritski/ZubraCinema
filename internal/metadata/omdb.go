package metadata

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// Rating holds the IMDb-derived scores OMDb returns. Zero means "not present /
// unparseable" — callers should hide fields that are zero.
type Rating struct {
	ImdbRating     float64 // 0..10
	ImdbVotes      int
	Metascore      int
	RottenTomatoes int // 0..100, parsed from "92%"
}

// OMDbClient pulls ratings by IMDb id. Construct via NewOMDb; nil is a valid
// no-op value.
type OMDbClient struct {
	apiKey string
	http   *http.Client
}

// NewOMDb returns nil when apiKey is empty so callers can gate on Available()
// rather than nil-checking directly.
func NewOMDb(apiKey string) *OMDbClient {
	apiKey = strings.TrimSpace(apiKey)
	if apiKey == "" {
		return nil
	}
	return &OMDbClient{
		apiKey: apiKey,
		http:   &http.Client{Timeout: 10 * time.Second},
	}
}

// Available reports whether the client is configured. nil-safe.
func (c *OMDbClient) Available() bool { return c != nil && c.apiKey != "" }

// omdbResponse models the fields we care about from OMDb's JSON envelope.
type omdbResponse struct {
	Response   string `json:"Response"`   // "True" or "False"
	ImdbRating string `json:"imdbRating"` // "7.6" or "N/A"
	ImdbVotes  string `json:"imdbVotes"`  // "292,431" or "N/A"
	Metascore  string `json:"Metascore"`  // "36" or "N/A"
	Ratings    []struct {
		Source string `json:"Source"`
		Value  string `json:"Value"`
	} `json:"Ratings"`
}

// LookupByImdbID fetches ratings for the given IMDb id (e.g. "tt0814314").
// Returns ErrNotFound when OMDb says Response="False", on HTTP 404, or on a
// syntactically invalid imdbID.
func (c *OMDbClient) LookupByImdbID(ctx context.Context, imdbID string) (Rating, error) {
	if !c.Available() {
		return Rating{}, ErrNotFound
	}
	if !validImdbID(imdbID) {
		return Rating{}, ErrNotFound
	}

	u := fmt.Sprintf(
		"https://www.omdbapi.com/?i=%s&apikey=%s&tomatoes=true&plot=short",
		imdbID, c.apiKey,
	)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return Rating{}, err
	}
	req.Header.Set("Accept", "application/json")

	resp, err := c.http.Do(req)
	if err != nil {
		return Rating{}, err
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotFound {
		return Rating{}, ErrNotFound
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return Rating{}, fmt.Errorf("omdb http %d", resp.StatusCode)
	}

	var raw omdbResponse
	if err := json.NewDecoder(resp.Body).Decode(&raw); err != nil {
		return Rating{}, err
	}
	if raw.Response != "True" {
		return Rating{}, ErrNotFound
	}

	return parseRating(raw), nil
}

// parseRating converts the raw OMDb envelope to a Rating. All fields degrade
// gracefully to zero on parse failure (N/A, missing, malformed).
func parseRating(raw omdbResponse) Rating {
	r := Rating{}

	// "7.6" or "N/A"
	if f, err := strconv.ParseFloat(raw.ImdbRating, 64); err == nil {
		r.ImdbRating = f
	}

	// "292,431" — strip commas before parsing
	if raw.ImdbVotes != "" && raw.ImdbVotes != "N/A" {
		if n, err := strconv.Atoi(strings.ReplaceAll(raw.ImdbVotes, ",", "")); err == nil {
			r.ImdbVotes = n
		}
	}

	// "36" or "N/A"
	if n, err := strconv.Atoi(raw.Metascore); err == nil {
		r.Metascore = n
	}

	// Scan Ratings array for the RT entry; strip trailing "%"
	for _, entry := range raw.Ratings {
		if entry.Source == "Rotten Tomatoes" {
			pct := strings.TrimSuffix(entry.Value, "%")
			if n, err := strconv.Atoi(pct); err == nil {
				r.RottenTomatoes = n
			}
			break
		}
	}

	return r
}

// validImdbID checks for the "tt" prefix followed by at least one digit.
// We do this without regexp to avoid an extra import.
func validImdbID(id string) bool {
	if !strings.HasPrefix(id, "tt") {
		return false
	}
	rest := id[2:]
	if len(rest) == 0 {
		return false
	}
	for _, ch := range rest {
		if ch < '0' || ch > '9' {
			return false
		}
	}
	return true
}
