package server

import (
	"encoding/json"
	"io/fs"
	"log"
	"net/http"
	"strings"

	"github.com/AntonZubritski/ZubraCinema/internal/launcher"
	"github.com/AntonZubritski/ZubraCinema/internal/sources/yts"
	webroot "github.com/AntonZubritski/ZubraCinema/web"
)

func New() http.Handler {
	mux := http.NewServeMux()

	client := yts.NewClient()

	mux.HandleFunc("/api/search", handleSearch(client))
	mux.HandleFunc("/api/play", handlePlay())

	distFS, err := fs.Sub(webroot.Dist, "dist")
	if err != nil {
		log.Fatalf("embed sub fs: %v", err)
	}
	mux.HandleFunc("/", spaHandler(distFS))

	return mux
}

func handleSearch(client *yts.Client) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		q := strings.TrimSpace(r.URL.Query().Get("q"))
		if q == "" {
			writeJSON(w, http.StatusOK, []yts.Movie{})
			return
		}
		movies, err := client.Search(r.Context(), q)
		if err != nil {
			log.Printf("search error: %v", err)
			http.Error(w, "search failed", http.StatusBadGateway)
			return
		}
		writeJSON(w, http.StatusOK, movies)
	}
}

type playRequest struct {
	Magnet string `json:"magnet"`
}

func handlePlay() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		var body playRequest
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			http.Error(w, "invalid JSON body", http.StatusBadRequest)
			return
		}
		body.Magnet = strings.TrimSpace(body.Magnet)
		if body.Magnet == "" {
			http.Error(w, "magnet is required", http.StatusBadRequest)
			return
		}
		if !strings.HasPrefix(body.Magnet, "magnet:") {
			http.Error(w, "invalid magnet URI", http.StatusBadRequest)
			return
		}
		if err := launcher.OpenURL(body.Magnet); err != nil {
			log.Printf("launcher error: %v", err)
			http.Error(w, "failed to open magnet", http.StatusInternalServerError)
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
