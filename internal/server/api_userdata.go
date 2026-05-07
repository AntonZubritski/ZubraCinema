package server

import (
	"encoding/json"
	"log"
	"net/http"

	"github.com/AntonZubritski/ZubraCinema/internal/userdata"
)

// validReactions is the set of emoji strings accepted by the API layer.
// The store itself is permissive; validation lives here.
var validReactions = map[string]bool{
	"fire": true,
	"like": true,
	"meh":  true,
	"wow":  true,
	"poop": true,
	"":     true, // clear
}

// handleGetUserdataMovie serves GET /api/userdata/movie/{movieId}.
// Returns the aggregated per-movie user state: reaction, bookmark flag, and
// last watch position. All three are probed in separate queries but any one
// that is absent is represented as null in the JSON response.
func handleGetUserdataMovie(s *userdata.Store) http.HandlerFunc {
	type lastWatchedWire struct {
		AtSec int    `json:"atSec"`
		When  string `json:"when"`
	}
	type response struct {
		MyReaction  *string          `json:"myReaction"`
		Bookmarked  bool             `json:"bookmarked"`
		LastWatched *lastWatchedWire `json:"lastWatched"`
	}
	return func(w http.ResponseWriter, r *http.Request) {
		movieID := r.PathValue("movieId")
		if movieID == "" {
			writeError(w, http.StatusBadRequest, "movieId is required")
			return
		}

		reaction, err := s.MyReaction(r.Context(), movieID)
		if err != nil {
			log.Printf("userdata: MyReaction %q: %v", movieID, err)
			writeError(w, http.StatusInternalServerError, "internal error")
			return
		}

		bookmarked, err := s.IsBookmarked(r.Context(), movieID)
		if err != nil {
			log.Printf("userdata: IsBookmarked %q: %v", movieID, err)
			writeError(w, http.StatusInternalServerError, "internal error")
			return
		}

		progress, hasProgress, err := s.LastWatched(r.Context(), movieID)
		if err != nil {
			log.Printf("userdata: LastWatched %q: %v", movieID, err)
			writeError(w, http.StatusInternalServerError, "internal error")
			return
		}

		resp := response{Bookmarked: bookmarked}
		if reaction != "" {
			resp.MyReaction = &reaction
		}
		if hasProgress {
			resp.LastWatched = &lastWatchedWire{
				AtSec: progress.AtSec,
				When:  progress.When.UTC().Format("2006-01-02T15:04:05Z"),
			}
		}
		writeJSON(w, http.StatusOK, resp)
	}
}

// handleSetReaction serves POST /api/userdata/movie/{movieId}/react.
// Body: { "emoji": "fire" } or { "emoji": null } to clear. Returns 204.
func handleSetReaction(s *userdata.Store) http.HandlerFunc {
	type req struct {
		Emoji *string `json:"emoji"`
	}
	return func(w http.ResponseWriter, r *http.Request) {
		movieID := r.PathValue("movieId")
		if movieID == "" {
			writeError(w, http.StatusBadRequest, "movieId is required")
			return
		}

		var body req
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeError(w, http.StatusBadRequest, "invalid JSON body")
			return
		}

		emoji := ""
		if body.Emoji != nil {
			emoji = *body.Emoji
		}

		if !validReactions[emoji] {
			writeError(w, http.StatusBadRequest, "emoji must be one of: fire, like, meh, wow, poop (or null to clear)")
			return
		}

		if err := s.SetReaction(r.Context(), movieID, emoji); err != nil {
			log.Printf("userdata: SetReaction %q %q: %v", movieID, emoji, err)
			writeError(w, http.StatusInternalServerError, "internal error")
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

// handleSetBookmark serves POST /api/userdata/movie/{movieId}/bookmark.
// Body: { "on": true, "title": "...", "posterUrl": "...", "year": 2008 }. Returns 204.
func handleSetBookmark(s *userdata.Store) http.HandlerFunc {
	type req struct {
		On        bool   `json:"on"`
		Title     string `json:"title"`
		PosterURL string `json:"posterUrl"`
		Year      int    `json:"year"`
	}
	return func(w http.ResponseWriter, r *http.Request) {
		movieID := r.PathValue("movieId")
		if movieID == "" {
			writeError(w, http.StatusBadRequest, "movieId is required")
			return
		}

		var body req
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeError(w, http.StatusBadRequest, "invalid JSON body")
			return
		}

		snap := userdata.Snapshot{
			Title:     body.Title,
			PosterURL: body.PosterURL,
			Year:      body.Year,
		}
		if err := s.SetBookmark(r.Context(), movieID, body.On, snap); err != nil {
			log.Printf("userdata: SetBookmark %q on=%v: %v", movieID, body.On, err)
			writeError(w, http.StatusInternalServerError, "internal error")
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

// handleSetProgress serves POST /api/userdata/movie/{movieId}/progress.
// Body: { "atSec": 1234, "title": "...", "posterUrl": "...", "year": 2008 }. Returns 204.
func handleSetProgress(s *userdata.Store) http.HandlerFunc {
	type req struct {
		AtSec     int    `json:"atSec"`
		Title     string `json:"title"`
		PosterURL string `json:"posterUrl"`
		Year      int    `json:"year"`
	}
	return func(w http.ResponseWriter, r *http.Request) {
		movieID := r.PathValue("movieId")
		if movieID == "" {
			writeError(w, http.StatusBadRequest, "movieId is required")
			return
		}

		var body req
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeError(w, http.StatusBadRequest, "invalid JSON body")
			return
		}

		snap := userdata.Snapshot{
			Title:     body.Title,
			PosterURL: body.PosterURL,
			Year:      body.Year,
		}
		if err := s.SaveProgress(r.Context(), movieID, body.AtSec, snap); err != nil {
			log.Printf("userdata: SaveProgress %q atSec=%d: %v", movieID, body.AtSec, err)
			writeError(w, http.StatusInternalServerError, "internal error")
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

// handleListBookmarks serves GET /api/userdata/bookmarks.
// Returns { "items": [...] } ordered by added_at DESC.
func handleListBookmarks(s *userdata.Store) http.HandlerFunc {
	type response struct {
		Items []userdata.BookmarkItem `json:"items"`
	}
	return func(w http.ResponseWriter, r *http.Request) {
		items, err := s.ListBookmarks(r.Context())
		if err != nil {
			log.Printf("userdata: ListBookmarks: %v", err)
			writeError(w, http.StatusInternalServerError, "internal error")
			return
		}
		if items == nil {
			items = []userdata.BookmarkItem{}
		}
		writeJSON(w, http.StatusOK, response{Items: items})
	}
}

// handleListHistory serves GET /api/userdata/history.
// Returns { "items": [...] } ordered by watched_at DESC.
func handleListHistory(s *userdata.Store) http.HandlerFunc {
	type response struct {
		Items []userdata.HistoryItem `json:"items"`
	}
	return func(w http.ResponseWriter, r *http.Request) {
		items, err := s.ListHistory(r.Context())
		if err != nil {
			log.Printf("userdata: ListHistory: %v", err)
			writeError(w, http.StatusInternalServerError, "internal error")
			return
		}
		if items == nil {
			items = []userdata.HistoryItem{}
		}
		writeJSON(w, http.StatusOK, response{Items: items})
	}
}
