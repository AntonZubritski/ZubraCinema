package torrent

import (
	"context"
	"errors"
	"log"
	"mime"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	atorrent "github.com/anacrolix/torrent"

	"github.com/AntonZubritski/ZubraCinema/internal/sparse"
)

var (
	ErrNotFound          = errors.New("torrent not found")
	ErrHasActiveTorrents = errors.New("active torrents present; remove them first")
)

const (
	ModeStream   = "stream"
	ModeDownload = "download"
)

type Item struct {
	T       *atorrent.Torrent
	AddedAt time.Time
	Mode    string

	mu              sync.Mutex
	lastSampledAt   time.Time
	lastSampledRead int64
	lastRate        int64
}

type Manager struct {
	cli         *atorrent.Client
	downloadDir string

	mu    sync.Mutex
	items map[string]*Item
}

func New(downloadDir string) (*Manager, error) {
	if err := os.MkdirAll(downloadDir, 0o755); err != nil {
		return nil, err
	}
	// Sweep leftover files from previous runs. The manager doesn't persist
	// its items map across restarts, so any directory/file in here is an
	// orphan: typically a stream torrent whose unmount-time delete didn't
	// beat a Windows file-lock at exit, or a download-mode torrent the
	// user closed the app on. Either way the buffer folder is ephemeral
	// by design — wipe it before anacrolix starts so we don't accumulate
	// dead gigabytes.
	sweepBufferDir(downloadDir)
	cli, err := newClient(downloadDir)
	if err != nil {
		return nil, err
	}
	return &Manager{
		cli:         cli,
		downloadDir: downloadDir,
		items:       make(map[string]*Item),
	}, nil
}

// sweepBufferDir removes every entry inside dir, logging anything that
// can't be deleted (stuck file handle from a still-running zombie process,
// permission issue, etc.). dir itself is preserved so anacrolix can
// continue to use it.
func sweepBufferDir(dir string) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return
	}
	removed := 0
	for _, e := range entries {
		path := filepath.Join(dir, e.Name())
		if err := os.RemoveAll(path); err != nil {
			log.Printf("torrent manager: sweep %s: %v", path, err)
			continue
		}
		removed++
	}
	if removed > 0 {
		log.Printf("torrent manager: swept %d leftover entries from %s", removed, dir)
	}
}

// newClient builds a configured anacrolix/torrent client rooted at dataDir.
// Extracted so Reconfigure can rebuild a client with identical settings —
// keep this in sync with any new config knobs.
func newClient(dataDir string) (*atorrent.Client, error) {
	cfg := atorrent.NewDefaultClientConfig()
	cfg.DataDir = dataDir
	cfg.Seed = true
	cfg.NoUpload = false
	cfg.DisableIPv6 = false
	if v := os.Getenv("ZUBRACINEMA_BT_PORT"); v != "" {
		if p, err := strconv.Atoi(v); err == nil && p >= 0 && p < 65536 {
			cfg.ListenPort = p
		}
	}
	return atorrent.NewClient(cfg)
}

// DownloadDir returns the path the manager is currently writing torrent
// data to.
func (m *Manager) DownloadDir() string {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.downloadDir
}

// Reconfigure swaps the underlying client to write into newDir. It is only
// safe to call when the manager has zero active torrents — otherwise
// ErrHasActiveTorrents is returned and the caller is expected to surface
// "remove your torrents first" to the user.
//
// The old client is closed before the new one is created, so any sockets it
// held are released. If the new client fails to start, the manager is left
// in a degraded state (cli == nil) and the error bubbles up; in practice
// the only realistic failure is an OS-level "can't bind port" which the
// caller can retry by trying a different folder or restarting the app.
func (m *Manager) Reconfigure(newDir string) error {
	if newDir == "" {
		return errors.New("downloads dir is empty")
	}
	if err := os.MkdirAll(newDir, 0o755); err != nil {
		return err
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if len(m.items) > 0 {
		return ErrHasActiveTorrents
	}
	if m.downloadDir == newDir {
		return nil
	}
	if errs := m.cli.Close(); len(errs) > 0 {
		// Closing returns errors per-torrent; with no items, this should
		// be empty. Log defensively if it isn't.
		log.Printf("torrent manager: close old client: %v", errors.Join(errs...))
	}
	cli, err := newClient(newDir)
	if err != nil {
		return err
	}
	m.cli = cli
	m.downloadDir = newDir
	return nil
}

func (m *Manager) AddMagnet(ctx context.Context, magnet, mode string) (*Item, error) {
	if mode != ModeDownload {
		mode = ModeStream
	}
	t, err := m.cli.AddMagnet(magnet)
	if err != nil {
		return nil, err
	}
	select {
	case <-t.GotInfo():
	case <-ctx.Done():
		t.Drop()
		return nil, ctx.Err()
	}
	// Pre-create files as sparse on Windows so partial downloads don't
	// reserve the full final size on disk. anacrolix's default storage
	// doesn't set FSCTL_SET_SPARSE, and NTFS treats writes at random
	// offsets as gap-filling allocations — a half-downloaded 24 GB
	// torrent ends up consuming the full 24 GB. No-op on POSIX.
	m.precreateSparse(t)
	id := t.InfoHash().HexString()
	m.mu.Lock()
	existing, ok := m.items[id]
	if ok {
		// Promote stream→download if requested; never demote.
		if mode == ModeDownload && existing.Mode != ModeDownload {
			existing.Mode = ModeDownload
			t := existing.T
			m.mu.Unlock()
			t.DownloadAll()
			return existing, nil
		}
		m.mu.Unlock()
		return existing, nil
	}
	item := &Item{T: t, AddedAt: time.Now(), Mode: mode}
	m.items[id] = item
	m.mu.Unlock()
	if mode == ModeDownload {
		t.DownloadAll()
	}
	return item, nil
}

func (m *Manager) Get(id string) (*Item, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	it, ok := m.items[id]
	return it, ok
}

func (m *Manager) List() []*Item {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([]*Item, 0, len(m.items))
	for _, it := range m.items {
		out = append(out, it)
	}
	return out
}

func (m *Manager) Remove(id string, deleteFiles bool) error {
	m.mu.Lock()
	item, ok := m.items[id]
	if !ok {
		m.mu.Unlock()
		return ErrNotFound
	}
	delete(m.items, id)
	name := item.T.Name()
	m.mu.Unlock()

	item.T.Drop()
	if deleteFiles && name != "" {
		path := filepath.Join(m.downloadDir, name)
		// Run the delete in the background. ffmpeg / HTTP stream readers
		// often hold file handles for a few seconds after Drop returns
		// (Windows ERROR_SHARING_VIOLATION); we don't want the API call
		// hung on that. The next-startup sweep is the safety net for
		// anything we still can't remove within the budget.
		go removeAllWithRetry(path)
	}
	return nil
}

// removeAllWithRetry retries os.RemoveAll for up to 60 seconds, with a
// 500ms gap between attempts. The long budget covers Windows file-lock
// situations where ffmpeg / HTTP streams haven't released their handles
// yet. If it still fails after the budget, we log loudly and rely on the
// startup sweep to clean it next time.
//
// On Linux/macOS the first attempt almost always succeeds (POSIX unlink
// works on open files); the retry loop is cheap.
func removeAllWithRetry(path string) {
	deadline := time.Now().Add(60 * time.Second)
	for {
		if err := os.RemoveAll(path); err == nil {
			return
		} else if time.Now().After(deadline) {
			log.Printf("torrent manager: remove %s gave up after retries: %v", path, err)
			return
		}
		time.Sleep(500 * time.Millisecond)
	}
}

func (m *Manager) Close() error {
	// Snapshot current items so we can clean their data dirs after the
	// torrents are dropped. The client.Close() below also drops them, but
	// it doesn't expose names back to us.
	m.mu.Lock()
	names := make([]string, 0, len(m.items))
	for _, it := range m.items {
		if n := it.T.Name(); n != "" {
			names = append(names, n)
		}
	}
	m.items = make(map[string]*Item)
	m.mu.Unlock()

	clientErrs := m.cli.Close()

	// Synchronous cleanup of leftover dirs. Process is shutting down, so
	// goroutines wouldn't survive — we have to do this inline. 6 attempts
	// over ~3 seconds covers the typical Windows lock-release window.
	// What's still stuck is the next-startup sweep's problem.
	for _, name := range names {
		path := filepath.Join(m.downloadDir, name)
		for i := 0; i < 6; i++ {
			if err := os.RemoveAll(path); err == nil {
				break
			}
			time.Sleep(500 * time.Millisecond)
		}
	}

	if len(clientErrs) > 0 {
		return errors.Join(clientErrs...)
	}
	return nil
}

// Snapshot returns a TorrentInfo for the given item. If includeFiles is true,
// per-file info is populated.
func (m *Manager) Snapshot(item *Item, includeFiles bool) TorrentInfo {
	t := item.T
	id := t.InfoHash().HexString()
	totalSize := t.Length()
	completed := t.BytesCompleted()
	progress := 0.0
	if totalSize > 0 {
		progress = float64(completed) / float64(totalSize)
	}

	stats := t.Stats()
	readData := stats.BytesReadUsefulData.Int64()
	rate := item.sampleRate(readData)
	peers := stats.ActivePeers

	info := TorrentInfo{
		ID:           id,
		Name:         t.Name(),
		TotalSize:    totalSize,
		Progress:     progress,
		DownloadRate: rate,
		Peers:        peers,
		Mode:         item.Mode,
	}

	if includeFiles {
		files := t.Files()
		info.Files = make([]FileInfo, 0, len(files))
		for i, f := range files {
			fp := 0.0
			if f.Length() > 0 {
				fp = float64(f.BytesCompleted()) / float64(f.Length())
			}
			ctype := mime.TypeByExtension(filepath.Ext(f.DisplayPath()))
			var mt *string
			if ctype != "" {
				m := ctype
				mt = &m
			}
			info.Files = append(info.Files, FileInfo{
				Idx:      i,
				Path:     f.DisplayPath(),
				Size:     f.Length(),
				MimeType: mt,
				Progress: fp,
			})
		}
	}
	return info
}

func (it *Item) sampleRate(currentBytes int64) int64 {
	it.mu.Lock()
	defer it.mu.Unlock()
	now := time.Now()
	if it.lastSampledAt.IsZero() {
		it.lastSampledAt = now
		it.lastSampledRead = currentBytes
		return 0
	}
	dt := now.Sub(it.lastSampledAt).Seconds()
	if dt < 0.5 {
		return it.lastRate
	}
	delta := currentBytes - it.lastSampledRead
	if delta < 0 {
		delta = 0
	}
	rate := int64(float64(delta) / dt)
	it.lastSampledAt = now
	it.lastSampledRead = currentBytes
	it.lastRate = rate
	return rate
}

// precreateSparse pre-creates each file in the torrent and flips the NTFS
// sparse bit. Mirrors anacrolix's default file-storage path layout:
//   - single-file torrent (one file, one path component) → DataDir/<file>
//   - everything else → DataDir/<torrent_name>/<file_path...>
//
// Errors are logged and swallowed: sparse is an optimisation, not a
// correctness requirement, and a non-NTFS volume will reject the ioctl.
func (m *Manager) precreateSparse(t *atorrent.Torrent) {
	files := t.Files()
	if len(files) == 0 {
		return
	}
	name := t.Name()
	for _, f := range files {
		rel := f.Path()
		parts := strings.Split(rel, "/")
		var full string
		if len(files) == 1 && len(parts) == 1 {
			full = filepath.Join(m.downloadDir, rel)
		} else {
			full = filepath.Join(append([]string{m.downloadDir, name}, parts...)...)
		}
		if err := sparse.MarkSparse(full); err != nil {
			log.Printf("sparse: %s: %v", full, err)
		}
	}
}
