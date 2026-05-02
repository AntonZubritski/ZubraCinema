package server

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strings"
	"time"

	ztorrent "github.com/AntonZubritski/ZubraCinema/internal/torrent"
)

type addTorrentReq struct {
	Magnet string `json:"magnet"`
	Mode   string `json:"mode"`
}

func handleAddTorrent(m *ztorrent.Manager) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body addTorrentReq
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			http.Error(w, "invalid JSON body", http.StatusBadRequest)
			return
		}
		body.Magnet = strings.TrimSpace(body.Magnet)
		if body.Magnet == "" || !strings.HasPrefix(strings.ToLower(body.Magnet), "magnet:") {
			http.Error(w, "invalid magnet URI", http.StatusBadRequest)
			return
		}
		mode := strings.ToLower(strings.TrimSpace(body.Mode))
		switch mode {
		case "", ztorrent.ModeStream:
			mode = ztorrent.ModeStream
		case ztorrent.ModeDownload:
			// ok
		default:
			http.Error(w, "invalid mode (expected 'stream' or 'download')", http.StatusBadRequest)
			return
		}

		ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
		defer cancel()
		item, err := m.AddMagnet(ctx, body.Magnet, mode)
		if err != nil {
			if errors.Is(err, context.DeadlineExceeded) {
				http.Error(w, "metadata fetch timeout", http.StatusGatewayTimeout)
				return
			}
			log.Printf("add magnet error: %v", err)
			http.Error(w, "failed to add torrent", http.StatusBadGateway)
			return
		}
		info := m.Snapshot(item, true)
		writeJSON(w, http.StatusCreated, info)
	}
}

func handleListTorrents(m *ztorrent.Manager) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		items := m.List()
		out := make([]ztorrent.TorrentInfo, 0, len(items))
		for _, it := range items {
			out = append(out, m.Snapshot(it, false))
		}
		writeJSON(w, http.StatusOK, out)
	}
}

func handleGetTorrent(m *ztorrent.Manager) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		item, ok := m.Get(id)
		if !ok {
			http.NotFound(w, r)
			return
		}
		writeJSON(w, http.StatusOK, m.Snapshot(item, true))
	}
}

func handleDeleteTorrent(m *ztorrent.Manager) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		deleteFiles := false
		if v := r.URL.Query().Get("deleteFiles"); v != "" {
			deleteFiles = v == "1" || strings.EqualFold(v, "true")
		}
		if err := m.Remove(id, deleteFiles); err != nil {
			if errors.Is(err, ztorrent.ErrNotFound) {
				http.NotFound(w, r)
				return
			}
			log.Printf("remove torrent error: %v", err)
			http.Error(w, "failed to remove torrent", http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}
