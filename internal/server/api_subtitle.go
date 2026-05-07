package server

import (
	"errors"
	"fmt"
	"log"
	"net/http"
	"strconv"

	ztorrent "github.com/AntonZubritski/ZubraCinema/internal/torrent"
	"github.com/AntonZubritski/ZubraCinema/internal/transcode"
)

// handleSubtitle serves GET /api/torrents/{id}/subtitle/{fileIdx}/{subIdx}.vtt.
// It runs ffmpeg with `-map 0:s:<subIdx> -c:s webvtt -f webvtt -` against
// the local /stream/ endpoint and pipes the WebVTT body straight back to
// the client. A browser <track kind="subtitles" src="..."> picks it up
// natively, so the frontend doesn't need to parse anything.
//
// Like /transcode, this endpoint is strictly forward — no Range support.
// Subtitles are tiny (a few hundred KB even for a long film) so it's fine
// to re-spawn ffmpeg per request rather than caching the converted body.
//
// Validation mirrors handleTranscode: 404 for unknown {id} or out-of-range
// {fileIdx}, 400 for non-numeric {fileIdx}/{subIdx} or negative {subIdx},
// 503 when ffmpeg is missing.
func handleSubtitle(m *ztorrent.Manager, tc *transcode.Transcoder) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !tc.Available() {
			http.Error(w, "ffmpeg not installed on server", http.StatusServiceUnavailable)
			return
		}

		id := r.PathValue("id")
		fileIdxStr := r.PathValue("fileIdx")
		subIdxStr := r.PathValue("subIdx")
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
		subIdx, err := strconv.Atoi(subIdxStr)
		if err != nil || subIdx < 0 {
			http.Error(w, "bad subIdx", http.StatusBadRequest)
			return
		}
		// Defensive cap — same rationale as the audio cap in api_transcode:
		// real sources never carry this many tracks and we'd rather reject
		// pathological input than fork ffmpeg against it.
		if subIdx > 32 {
			http.Error(w, "bad subIdx", http.StatusBadRequest)
			return
		}

		// Mirror api_transcode: aim ffmpeg at our own /stream/ endpoint so
		// it can do Range reads through the existing piece-priority logic.
		streamURL := fmt.Sprintf("http://%s/api/torrents/%s/stream/%d", r.Host, id, fileIdx)

		// Headers MUST be set before StreamSubtitle writes the first byte —
		// once ffmpeg's output starts flowing the response is committed and
		// auto-detection would mislabel the body.
		w.Header().Set("Content-Type", "text/vtt; charset=utf-8")
		w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")

		ctx := r.Context()
		if err := tc.StreamSubtitle(ctx, streamURL, subIdx, w); err != nil {
			// Client hung up mid-stream — normal end-of-track, don't log.
			if ctx.Err() != nil {
				return
			}
			if errors.Is(err, transcode.ErrNotAvailable) {
				// Race: ffmpeg vanished after capability check. Hard to
				// hit in practice, but no point spamming the log.
				return
			}
			// ExitError typically means subIdx pointed at a stream that
			// can't be converted (bitmap sub that slipped past the probe
			// filter, or out-of-range index). The response is already
			// committed with 200 + text/vtt, so we can't switch status.
			// The browser ends up with an empty <track> and the UI hides
			// the option. Log so we know it happened.
			log.Printf("subtitle: %v", err)
		}
	}
}
