package server

import (
	"encoding/json"
	"io/fs"
	"log"
	"net/http"
	"strings"

	"github.com/AntonZubritski/ZubraCinema/internal/launcher"
	"github.com/AntonZubritski/ZubraCinema/internal/metadata"
	"github.com/AntonZubritski/ZubraCinema/internal/setup"
	"github.com/AntonZubritski/ZubraCinema/internal/sources"
	"github.com/AntonZubritski/ZubraCinema/internal/sources/porevotorrent"
	"github.com/AntonZubritski/ZubraCinema/internal/sources/rintor"
	"github.com/AntonZubritski/ZubraCinema/internal/sources/rutor"
	ztorrent "github.com/AntonZubritski/ZubraCinema/internal/torrent"
	"github.com/AntonZubritski/ZubraCinema/internal/transcode"
	"github.com/AntonZubritski/ZubraCinema/internal/userdata"
	webroot "github.com/AntonZubritski/ZubraCinema/web"
)

type Deps struct {
	Manager    *ztorrent.Manager
	Aggregator *sources.Aggregator
	Rutor      *rutor.Source
	Rintor     *rintor.Source
	Porevo     *porevotorrent.Source
	Transcoder *transcode.Transcoder
	Setup      *setup.Manager
	Metadata   *metadata.Client
	// OMDb and KP are optional secondary rating sources merged into the
	// /api/metadata response. Either being nil/unavailable just zeroes the
	// corresponding fields — the frontend hides zero-rating chips.
	OMDb *metadata.OMDbClient
	KP   *metadata.KPClient
	// UserData is the SQLite-backed local store for reactions, bookmarks
	// and history. nil disables the /api/userdata/* routes.
	UserData *userdata.Store
	// ConfigPath is the JSON file path the settings API reads from and
	// writes back to. Empty disables settings persistence (the API still
	// reports the running config but POST is rejected).
	ConfigPath string
	// Port is the HTTP port the server is bound to. The settings API
	// uses it to compute LAN URLs the user can copy onto a TV browser.
	Port int
}

func New(d Deps) http.Handler {
	mux := http.NewServeMux()

	// Search (grouped torrents pulled directly from trackers).
	mux.HandleFunc("GET /api/search", handleSearch(d.Aggregator))

	// Featured HD movies (rutor-only, cached).
	if d.Rutor != nil {
		mux.HandleFunc("GET /api/featured", handleFeatured(d.Rutor, d.Aggregator))
	}

	// Category browse: list of categories + paginated per-category listings.
	// Both depend on rutor (and the aggregator for poster enrichment), so
	// they're gated behind the same nil-check as featured.
	mux.HandleFunc("GET /api/categories", handleListCategories())
	if d.Rutor != nil {
		mux.HandleFunc("GET /api/category/{slug}", handleCategoryBrowse(d.Rutor, d.Rintor, d.Porevo, d.Aggregator))
	}

	// Torrent CRUD
	mux.HandleFunc("POST /api/torrents", handleAddTorrent(d.Manager))
	mux.HandleFunc("GET /api/torrents", handleListTorrents(d.Manager))
	mux.HandleFunc("GET /api/torrents/{id}", handleGetTorrent(d.Manager))
	mux.HandleFunc("DELETE /api/torrents/{id}", handleDeleteTorrent(d.Manager))
	mux.HandleFunc("GET /api/torrents/{id}/stream/{fileIdx}", ztorrent.StreamHandler(d.Manager))

	// On-the-fly remux to fragmented MP4 for containers Chromium won't play
	// (mkv/avi/ts/...). Falls back to 503 if ffmpeg isn't installed.
	if d.Transcoder != nil {
		mux.HandleFunc("GET /api/torrents/{id}/transcode/{fileIdx}", handleTranscode(d.Manager, d.Transcoder))
		mux.HandleFunc("GET /api/torrents/{id}/probe/{fileIdx}", handleProbe(d.Manager, d.Transcoder))
		// Note: no .vtt suffix — Go's ServeMux requires wildcard segments
		// to end at `}`. Content-Type=text/vtt on the response is what
		// tells the browser the body is WebVTT.
		mux.HandleFunc("GET /api/torrents/{id}/subtitle/{fileIdx}/{subIdx}", handleSubtitle(d.Manager, d.Transcoder))
	}

	// Capabilities probe + one-click installer. The Manager is always
	// non-nil (main wires it up unconditionally) so we don't gate the
	// routes — the frontend always wants to know what the host has.
	if d.Setup != nil {
		mux.HandleFunc("GET /api/capabilities", handleCapabilities(d.Setup))
		mux.HandleFunc("POST /api/install", handleInstall(d.Setup))
	}

	// Movie metadata (TMDB → OMDb + kinopoisk.dev fan-out). Always registered;
	// handler returns 503 only when TMDB itself is disabled. OMDb / KP keys
	// being absent is fine — those columns just stay at zero on the wire and
	// get hidden by the frontend.
	mux.HandleFunc("GET /api/metadata", handleMetadata(d.Metadata, d.OMDb, d.KP))

	// Local user-data: reactions, bookmarks, watch history. Single-user app
	// so no auth — the rows live in a SQLite file alongside the torrent db.
	if d.UserData != nil {
		mux.HandleFunc("GET /api/userdata/movie/{movieId}", handleGetUserdataMovie(d.UserData))
		mux.HandleFunc("POST /api/userdata/movie/{movieId}/react", handleSetReaction(d.UserData))
		mux.HandleFunc("POST /api/userdata/movie/{movieId}/bookmark", handleSetBookmark(d.UserData))
		mux.HandleFunc("POST /api/userdata/movie/{movieId}/progress", handleSetProgress(d.UserData))
		mux.HandleFunc("GET /api/userdata/bookmarks", handleListBookmarks(d.UserData))
		mux.HandleFunc("GET /api/userdata/history", handleListHistory(d.UserData))
	}

	// Settings: read and write the on-disk config (currently just the
	// downloads directory). Folder-picker spawns the OS-native dialog.
	mux.HandleFunc("GET /api/settings", handleGetSettings(d.Manager, d.ConfigPath, d.Port))
	mux.HandleFunc("POST /api/settings", handleUpdateSettings(d.Manager, d.ConfigPath))
	mux.HandleFunc("POST /api/folder-picker", handleFolderPicker())

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
