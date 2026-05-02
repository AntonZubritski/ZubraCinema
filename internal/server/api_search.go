package server

import (
	"errors"
	"log"
	"net/http"
	"strings"

	"github.com/AntonZubritski/ZubraCinema/internal/metadata/tmdb"
)

func handleTMDBSearch(client *tmdb.Client) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		q := strings.TrimSpace(r.URL.Query().Get("q"))
		if q == "" {
			writeJSON(w, http.StatusOK, []tmdb.Movie{})
			return
		}
		if client == nil || !client.Configured() {
			writeError(w, http.StatusServiceUnavailable, "TMDB_API_KEY not configured")
			return
		}
		movies, err := client.Search(r.Context(), q)
		if err != nil {
			if errors.Is(err, tmdb.ErrNotConfigured) {
				writeError(w, http.StatusServiceUnavailable, "TMDB_API_KEY not configured")
				return
			}
			log.Printf("tmdb search error: %v", err)
			http.Error(w, "search failed", http.StatusBadGateway)
			return
		}
		writeJSON(w, http.StatusOK, movies)
	}
}
