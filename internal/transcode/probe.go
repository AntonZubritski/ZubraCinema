package transcode

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
)

// TrackInfo describes a single audio or subtitle stream as exposed to the
// frontend. Index is the zero-based per-codec-type index (audio:0, audio:1,
// subtitle:0, ...) — that's exactly what ffmpeg's `-map 0:a:N` / `-map 0:s:N`
// expects, NOT the absolute stream index. Codec, Language and Title come
// straight from the ffprobe output and may be empty when the source has no
// metadata.
type TrackInfo struct {
	Index    int    `json:"index"`
	Codec    string `json:"codec"`
	Language string `json:"language"`
	Title    string `json:"title"`
}

// ProbeInfo carries the metadata extracted by Probe. It exposes the
// container duration plus per-type listings of audio and subtitle streams.
// The struct shape is part of the JSON contract for /api/torrents/{id}/probe.
type ProbeInfo struct {
	DurationSec float64     `json:"durationSec"`
	Audio       []TrackInfo `json:"audio"`
	Subtitles   []TrackInfo `json:"subtitles"`
}

// bitmapSubCodecs is the set of subtitle codecs we deliberately skip when
// listing subtitles. They're rendered as bitmaps in the source (Blu-ray
// PGS, DVD VobSub) and ffmpeg can't transcode them to WebVTT without OCR,
// which is well outside the scope of in-browser playback. Better to hide
// them than to surface a "subtitle" track that fails the moment the user
// selects it.
var bitmapSubCodecs = map[string]bool{
	"pgssub":            true,
	"hdmv_pgs_subtitle": true,
	"dvd_subtitle":      true,
	"dvdsub":            true,
}

// ffprobeStream is the subset of ffprobe's `-show_streams` JSON we care
// about. We deliberately ignore disposition, profile, etc. — they're not
// needed for track selection.
type ffprobeStream struct {
	CodecType string `json:"codec_type"`
	CodecName string `json:"codec_name"`
	Tags      struct {
		Language string `json:"language"`
		Title    string `json:"title"`
	} `json:"tags"`
}

// ffprobeFormat is the subset of ffprobe's `-show_format` JSON we need:
// the container duration as a string (ffprobe always emits it stringified).
type ffprobeFormat struct {
	Duration string `json:"duration"`
}

// ffprobeOutput mirrors the top-level shape of `ffprobe -show_format
// -show_streams -of json` output.
type ffprobeOutput struct {
	Format  ffprobeFormat   `json:"format"`
	Streams []ffprobeStream `json:"streams"`
}

// Probe runs ffprobe against an input URL (typically the local stream
// endpoint) and returns the container's duration plus the audio and
// subtitle track listings. ffprobe is located next to the ffmpeg binary
// the Transcoder was constructed with; on Windows we append `.exe`. If
// neither the sibling binary nor a PATH lookup finds ffprobe, we return
// an error wrapping ErrNotAvailable.
//
// The 30s timeout (or any other deadline) is the caller's responsibility —
// pass it via ctx.
func (t *Transcoder) Probe(ctx context.Context, inputURL string) (ProbeInfo, error) {
	if !t.Available() {
		return ProbeInfo{}, ErrNotAvailable
	}

	probePath, err := resolveFfprobe(t.ffmpegPath)
	if err != nil {
		return ProbeInfo{}, fmt.Errorf("ffprobe: %w", err)
	}

	cmd := exec.CommandContext(ctx, probePath,
		// Suppress non-error chatter; we only consume stdout below.
		"-v", "error",
		// JSON output is far easier to parse than the default flat key=value
		// format once we want more than one field.
		"-of", "json",
		// Pull both the format block (for duration) and the streams array
		// (for audio/subtitle enumeration) in one ffprobe call.
		"-show_format",
		"-show_streams",
		inputURL,
	)
	// Discard stderr — with -v error ffprobe writes only genuine errors here,
	// and we surface them via the non-zero exit code.
	cmd.Stderr = io.Discard

	out, err := cmd.Output()
	if err != nil {
		return ProbeInfo{}, fmt.Errorf("ffprobe: %w", err)
	}

	var parsed ffprobeOutput
	if err := json.Unmarshal(out, &parsed); err != nil {
		return ProbeInfo{}, fmt.Errorf("ffprobe: %w", err)
	}

	// Duration: ffprobe emits this as a string ("1234.567000"). Empty or
	// unparseable means we just expose 0 — Probe's contract historically
	// errors on unreadable duration, but with -show_streams we may get a
	// usable streams block even when duration is missing. We prefer to keep
	// the strict-error behavior so the frontend's existing assumptions hold.
	dur, err := strconv.ParseFloat(parsed.Format.Duration, 64)
	if err != nil {
		return ProbeInfo{}, fmt.Errorf("ffprobe: %w", err)
	}

	info := ProbeInfo{
		DurationSec: dur,
		Audio:       []TrackInfo{},
		Subtitles:   []TrackInfo{},
	}

	// Walk streams in declaration order, maintaining independent counters
	// per codec_type so the index we expose matches `-map 0:a:N` /
	// `-map 0:s:N`. Anything that isn't audio or non-bitmap subtitle is
	// ignored (video streams, attachments, data).
	audioIdx, subIdx := 0, 0
	for _, s := range parsed.Streams {
		switch s.CodecType {
		case "audio":
			info.Audio = append(info.Audio, TrackInfo{
				Index:    audioIdx,
				Codec:    s.CodecName,
				Language: s.Tags.Language,
				Title:    s.Tags.Title,
			})
			audioIdx++
		case "subtitle":
			// We MUST advance subIdx for every subtitle stream — even bitmap
			// ones we hide — because Index is the selector ffmpeg uses with
			// `-map 0:s:N`, and ffmpeg counts bitmap subs in that ordering
			// regardless of whether we surface them.
			currentIdx := subIdx
			subIdx++
			if bitmapSubCodecs[s.CodecName] {
				// Bitmap subs (PGS/VobSub) need OCR for WebVTT — hide from
				// the exposed list so the UI doesn't offer a track that
				// would fail the moment the user picks it.
				continue
			}
			info.Subtitles = append(info.Subtitles, TrackInfo{
				Index:    currentIdx,
				Codec:    s.CodecName,
				Language: s.Tags.Language,
				Title:    s.Tags.Title,
			})
		}
	}

	return info, nil
}

// resolveFfprobe locates ffprobe by first looking next to the ffmpeg binary
// (the common install layout — both ship in the same archive) and falling
// back to PATH. Returns ErrNotAvailable wrapped in a descriptive error if
// neither lookup succeeds.
func resolveFfprobe(ffmpegPath string) (string, error) {
	if ffmpegPath != "" {
		sibling := filepath.Join(filepath.Dir(ffmpegPath), "ffprobe")
		if runtime.GOOS == "windows" {
			sibling += ".exe"
		}
		if _, err := os.Stat(sibling); err == nil {
			return sibling, nil
		}
	}
	if p, err := exec.LookPath("ffprobe"); err == nil {
		return p, nil
	}
	return "", ErrNotAvailable
}
