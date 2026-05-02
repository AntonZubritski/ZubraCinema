package torrent

import (
	"context"
	"errors"
	"mime"
	"os"
	"path/filepath"
	"sync"
	"time"

	atorrent "github.com/anacrolix/torrent"
)

var ErrNotFound = errors.New("torrent not found")

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
	cfg := atorrent.NewDefaultClientConfig()
	cfg.DataDir = downloadDir
	cfg.Seed = true
	cfg.NoUpload = false
	cfg.DisableIPv6 = false
	cli, err := atorrent.NewClient(cfg)
	if err != nil {
		return nil, err
	}
	return &Manager{
		cli:         cli,
		downloadDir: downloadDir,
		items:       make(map[string]*Item),
	}, nil
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
		_ = os.RemoveAll(filepath.Join(m.downloadDir, name))
	}
	return nil
}

func (m *Manager) Close() error {
	if errs := m.cli.Close(); len(errs) > 0 {
		return errors.Join(errs...)
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
