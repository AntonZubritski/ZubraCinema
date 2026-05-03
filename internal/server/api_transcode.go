package server

import (
	"errors"
	"log"
	"net/http"
	"strconv"

	atorrent "github.com/anacrolix/torrent"

	ztorrent "github.com/AntonZubritski/ZubraCinema/internal/torrent"
	"github.com/AntonZubritski/ZubraCinema/internal/transcode"
)

// handleTranscode pipes a torrent file through ffmpeg, remuxing on the fly
// into fragmented MP4 so the browser can play containers it doesn't
// understand natively (mkv, avi, ts, ...). It mirrors the priority/readahead
// logic in StreamHandler so the swarm focuses on the file we're actually
// playing.
//
// There is intentionally no Range/Accept-Ranges support: the ffmpeg pipe is
// strictly forward-only. Seeking will be addressed in a later iteration.
func handleTranscode(m *ztorrent.Manager, tc *transcode.Transcoder) http.HandlerFunc {
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
		f := files[fileIdx]

		// Focus the swarm on the active file (same trick as StreamHandler).
		// Other files drop to PiecePriorityNone so peer slots are spent on
		// pieces ffmpeg is about to need.
		for i, other := range files {
			if i == fileIdx {
				continue
			}
			other.SetPriority(atorrent.PiecePriorityNone)
		}
		f.SetPriority(atorrent.PiecePriorityHigh)
		f.Download()

		reader := f.NewReader()
		defer reader.Close()
		// 64 MiB readahead matches StreamHandler: enough to keep ffmpeg fed
		// during slow-swarm hiccups without bloating memory.
		reader.SetReadahead(64 << 20)
		reader.SetResponsive()
		reader.SetContext(r.Context())

		// Headers must be set BEFORE Stream() writes the first byte —
		// otherwise net/http auto-detects (and probably mis-detects) the
		// content type from the fragmented MP4 magic.
		w.Header().Set("Content-Type", "video/mp4")
		// No caching: each request spins up a fresh ffmpeg pipe and there is
		// no Content-Length to anchor cached bytes against.
		w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
		// No Accept-Ranges and no Content-Length: the response is a
		// strictly-forward fragmented stream of unknown final size.

		if err := tc.Stream(r.Context(), reader, w); err != nil {
			// A cancelled request context means the client hung up — that's a
			// normal end-of-playback, not an error worth logging.
			if r.Context().Err() != nil {
				return
			}
			if errors.Is(err, transcode.ErrNotAvailable) {
				// Race: ffmpeg vanished after capability check. Hard to hit in
				// practice but we still avoid spamming the log.
				return
			}
			// ExitError here typically means the source codec couldn't be
			// remuxed into MP4 (mpeg2, theora, av1-in-mkv, ...). The response
			// has already been committed with 200 + video/mp4, so we can't
			// switch to a clean error code — the browser will hit a stalled
			// <video> and the frontend's 'error' phase takes over.
			log.Printf("transcode: %v", err)
		}
	}
}

// handleCapabilities reports server-side feature flags that the frontend
// uses to gate UI (currently: whether ffmpeg is available for in-browser
// transcoding of mkv/avi/etc.).
func handleCapabilities(tc *transcode.Transcoder) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{
			"ffmpeg": tc.Available(),
		})
	}
}
