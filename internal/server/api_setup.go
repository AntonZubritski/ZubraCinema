package server

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"strings"
	"sync"

	"github.com/AntonZubritski/ZubraCinema/internal/setup"
)

// handleCapabilities reports the full host capabilities object: which tools
// are installed and which package manager (if any) is available. Replaces
// the v0.8 `{ffmpeg: bool}` shape.
func handleCapabilities(mgr *setup.Manager) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, mgr.Detect())
	}
}

// handleInstall streams the package-manager install for a tool back to the
// client as Server-Sent Events. Each line of combined stdout+stderr becomes
// one `event: log` event; we close with `event: done` carrying either
// "success" or "error".
//
// SSE is a deliberate choice over a JSON-lines body: it goes through any
// http.Flusher cleanly, the browser's EventSource (or fetch+ReadableStream)
// handles framing, and we get free heartbeating semantics if we ever need
// them.
func handleInstall(mgr *setup.Manager) http.HandlerFunc {
	type req struct {
		Tool string `json:"tool"`
	}
	return func(w http.ResponseWriter, r *http.Request) {
		var body req
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			http.Error(w, "invalid JSON body", http.StatusBadRequest)
			return
		}
		body.Tool = strings.TrimSpace(body.Tool)
		if body.Tool == "" {
			http.Error(w, "tool is required", http.StatusBadRequest)
			return
		}

		flusher, ok := w.(http.Flusher)
		if !ok {
			// Should never happen with the stdlib server, but bail loudly so
			// the frontend doesn't sit on a connection that can't stream.
			http.Error(w, "streaming unsupported", http.StatusInternalServerError)
			return
		}

		// SSE headers. `X-Accel-Buffering: no` is harmless when there's no
		// reverse proxy and disarms nginx-style buffering when there is one.
		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
		w.Header().Set("Connection", "keep-alive")
		w.Header().Set("X-Accel-Buffering", "no")
		w.WriteHeader(http.StatusOK)
		flusher.Flush()

		// sseWriter buffers bytes from setup.Install and flushes complete
		// lines as `event: log` events. setup.Install already sends one line
		// per write, but the writer here makes the contract explicit and
		// resilient to partial writes.
		sw := newSSEWriter(w, flusher)

		err := mgr.Install(r.Context(), body.Tool, sw)
		// Drain any trailing partial line (rare; covers a tool that writes
		// without a trailing newline before exiting).
		sw.flushPending()

		switch {
		case err == nil:
			writeSSE(w, flusher, "done", "success")
		case errors.Is(err, setup.ErrUnknownTool):
			writeSSE(w, flusher, "log", "error: unknown tool")
			writeSSE(w, flusher, "done", "error")
		case errors.Is(err, setup.ErrNoPackageManager):
			writeSSE(w, flusher, "log", "error: no package manager detected on this system")
			writeSSE(w, flusher, "done", "error")
		case errors.Is(err, context.Canceled):
			// Client hung up — don't bother trying to push a final event.
			return
		default:
			writeSSE(w, flusher, "log", "error: "+err.Error())
			writeSSE(w, flusher, "done", "error")
			log.Printf("install %q: %v", body.Tool, err)
		}
	}
}

// writeSSE emits a single SSE event. SSE multi-line `data` is supported by
// repeating the `data:` prefix per line — we do that here so a log line
// containing newlines (rare but possible from some installers) doesn't
// break the framing.
func writeSSE(w io.Writer, f http.Flusher, event, data string) {
	var b bytes.Buffer
	b.WriteString("event: ")
	b.WriteString(event)
	b.WriteByte('\n')
	for _, line := range strings.Split(data, "\n") {
		b.WriteString("data: ")
		b.WriteString(line)
		b.WriteByte('\n')
	}
	b.WriteByte('\n')
	_, _ = w.Write(b.Bytes())
	f.Flush()
}

// sseWriter accepts byte writes from setup.Install and emits one SSE log
// event per complete line.
type sseWriter struct {
	w       io.Writer
	flusher http.Flusher
	mu      sync.Mutex
	buf     bytes.Buffer
}

func newSSEWriter(w io.Writer, f http.Flusher) *sseWriter {
	return &sseWriter{w: w, flusher: f}
}

// Write appends bytes; whenever a newline lands in the buffer we flush every
// complete line as its own SSE event. Partial trailing bytes stay in `buf`
// until the next Write or the final flushPending call.
func (s *sseWriter) Write(p []byte) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.buf.Write(p)
	for {
		raw := s.buf.Bytes()
		idx := bytes.IndexByte(raw, '\n')
		if idx < 0 {
			break
		}
		line := string(bytes.TrimRight(raw[:idx], "\r"))
		s.buf.Next(idx + 1)
		writeSSE(s.w, s.flusher, "log", line)
	}
	return len(p), nil
}

// flushPending emits any buffered bytes that lacked a trailing newline as
// one final log event. Called once at the end of an install.
func (s *sseWriter) flushPending() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.buf.Len() == 0 {
		return
	}
	line := string(bytes.TrimRight(s.buf.Bytes(), "\r\n"))
	s.buf.Reset()
	if line != "" {
		writeSSE(s.w, s.flusher, "log", line)
	}
}

// Compile-time check: bufio.Writer-shaped sanity.
var _ io.Writer = (*sseWriter)(nil)

// (bufio import retained in case future iterations use bufio.Reader for
// extracting carriage-returned progress lines from winget.)
var _ = bufio.NewReader
