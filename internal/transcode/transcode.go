// Package transcode wraps an external `ffmpeg` binary to remux torrent video
// streams into a fragmented MP4 container that browsers can play inline.
//
// It is designed for the common case: the source has h.264 (or h.265) video
// and some audio codec the browser may or may not handle. We always remux the
// video stream as-is (`-c:v copy`) and re-encode audio to AAC, which is the
// universally compatible Chromium pairing. Re-encoding video for obscure
// codecs (mpeg2, theora, av1-in-mkv, etc.) is intentionally out of scope —
// those will fail with a non-zero exit and the frontend falls back to the
// external-player UX.
//
// Output is fragmented MP4 (`frag_keyframe+empty_moov+default_base_moof`) so
// the browser can start rendering as fragments arrive instead of waiting for
// the file to finish. The pipeline is strictly forward-only: there is no
// seek support in this version.
package transcode

import (
	"context"
	"errors"
	"io"
	"os/exec"
)

// ErrNotAvailable is returned by Stream when ffmpeg was not found in PATH at
// startup. Handlers should map this to HTTP 503.
var ErrNotAvailable = errors.New("ffmpeg not available")

// Transcoder is a thin wrapper around the ffmpeg CLI. The zero value is not
// usable — construct via New().
type Transcoder struct {
	ffmpegPath string
}

// New probes for `ffmpeg` in PATH. If it's missing, Available() will report
// false and Stream() will return ErrNotAvailable. We do not error here so the
// rest of the server can boot normally on machines without ffmpeg.
func New() *Transcoder {
	p, err := exec.LookPath("ffmpeg")
	if err != nil {
		return &Transcoder{ffmpegPath: ""}
	}
	return &Transcoder{ffmpegPath: p}
}

// Available reports whether ffmpeg was located at startup.
func (t *Transcoder) Available() bool { return t != nil && t.ffmpegPath != "" }

// Path returns the resolved ffmpeg binary path, or "" if not available.
func (t *Transcoder) Path() string {
	if t == nil {
		return ""
	}
	return t.ffmpegPath
}

// Stream pipes src through ffmpeg, remuxing into fragmented MP4 written to w.
// The caller MUST set Content-Type: video/mp4 BEFORE invoking Stream — once
// ffmpeg starts producing bytes the response is already committed.
//
// The ffmpeg process is bound to ctx via exec.CommandContext, so cancelling
// the request context (e.g. client disconnect) terminates the child cleanly.
//
// Errors:
//   - ErrNotAvailable if ffmpeg wasn't found at startup.
//   - *exec.ExitError if ffmpeg exits non-zero (most common when the source
//     codec can't be remuxed into MP4 — e.g. mpeg2 in mkv).
//   - context.Canceled when the client disconnects mid-stream — handlers
//     should treat this as a normal termination, not an error to log.
func (t *Transcoder) Stream(ctx context.Context, src io.Reader, w io.Writer) error {
	if !t.Available() {
		return ErrNotAvailable
	}
	cmd := exec.CommandContext(ctx, t.ffmpegPath,
		// Quiet ffmpeg: we don't want stderr chatter polluting the log when
		// nothing is wrong. Real errors still bubble up via exit code.
		"-loglevel", "error",
		// `genpts` regenerates monotonic PTS for streams whose timestamps are
		// missing or non-monotonic (common with mkv). `igndts` discards DTS
		// hints that often disagree with PTS and confuse the muxer.
		"-fflags", "+genpts+igndts",
		"-i", "pipe:0",
		// Copy video as-is. Works for h.264 and h.265 (both are valid in MP4).
		// Fails for codecs MP4 doesn't support — that's the documented limit
		// of v0.8.
		"-c:v", "copy",
		// MKV often carries AC3/DTS/FLAC. Chromium plays AAC reliably; the
		// rest are a coin flip. 192 kbps is the cheap, lossy-enough default
		// nobody complains about.
		"-c:a", "aac",
		"-b:a", "192k",
		// Fragmented MP4 flags: emit a moov atom up front (empty_moov),
		// produce keyframe-aligned fragments (frag_keyframe), and use
		// default_base_moof so each fragment is self-contained — the browser
		// can start playing as bytes arrive instead of waiting for an index
		// at the end.
		"-movflags", "frag_keyframe+empty_moov+default_base_moof",
		"-f", "mp4",
		"pipe:1",
	)
	cmd.Stdin = src
	cmd.Stdout = w
	// Discard stderr. With -loglevel error ffmpeg writes only genuine errors
	// here; we surface them via the non-zero exit code returned by Run().
	cmd.Stderr = io.Discard
	return cmd.Run()
}
