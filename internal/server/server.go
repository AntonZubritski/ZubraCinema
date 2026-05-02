package server

import (
	"encoding/json"
	"io/fs"
	"log"
	"net/http"
	"strings"

	"github.com/AntonZubritski/ZubraCinema/internal/launcher"
	"github.com/AntonZubritski/ZubraCinema/internal/metadata/tmdb"
	"github.com/AntonZubritski/ZubraCinema/internal/sources"
	ztorrent "github.com/AntonZubritski/ZubraCinema/internal/torrent"
	webroot "github.com/AntonZubritski/ZubraCinema/web"
)

type Deps struct {
	Manager    *ztorrent.Manager
	TMDB       *tmdb.Client
	Aggregator *sources.Aggregator
}

func New(d Deps) http.Handler {
	mux := http.NewServeMux()

	// Search & metadata
	mux.HandleFunc("GET /api/search", handleTMDBSearch(d.TMDB))
	mux.HandleFunc("GET /api/movie/{tmdbId}", handleMovieDetail(d.TMDB))
	mux.HandleFunc("GET /api/movie/{tmdbId}/torrents", handleMovieTorrents(d.TMDB, d.Aggregator))

	// Torrent CRUD
	mux.HandleFunc("POST /api/torrents", handleAddTorrent(d.Manager))
	mux.HandleFunc("GET /api/torrents", handleListTorrents(d.Manager))
	mux.HandleFunc("GET /api/torrents/{id}", handleGetTorrent(d.Manager))
	mux.HandleFunc("DELETE /api/torrents/{id}", handleDeleteTorrent(d.Manager))
	mux.HandleFunc("GET /api/torrents/{id}/stream/{fileIdx}", ztorrent.StreamHandler(d.Manager))

	// Launcher (open URL in default app)
	mux.HandleFunc("POST /api/launch", handleLaunch())

	// SPA
	distFS, err := fs.Sub(webroot.Dist, "dist")
	if err != nil {
		log.Fatalf("embed sub fs: %v", err)
	}
	mux.HandleFunc("/", spaHandler(distFS))

	return mux
}

func handleLaunch() http.HandlerFunc {
	type req struct {
		URL string `json:"url"`
	}
	return func(w http.ResponseWriter, r *http.Request) {
		var body req
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			http.Error(w, "invalid JSON body", http.StatusBadRequest)
			return
		}
		body.URL = strings.TrimSpace(body.URL)
		if body.URL == "" {
			http.Error(w, "url is required", http.StatusBadRequest)
			return
		}
		if err := launcher.OpenURL(body.URL); err != nil {
			log.Printf("launcher error: %v", err)
			http.Error(w, "failed to open url", http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func spaHandler(distFS fs.FS) http.HandlerFunc {
	fileServer := http.FileServer(http.FS(distFS))
	return func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/") {
			http.NotFound(w, r)
			return
		}
		clean := strings.TrimPrefix(r.URL.Path, "/")
		if clean != "" {
			if f, err := distFS.Open(clean); err == nil {
				info, statErr := f.Stat()
				_ = f.Close()
				if statErr == nil && !info.IsDir() {
					fileServer.ServeHTTP(w, r)
					return
				}
			}
		}
		index, err := fs.ReadFile(distFS, "index.html")
		if err != nil {
			http.Error(w, "frontend not built — run `make build` (or `npm run build` in web/)", http.StatusServiceUnavailable)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = w.Write(index)
	}
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(body); err != nil {
		log.Printf("write json: %v", err)
	}
}

func writeError(w http.ResponseWriter, status int, message string) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": message})
}
