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
	"fmt"
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

// StreamRange runs ffmpeg against an HTTP URL input (so it can use Range
// requests) and optionally seeks to startSec before transcoding. The output
// is fragmented MP4, same flags as Stream(). startSec=0 means "from start";
// a positive value passes -ss <startSec> BEFORE -i so ffmpeg does an input
// seek (fast, keyframe-aligned).
//
// inputURL must be a Range-supporting URL — for ZubraCinema this is the
// local /api/torrents/{id}/stream/{fileIdx} endpoint. Anything else
// (including non-seekable sources) will silently produce a from-start
// stream when startSec > 0.
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
//
// reencodeVideo controls the video pipeline:
//   - false (default): "-c:v copy" — fast remux, works for H.264 / H.265.
//     Fails (silently producing a header-only stream) for DivX/Xvid AVI,
//     WMV, FLV, MPEG-2, etc. — codecs MP4 doesn't accept.
//   - true: "-c:v libx264 -preset ultrafast" — actual re-encode, eats CPU
//     but works for any source. Caller picks based on file extension.
//
// audioIndex selects which audio stream to mux into the output:
//   - audioIndex < 0 (the historical default): no `-map` flags, ffmpeg
//     picks the "best" audio stream by its own heuristics. Fine for
//     single-track sources.
//   - audioIndex >= 0: emit `-map 0:v:0 -map 0:a:<audioIndex>` so the
//     caller can switch between Russian/English/director's commentary
//     etc. The index is the per-type counter from ProbeInfo.Audio[].Index.
func (t *Transcoder) StreamRange(ctx context.Context, inputURL string, startSec float64, w io.Writer, reencodeVideo bool, audioIndex int) error {
	if !t.Available() {
		return ErrNotAvailable
	}
	args := []string{
		// Quiet ffmpeg: we don't want stderr chatter polluting the log when
		// nothing is wrong. Real errors still bubble up via exit code.
		"-loglevel", "error",
		// `genpts` regenerates monotonic PTS for streams whose timestamps are
		// missing or non-monotonic (common with mkv). `igndts` discards DTS
		// hints that often disagree with PTS and confuse the muxer.
		"-fflags", "+genpts+igndts",
	}
	// `-ss` BEFORE `-i` is the "input seek": ffmpeg uses Range requests on
	// the HTTP source to jump to the nearest keyframe, which is fast and
	// avoids decoding from byte 0. Placing it after -i would force a full
	// scan from the start, defeating the point.
	if startSec > 0 {
		args = append(args, "-ss", fmt.Sprintf("%.3f", startSec))
	}
	args = append(args, "-i", inputURL)
	// Stream mapping: only emit `-map` when the caller explicitly picked an
	// audio track. Otherwise ffmpeg's default selector (best audio of the
	// best language) does the right thing on single-track sources, which is
	// the common case and keeps the existing behavior intact.
	if audioIndex >= 0 {
		args = append(args,
			"-map", "0:v:0",
			"-map", fmt.Sprintf("0:a:%d", audioIndex),
		)
	}
	if reencodeVideo {
		// libx264 ultrafast keeps CPU low and latency reasonable. crf 23 is
		// the de-facto "visually lossless enough" setting. yuv420p ensures
		// chroma subsampling Chromium expects (some Xvid sources are 444).
		args = append(args,
			"-c:v", "libx264",
			"-preset", "ultrafast",
			"-crf", "23",
			"-pix_fmt", "yuv420p",
			"-tune", "zerolatency",
		)
	} else {
		// Copy video as-is. Works for H.264 and H.265 (both valid in MP4).
		args = append(args, "-c:v", "copy")
	}
	args = append(args,
		// MKV often carries AC3/DTS/FLAC. Chromium plays AAC reliably; the
		// rest are a coin flip. 192 kbps is the cheap, lossy-enough default
		// nobody complains about.
		"-c:a", "aac",
		"-b:a", "192k",
		// A/V sync. Input-seek (-ss before -i) drops samples ahead of the
		// requested time, but the audio decoder still has its own pre-roll
		// buffer that ends up offset from the video PTS. The combination
		// below is what fixes "video plays for ~0.5s before audio arrives"
		// after switching tracks:
		//   -af aresample=async=1000 — pad/drop up to 1000 samples to lock
		//     audio PTS onto the video clock at the start of the stream.
		//   -fps_mode cfr — emit a constant-rate video so the muxer sees
		//     monotonic, predictable video timestamps.
		//   -avoid_negative_ts make_zero — after -ss, the first packet
		//     often has a negative PTS; shifting both streams to zero
		//     keeps the muxer happy and the browser's <video> from
		//     rejecting the initial fragment.
		"-af", "aresample=async=1000",
		"-fps_mode", "cfr",
		"-avoid_negative_ts", "make_zero",
		// Fragmented MP4 flags: emit a moov atom up front (empty_moov),
		// produce keyframe-aligned fragments (frag_keyframe), and use
		// default_base_moof so each fragment is self-contained — the browser
		// can start playing as bytes arrive instead of waiting for an index
		// at the end.
		"-movflags", "frag_keyframe+empty_moov+default_base_moof",
		"-f", "mp4",
		"pipe:1",
	)
	cmd := exec.CommandContext(ctx, t.ffmpegPath, args...)
	cmd.Stdout = w
	// Discard stderr. With -loglevel error ffmpeg writes only genuine errors
	// here; we surface them via the non-zero exit code returned by Run().
	cmd.Stderr = io.Discard
	return cmd.Run()
}

// StreamSubtitle extracts the Nth subtitle stream (per-type index, the
// same numbering used by ProbeInfo.Subtitles[].Index) from inputURL and
// writes it as WebVTT to w. The output is the bare WebVTT body — no HTTP
// framing, no charset prefix — suitable for piping directly into a
// `text/vtt` response. The browser's <track> element consumes this
// natively.
//
// inputURL must be a Range-supporting URL (the local /stream/ endpoint
// in practice) so ffmpeg can scan the source efficiently.
//
// The ffmpeg process is bound to ctx via exec.CommandContext, so cancelling
// the request context (e.g. client disconnect) terminates the child cleanly.
//
// Errors mirror StreamRange: ErrNotAvailable when ffmpeg is missing,
// *exec.ExitError when ffmpeg fails (most often: subIdx out of range, or
// the codec wasn't actually a text-sub codec we can convert), and
// context.Canceled on client disconnect.
func (t *Transcoder) StreamSubtitle(ctx context.Context, inputURL string, subIdx int, w io.Writer) error {
	if !t.Available() {
		return ErrNotAvailable
	}
	cmd := exec.CommandContext(ctx, t.ffmpegPath,
		// Quiet ffmpeg: real errors still surface via the exit code.
		"-loglevel", "error",
		"-i", inputURL,
		// Pick exactly one subtitle stream by per-type index. ffmpeg's
		// `0:s:N` selector matches the numbering ProbeInfo.Subtitles uses.
		"-map", fmt.Sprintf("0:s:%d", subIdx),
		// `webvtt` is the only widely-supported in-browser subtitle codec.
		// Source codecs we accept here are text-based (subrip/srt, ass,
		// mov_text); bitmap subs (PGS/VobSub) won't convert and we already
		// filter them out at the probe layer.
		"-c:s", "webvtt",
		"-f", "webvtt",
		"pipe:1",
	)
	cmd.Stdout = w
	cmd.Stderr = io.Discard
	return cmd.Run()
}
