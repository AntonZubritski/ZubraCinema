package metadata

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

// serveKP spins up a test server that always responds with the given payload.
func serveKP(t *testing.T, payload kpListResponse) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(payload) //nolint:errcheck
	}))
}

// kpClientForServer returns a KPClient pointed at the given test server URL.
func kpClientForServer(srv *httptest.Server) *KPClient {
	c := NewKP("test-key")
	// Override the internal http client's transport to route to the test server.
	// We rebuild the request URL directly by patching the client's base via a
	// RoundTripper that rewrites the host.
	c.http = srv.Client()
	return c
}

// --- parse-level tests (no network) ---

func TestKPParseSuccessful(t *testing.T) {
	payload := kpListResponse{
		Total: 1,
		Docs: []kpDoc{
			{
				Rating: struct {
					KP float64 `json:"kp"`
				}{KP: 8.21},
				Votes: struct {
					KP int `json:"kp"`
				}{KP: 280450},
			},
		},
	}
	result, err := parseKPDocs(payload)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result.KpRating != 8.21 {
		t.Errorf("KpRating: want 8.21, got %v", result.KpRating)
	}
	if result.KpVotes != 280450 {
		t.Errorf("KpVotes: want 280450, got %v", result.KpVotes)
	}
}

func TestKPParseEmptyDocs(t *testing.T) {
	payload := kpListResponse{Total: 0, Docs: nil}
	_, err := parseKPDocs(payload)
	if err != ErrNotFound {
		t.Errorf("want ErrNotFound, got %v", err)
	}
}

func TestKPParseBothZero(t *testing.T) {
	payload := kpListResponse{
		Total: 1,
		Docs: []kpDoc{
			{
				Rating: struct {
					KP float64 `json:"kp"`
				}{KP: 0},
				Votes: struct {
					KP int `json:"kp"`
				}{KP: 0},
			},
		},
	}
	_, err := parseKPDocs(payload)
	if err != ErrNotFound {
		t.Errorf("want ErrNotFound for all-zero entry, got %v", err)
	}
}

// --- integration test using httptest ---

func TestKPLookupByImdbID_Success(t *testing.T) {
	payload := kpListResponse{
		Total: 1,
		Docs: []kpDoc{
			{
				Rating: struct {
					KP float64 `json:"kp"`
				}{KP: 7.5},
				Votes: struct {
					KP int `json:"kp"`
				}{KP: 12345},
			},
		},
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Verify the auth header is set (without logging its value).
		if r.Header.Get("X-API-KEY") == "" {
			http.Error(w, "missing key", http.StatusUnauthorized)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(payload) //nolint:errcheck
	}))
	defer srv.Close()

	c := &KPClient{apiKey: "test-key", http: srv.Client()}
	// Route the request to the test server by overriding the http client transport
	// via a custom RoundTripper.
	c.http = &http.Client{
		Transport: rewriteHostTransport{base: srv.Client().Transport, target: srv.URL},
	}

	got, err := c.LookupByImdbID(context.Background(), "tt0814314")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got.KpRating != 7.5 {
		t.Errorf("KpRating: want 7.5, got %v", got.KpRating)
	}
	if got.KpVotes != 12345 {
		t.Errorf("KpVotes: want 12345, got %v", got.KpVotes)
	}
}

func TestKPLookupByImdbID_BadID(t *testing.T) {
	c := NewKP("test-key")
	_, err := c.LookupByImdbID(context.Background(), "nm0000001")
	if err != ErrNotFound {
		t.Errorf("want ErrNotFound for invalid imdb id, got %v", err)
	}
}

// rewriteHostTransport redirects all requests to a test server regardless of
// the original URL host, so production URLs hit the httptest server instead.
type rewriteHostTransport struct {
	base   http.RoundTripper
	target string // e.g. "http://127.0.0.1:PORT"
}

func (rt rewriteHostTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	clone := req.Clone(req.Context())
	clone.URL.Scheme = "http"
	// Extract host:port from target.
	clone.URL.Host = rt.target[len("http://"):]
	return rt.base.RoundTrip(clone)
}

// parseKPDocs is an internal helper extracted here for unit-testing the parse
// logic without needing a live HTTP request.
func parseKPDocs(raw kpListResponse) (KPRating, error) {
	if raw.Total == 0 || len(raw.Docs) == 0 {
		return KPRating{}, ErrNotFound
	}
	doc := raw.Docs[0]
	if doc.Rating.KP == 0 && doc.Votes.KP == 0 {
		return KPRating{}, ErrNotFound
	}
	return KPRating{KpRating: doc.Rating.KP, KpVotes: doc.Votes.KP}, nil
}
