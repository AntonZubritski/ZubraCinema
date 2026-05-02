package server

import (
	"errors"
	"log"
	"net/http"
	"strconv"
	"strings"

	"github.com/AntonZubritski/ZubraCinema/internal/metadata/tmdb"
	"github.com/AntonZubritski/ZubraCinema/internal/sources"
)

func handleMovieDetail(client *tmdb.Client) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		idStr := r.PathValue("tmdbId")
		id, err := strconv.ParseInt(idStr, 10, 64)
		if err != nil {
			http.Error(w, "bad tmdb id", http.StatusBadRequest)
			return
		}
		if client == nil || !client.Configured() {
			writeError(w, http.StatusServiceUnavailable, "TMDB_API_KEY not configured")
			return
		}
		m, err := client.Get(r.Context(), id)
		if err != nil {
			if errors.Is(err, tmdb.ErrNotFound) {
				http.NotFound(w, r)
				return
			}
			if errors.Is(err, tmdb.ErrNotConfigured) {
				writeError(w, http.StatusServiceUnavailable, "TMDB_API_KEY not configured")
				return
			}
			log.Printf("tmdb get error: %v", err)
			http.Error(w, "tmdb fetch failed", http.StatusBadGateway)
			return
		}
		writeJSON(w, http.StatusOK, m)
	}
}

func handleMovieTorrents(client *tmdb.Client, agg *sources.Aggregator) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		idStr := r.PathValue("tmdbId")
		id, err := strconv.ParseInt(idStr, 10, 64)
		if err != nil {
			http.Error(w, "bad tmdb id", http.StatusBadRequest)
			return
		}
		if client == nil || !client.Configured() {
			writeError(w, http.StatusServiceUnavailable, "TMDB_API_KEY not configured")
			return
		}
		m, err := client.Get(r.Context(), id)
		if err != nil {
			if errors.Is(err, tmdb.ErrNotFound) {
				http.NotFound(w, r)
				return
			}
			log.Printf("tmdb get error: %v", err)
			http.Error(w, "tmdb fetch failed", http.StatusBadGateway)
			return
		}
		queries := buildQueries(m)
		merged := make(map[string]sources.Torrent)
		for _, q := range queries {
			res := agg.Search(r.Context(), q)
			for _, t := range res {
				if existing, ok := merged[t.ID]; ok {
					if t.Seeders > existing.Seeders {
						merged[t.ID] = t
					}
					continue
				}
				merged[t.ID] = t
			}
			if len(merged) >= 30 {
				break
			}
		}
		out := make([]sources.Torrent, 0, len(merged))
		for _, t := range merged {
			out = append(out, t)
		}
		// Sort by seeders desc
		for i := 1; i < len(out); i++ {
			for j := i; j > 0 && out[j].Seeders > out[j-1].Seeders; j-- {
				out[j], out[j-1] = out[j-1], out[j]
			}
		}
		if len(out) > 30 {
			out = out[:30]
		}
		writeJSON(w, http.StatusOK, out)
	}
}

func buildQueries(m *tmdb.Movie) []string {
	seen := make(map[string]bool)
	var out []string
	add := func(s string) {
		s = strings.TrimSpace(s)
		if s == "" || seen[s] {
			return
		}
		seen[s] = true
		out = append(out, s)
	}
	year := ""
	if m.Year != nil {
		year = " " + strconv.Itoa(*m.Year)
	}
	add(m.Title + year)
	add(m.OriginalTitle + year)
	add(m.Title)
	add(m.OriginalTitle)
	return out
}
