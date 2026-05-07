package server

import (
	"context"
	"errors"
	"log"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/AntonZubritski/ZubraCinema/internal/metadata"
)

// metadataCache is a process-lifetime in-memory cache keyed by
// "<lower(title)>|<year>". Metadata is essentially static for a session
// and re-querying on every page open would burn through the modest free
// rate limits across all three upstream APIs (TMDB, OMDb, kinopoisk.dev).
var metadataCache sync.Map

// movieResponse is the wire shape served by /api/metadata. Embeds the TMDB
// `Metadata` so its fields inline in the JSON, then bolts on IMDb (OMDb)
// and КиноПоиск (kinopoisk.dev) ratings on top.
type movieResponse struct {
	metadata.Metadata
	ImdbRating float64 `json:"imdbRating"`
	ImdbVotes  int     `json:"imdbVotes"`
	KpRating   float64 `json:"kpRating"`
	KpVotes    int     `json:"kpVotes"`
}

// handleMetadata serves GET /api/metadata?title=X&year=N.
//
// Pipeline:
//  1. TMDB resolves (title,year) → ImdbID + base metadata.
//  2. If IMDb id is known, fan out to OMDb (IMDb rating) and kinopoisk.dev
//     (KP rating) in parallel. Either upstream failing degrades the
//     respective field to zero — the frontend hides zero-rating chips.
//
// Returns 503 only when TMDB itself is disabled. Missing OMDb/KP keys are
// fine — those clients just refuse the call and we send zero ratings.
func handleMetadata(tmdb *metadata.Client, omdb *metadata.OMDbClient, kp *metadata.KPClient) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		title := strings.TrimSpace(r.URL.Query().Get("title"))
		if title == "" {
			writeError(w, http.StatusBadRequest, "title is required")
			return
		}
		year, _ := strconv.Atoi(strings.TrimSpace(r.URL.Query().Get("year")))

		if !tmdb.Available() {
			writeError(w, http.StatusServiceUnavailable, "TMDB_API_KEY not configured")
			return
		}

		key := strings.ToLower(title) + "|" + strconv.Itoa(year)
		if cached, ok := metadataCache.Load(key); ok {
			writeJSON(w, http.StatusOK, cached.(movieResponse))
			return
		}

		ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
		defer cancel()

		md, err := tmdb.Lookup(ctx, title, year)
		if err != nil {
			if errors.Is(err, metadata.ErrNotFound) {
				writeError(w, http.StatusNotFound, "not found")
				return
			}
			log.Printf("tmdb lookup %q (%d): %v", title, year, err)
			writeError(w, http.StatusBadGateway, "upstream: "+err.Error())
			return
		}

		resp := movieResponse{Metadata: md}

		// Parallel fan-out for the rating sources. Both are best-effort —
		// any failure leaves the corresponding fields at zero, which the
		// frontend treats as "hide the column".
		if md.ImdbID != "" {
			var wg sync.WaitGroup
			if omdb.Available() {
				wg.Add(1)
				go func() {
					defer wg.Done()
					rating, err := omdb.LookupByImdbID(ctx, md.ImdbID)
					if err != nil {
						if !errors.Is(err, metadata.ErrNotFound) {
							log.Printf("omdb lookup %s: %v", md.ImdbID, err)
						}
						return
					}
					resp.ImdbRating = rating.ImdbRating
					resp.ImdbVotes = rating.ImdbVotes
				}()
			}
			if kp.Available() {
				wg.Add(1)
				go func() {
					defer wg.Done()
					rating, err := kp.LookupByImdbID(ctx, md.ImdbID)
					if err != nil {
						if !errors.Is(err, metadata.ErrNotFound) {
							log.Printf("kinopoisk.dev lookup %s: %v", md.ImdbID, err)
						}
						return
					}
					resp.KpRating = rating.KpRating
					resp.KpVotes = rating.KpVotes
				}()
			}
			wg.Wait()
		}

		metadataCache.Store(key, resp)
		writeJSON(w, http.StatusOK, resp)
	}
}
