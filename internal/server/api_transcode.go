package server

import (
	"errors"
	"fmt"
	"log"
	"math"
	"net/http"
	"path/filepath"
	"strconv"
	"strings"

	ztorrent "github.com/AntonZubritski/ZubraCinema/internal/torrent"
	"github.com/AntonZubritski/ZubraCinema/internal/transcode"
)

// reencodeVideoExts lists container types where the video stream is almost
// always a codec MP4 can't accept (DivX/Xvid in AVI, VC-1/WMV3 in WMV,
// Sorenson/FLV1 in FLV, etc.). For these we re-encode to H.264; otherwise
// "-c:v copy" is fine. mkv/mp4/mov can carry H.264/H.265 most of the time
// — we trust them and let copy fail loudly if the source is exotic.
var reencodeVideoExts = map[string]bool{
	".avi": true,
	".wmv": true,
	".flv": true,
	".rm":  true,
	".rmvb": true,
}

// handleTranscode pipes a torrent file through ffmpeg, remuxing on the fly
// into fragmented MP4 so the browser can play containers it doesn't
// understand natively (mkv, avi, ts, ...).
//
// Unlike v0.8 which fed ffmpeg via stdin (forward-only, no seek), this
// handler points ffmpeg at our own /api/torrents/{id}/stream/{fileIdx}
// endpoint as an HTTP-URL input. That endpoint serves Range requests, so
// ffmpeg can do a real input seek when we pass `-ss` — which is exactly
// what the new `?t=N` query param triggers.
//
// Query params:
//   - t (optional): seek offset in seconds, float. 0 (default) means start
//     from the beginning. Negative or NaN → 400. Capped at 1e9 defensively.
//   - audio (optional): per-type audio stream index (matches the Index
//     field returned by /probe). Empty, negative or non-numeric → -1
//     ("auto", ffmpeg's default selection). Capped at 32 defensively —
//     real-world sources never carry that many tracks and we'd rather
//     reject obvious nonsense than spawn ffmpeg against bad input.
//
// The response is still strictly forward-only fragmented MP4: there is no
// Range/Accept-Ranges on this endpoint itself. To seek, the frontend issues
// a fresh request with a new ?t= value.
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

		// Parse ?t= seek offset. Empty/missing → 0. NaN, negative, or
		// non-numeric → 400. We cap at 1e9 seconds (~31 years) as a
		// defensive sanity check against pathological input.
		var startSec float64
		if v := r.URL.Query().Get("t"); v != "" {
			parsed, err := strconv.ParseFloat(v, 64)
			if err != nil || math.IsNaN(parsed) || parsed < 0 {
				http.Error(w, "bad t", http.StatusBadRequest)
				return
			}
			if parsed > 1e9 {
				parsed = 1e9
			}
			startSec = parsed
		}

		// Parse ?audio= per-type audio stream index. Default -1 means
		// "auto — let ffmpeg pick", which matches v0.8 behavior. Bad
		// values (non-numeric, negative) are silently coerced to -1
		// rather than 400 — the player should keep working even if a
		// stale URL points at a track that no longer makes sense. Cap
		// at 32 as a sanity gate against pathological input.
		audioIndex := -1
		if v := r.URL.Query().Get("audio"); v != "" {
			if parsed, err := strconv.Atoi(v); err == nil && parsed >= 0 {
				if parsed > 32 {
					parsed = 32
				}
				audioIndex = parsed
			}
		}

		// Point ffmpeg at our own /stream/ endpoint. r.Host is whatever the
		// browser used to reach us (typically 127.0.0.1:<port>), so the URL
		// resolves locally without going through DNS or the loopback alias.
		// The StreamHandler on the other side does its own piece-priority
		// management on each request, so we don't need to touch priorities
		// or open a Reader here — that ownership has fully moved to /stream/.
		streamURL := fmt.Sprintf("http://%s/api/torrents/%s/stream/%d", r.Host, id, fileIdx)

		// Headers must be set BEFORE StreamRange() writes the first byte —
		// otherwise net/http auto-detects (and probably mis-detects) the
		// content type from the fragmented MP4 magic.
		w.Header().Set("Content-Type", "video/mp4")
		// No caching: each request spins up a fresh ffmpeg pipe and there is
		// no Content-Length to anchor cached bytes against.
		w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
		// No Accept-Ranges and no Content-Length: the response is a
		// strictly-forward fragmented stream of unknown final size.

		// Decide whether to re-encode the video stream. Reads the active
		// file's path and checks its extension against reencodeVideoExts.
		// Falls back to copy-mode for anything we don't have a strong
		// reason to re-encode.
		ext := strings.ToLower(filepath.Ext(files[fileIdx].DisplayPath()))
		reencode := reencodeVideoExts[ext]

		ctx := r.Context()
		if err := tc.StreamRange(ctx, streamURL, startSec, w, reencode, audioIndex); err != nil {
			// A cancelled request context means the client hung up — that's a
			// normal end-of-playback, not an error worth logging.
			if ctx.Err() != nil {
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

// handleCapabilities was moved to api_setup.go and now reports the full host
// capabilities object (every detected tool + the package manager) instead of
// the v0.8 single `{ffmpeg: bool}` flag.
