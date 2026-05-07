package server

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"sync"
	"time"

	ztorrent "github.com/AntonZubritski/ZubraCinema/internal/torrent"
	"github.com/AntonZubritski/ZubraCinema/internal/transcode"
)

// probeCache memoizes ffprobe results per (torrentID, fileIdx). Container
// duration is immutable for a given file, so the cache lives for the
// lifetime of the process — no TTL, no eviction. sync.Map is fine here:
// reads vastly outnumber writes (one write per unique file, ever) and the
// keys are bounded by the number of files the user actually plays.
var probeCache sync.Map // map[string]transcode.ProbeInfo

// handleProbe serves GET /api/torrents/{id}/probe/{fileIdx}.
//
// It probes the same file the transcode endpoint would serve and returns
// the container duration in seconds. Internally it points ffprobe at the
// local stream handler so range-seeking inside the torrent file works
// without spinning up a second download path.
//
// Result is cached per (id, fileIdx) for the lifetime of the process —
// duration doesn't change once known.
func handleProbe(m *ztorrent.Manager, tc *transcode.Transcoder) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !tc.Available() {
			http.Error(w, "ffmpeg not installed on server", http.StatusServiceUnavailable)
			return
		}

		id := r.PathValue("id")
		fileIdxStr := r.PathValue("fileIdx")
		item, ok := m.Get(id)
		if !ok {
			http.NotFound(w, r)
			return
		}
		fileIdx, err := strconv.Atoi(fileIdxStr)
		if err != nil {
			http.Error(w, "bad fileIdx", http.StatusBadRequest)
			return
		}
		files := item.T.Files()
		if fileIdx < 0 || fileIdx >= len(files) {
			http.NotFound(w, r)
			return
		}

		cacheKey := id + ":" + strconv.Itoa(fileIdx)
		if cached, hit := probeCache.Load(cacheKey); hit {
			writeJSON(w, http.StatusOK, cached.(transcode.ProbeInfo))
			return
		}

		// ffprobe reads through the local stream endpoint, which honors
		// Range — that's what lets it seek to the trailer/moov at the end
		// of an MP4 without downloading the whole file first.
		inputURL := fmt.Sprintf("http://%s/api/torrents/%s/stream/%d", r.Host, id, fileIdx)

		ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
		defer cancel()

		info, err := tc.Probe(ctx, inputURL)
		if err != nil {
			// Client hung up before ffprobe finished — nothing to write.
			if errors.Is(r.Context().Err(), context.Canceled) {
				return
			}
			log.Printf("probe: %v", err)
			writeError(w, http.StatusBadGateway, "probe failed: "+err.Error())
			return
		}

		probeCache.Store(cacheKey, info)
		writeJSON(w, http.StatusOK, info)
	}
}
