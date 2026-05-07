// Package config persists user-level app settings (currently just the
// downloads directory) to a JSON file in the user's home directory.
//
// The file lives at $HOME/ZubraCinema/config.json — same root as the default
// downloads dir — so everything ZubraCinema writes is corralled in one place
// the user can back up or wipe.
package config

import (
	"encoding/json"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
)

// Config is the on-disk shape. Fields are JSON-tagged with omitempty so an
// older version of this app can read a newer file without crashing on
// unknown fields (though stdlib json ignores those by default).
type Config struct {
	// DownloadsDir is the directory where the torrent client stores its
	// piece data. Empty means "use the built-in default".
	DownloadsDir string `json:"downloadsDir,omitempty"`
	// Adult is the 18+ content opt-in flag. When false (default), the home
	// page hides adult categories and the corresponding sources don't
	// appear in search results. Set via the Settings UI.
	Adult bool `json:"adult,omitempty"`
}

// DefaultPath returns the canonical config-file location for the running
// user: $HOME/ZubraCinema/config.json. Returns "" if the home directory
// can't be resolved (extremely rare); callers should treat that as
// "settings persistence disabled".
func DefaultPath() string {
	home, err := os.UserHomeDir()
	if err != nil || home == "" {
		return ""
	}
	return filepath.Join(home, "ZubraCinema", "config.json")
}

// Load reads the config from path. A missing file is NOT an error — it
// returns a zero Config so callers can apply their defaults. Any other I/O
// or JSON-parse error is returned verbatim.
func Load(path string) (Config, error) {
	if path == "" {
		return Config{}, nil
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return Config{}, nil
		}
		return Config{}, err
	}
	var c Config
	if len(raw) == 0 {
		return c, nil
	}
	if err := json.Unmarshal(raw, &c); err != nil {
		return Config{}, err
	}
	return c, nil
}

// Save writes the config to path atomically — write to a sibling .tmp file,
// then rename. The rename is atomic on Windows and POSIX, so a crash mid-
// write can never leave a half-written config.json.
func Save(path string, c Config) error {
	if path == "" {
		return errors.New("config: empty path")
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	raw, err := json.MarshalIndent(c, "", "  ")
	if err != nil {
		return err
	}
	raw = append(raw, '\n')
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, raw, 0o644); err != nil {
		return err
	}
	if err := os.Rename(tmp, path); err != nil {
		// Best-effort cleanup; the tmp file is harmless if it lingers.
		_ = os.Remove(tmp)
		return err
	}
	return nil
}
