package server

import (
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net"
	"net/http"
	"strings"

	"github.com/AntonZubritski/ZubraCinema/internal/config"
	"github.com/AntonZubritski/ZubraCinema/internal/folderpicker"
	ztorrent "github.com/AntonZubritski/ZubraCinema/internal/torrent"
)

// settingsResponse is the wire shape for GET /api/settings. It bundles the
// currently-active downloads dir together with metadata the UI needs to
// render the settings panel without making extra round-trips:
//   - configPath lets a power user know where their settings file lives
//   - free/total give a "X GB free at this location" hint
//   - activeTorrents tells the UI whether changing the dir is allowed right
//     now (the manager refuses while torrents are present)
//   - canPickFolder gates the "Browse..." button on platforms without an
//     OS-native dialog (Linux today)
type settingsResponse struct {
	DownloadsDir   string   `json:"downloadsDir"`
	ConfigPath     string   `json:"configPath"`
	Free           uint64   `json:"free"`
	Total          uint64   `json:"total"`
	ActiveTorrents int      `json:"activeTorrents"`
	CanPickFolder  bool     `json:"canPickFolder"`
	Adult          bool     `json:"adult"`
	LANAccess      bool     `json:"lanAccess"`
	TVMode         bool     `json:"tvMode"`
	// LANUrls lists every http://<ip>:<port>/ that's reachable from
	// other LAN devices when LANAccess is true. Empty when LANAccess is
	// false or no non-loopback interfaces are up. Frontend shows these
	// as copy-paste targets so the user can type them on a TV.
	LANUrls []string `json:"lanUrls"`
}

func handleGetSettings(mgr *ztorrent.Manager, configPath string, port int) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		dir := mgr.DownloadDir()
		free, total, _ := diskUsage(dir)
		// Read flags from disk on every probe — cheap (small file) and
		// keeps a stale in-memory value from drifting if the user edits
		// config.json by hand.
		var cfg config.Config
		if configPath != "" {
			if loaded, err := config.Load(configPath); err == nil {
				cfg = loaded
			}
		}
		var urls []string
		if cfg.LANAccess {
			urls = lanURLs(port)
		}
		writeJSON(w, http.StatusOK, settingsResponse{
			DownloadsDir:   dir,
			ConfigPath:     configPath,
			Free:           free,
			Total:          total,
			ActiveTorrents: len(mgr.List()),
			CanPickFolder:  folderpicker.Available(),
			Adult:          cfg.Adult,
			LANAccess:      cfg.LANAccess,
			TVMode:         cfg.TVMode,
			LANUrls:        urls,
		})
	}
}

// handleUpdateSettings accepts a partial settings update. Today only
// downloadsDir is editable; future fields land here too. We:
//  1. validate the path is non-empty and creatable
//  2. ask the manager to hot-swap to the new dir (returns 409 if torrents
//     are active — the UI translates that to "remove torrents first")
//  3. persist the new value to the config file so it survives restarts
//
// If config persistence fails after the manager swap succeeded, we still
// return 200 — the in-memory state is correct for this session, and a stale
// config file is recoverable on next launch (user just sees the old default
// and clicks save again).
func handleUpdateSettings(mgr *ztorrent.Manager, configPath string) http.HandlerFunc {
	// Pointer fields so we can distinguish "not sent" from "sent as zero".
	// The frontend may send only the field it's changing.
	type req struct {
		DownloadsDir *string `json:"downloadsDir,omitempty"`
		Adult        *bool   `json:"adult,omitempty"`
		LANAccess    *bool   `json:"lanAccess,omitempty"`
		TVMode       *bool   `json:"tvMode,omitempty"`
	}
	return func(w http.ResponseWriter, r *http.Request) {
		var body req
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeError(w, http.StatusBadRequest, "invalid JSON body")
			return
		}
		if body.DownloadsDir == nil && body.Adult == nil && body.LANAccess == nil && body.TVMode == nil {
			writeError(w, http.StatusBadRequest, "no fields to update")
			return
		}

		// Load current config first; we'll mutate just the requested fields.
		var cfg config.Config
		if configPath != "" {
			loaded, err := config.Load(configPath)
			if err != nil {
				log.Printf("settings: load existing config: %v (continuing)", err)
			} else {
				cfg = loaded
			}
		}

		newDir := cfg.DownloadsDir
		if body.DownloadsDir != nil {
			trimmed := strings.TrimSpace(*body.DownloadsDir)
			if trimmed == "" {
				writeError(w, http.StatusBadRequest, "downloadsDir is required")
				return
			}
			if err := mgr.Reconfigure(trimmed); err != nil {
				if errors.Is(err, ztorrent.ErrHasActiveTorrents) {
					writeError(w, http.StatusConflict, "remove all torrents before changing the downloads folder")
					return
				}
				writeError(w, http.StatusBadRequest, err.Error())
				return
			}
			cfg.DownloadsDir = trimmed
			newDir = trimmed
		}

		if body.Adult != nil {
			cfg.Adult = *body.Adult
		}
		if body.LANAccess != nil {
			cfg.LANAccess = *body.LANAccess
		}
		if body.TVMode != nil {
			cfg.TVMode = *body.TVMode
		}

		if configPath != "" {
			if err := config.Save(configPath, cfg); err != nil {
				log.Printf("settings: persist config: %v", err)
				writeJSON(w, http.StatusOK, map[string]any{
					"downloadsDir": newDir,
					"adult":        cfg.Adult,
					"lanAccess":    cfg.LANAccess,
					"tvMode":       cfg.TVMode,
					"warning":      "applied for this session, but failed to persist: " + err.Error(),
				})
				return
			}
		}

		writeJSON(w, http.StatusOK, map[string]any{
			"downloadsDir": newDir,
			"adult":        cfg.Adult,
			"lanAccess":    cfg.LANAccess,
			"tvMode":       cfg.TVMode,
		})
	}
}

// lanURLs walks the host's network interfaces and returns one
// http://<ip>:<port>/ string per usable IPv4 address. We skip loopback
// (no point — the user's already on it), link-local (169.254.x.x,
// non-routable), and IPv6 for now (TVs handle v4 reliably; v6 setup
// varies). The list lets the user copy a URL into their TV browser
// without having to chase down ipconfig.
func lanURLs(port int) []string {
	ifaces, err := net.Interfaces()
	if err != nil {
		return nil
	}
	var out []string
	for _, iface := range ifaces {
		if iface.Flags&net.FlagUp == 0 {
			continue
		}
		if iface.Flags&net.FlagLoopback != 0 {
			continue
		}
		addrs, err := iface.Addrs()
		if err != nil {
			continue
		}
		for _, a := range addrs {
			var ip net.IP
			switch v := a.(type) {
			case *net.IPNet:
				ip = v.IP
			case *net.IPAddr:
				ip = v.IP
			}
			if ip == nil {
				continue
			}
			ip = ip.To4()
			if ip == nil || ip.IsLoopback() || ip.IsLinkLocalUnicast() {
				continue
			}
			out = append(out, fmt.Sprintf("http://%s:%d/", ip.String(), port))
		}
	}
	return out
}

// handleFolderPicker spawns the OS-native folder dialog. We block waiting
// for the user to pick (or cancel), then return JSON. Cancel is reported as
// 204 No Content so the UI can keep its current state untouched.
//
// Long-running by definition (the dialog is modal in the user's session) —
// we trust the request context to carry the cancellation if the browser tab
// closes.
func handleFolderPicker() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !folderpicker.Available() {
			writeError(w, http.StatusNotImplemented, "folder picker not available on this OS")
			return
		}
		path, err := folderpicker.Pick(r.Context(), "Choose ZubraCinema downloads folder")
		if err != nil {
			if errors.Is(err, folderpicker.ErrCancelled) {
				w.WriteHeader(http.StatusNoContent)
				return
			}
			log.Printf("folder picker: %v", err)
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"path": path})
	}
}
