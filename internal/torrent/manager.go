package torrent

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	atorrent "github.com/anacrolix/torrent"
	"github.com/anacrolix/torrent/metainfo"

	"github.com/AntonZubritski/ZubraCinema/internal/sources"
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

	// LastAccessedAt is bumped every time Manager.Get() resolves this item
	// (i.e. on every poll from the player, every /stream / /transcode /
	// /probe request). When it's older than the orphan threshold AND the
	// torrent is in stream mode, the GC loop auto-removes it. This is the
	// only reliable cleanup path: the unmount-time DELETE from the browser
	// can be aborted by Brave/Chromium on SPA navigation even with
	// keepalive=true, and we have no other client-side hook that survives.
	LastAccessedAt time.Time

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

	gcStop chan struct{}
}

const (
	// gcInterval is how often the orphan-sweeper wakes up.
	gcInterval = 30 * time.Second
	// gcOrphanThreshold is how long a stream-mode torrent can go without
	// any /stream, /transcode, /probe or /api/torrents/{id} access before
	// the GC considers it orphaned and auto-removes it. Player polls every
	// 2s while mounted, so 90s gives plenty of slack for transient
	// network blips while still cleaning up promptly when the user
	// navigates back / closes the tab.
	gcOrphanThreshold = 90 * time.Second
	// orphanSweepInterval is how often we walk the download dir looking
	// for leftover files/dirs that don't belong to any active torrent.
	// This catches the case anacrolix's Windows storage holds file
	// handles open for minutes after Drop() — by the time this sweep
	// runs the handles have usually released.
	orphanSweepInterval = 5 * time.Minute
)

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
	mgr := &Manager{
		cli:         cli,
		downloadDir: downloadDir,
		items:       make(map[string]*Item),
		gcStop:      make(chan struct{}),
	}
	go mgr.gcLoop()
	go mgr.orphanSweepLoop()
	return mgr, nil
}

// orphanSweepLoop periodically walks the download directory and removes
// anything that doesn't belong to a currently-active torrent. Anacrolix
// on Windows can hold file handles open for several minutes past Drop(),
// past our per-torrent cleanup retry budget — this is the long-tail
// safety net that catches them once Windows finally releases the locks.
func (m *Manager) orphanSweepLoop() {
	ticker := time.NewTicker(orphanSweepInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ticker.C:
			m.sweepOrphanedDirs()
		case <-m.gcStop:
			return
		}
	}
}

// sweepOrphanedDirs scans the download dir, builds a set of paths that
// belong to currently-active torrents (so we don't accidentally nuke
// live data), then attempts to RemoveAll every other entry. Failures
// (still-locked) are logged at info level since this is best-effort —
// the next tick will try again.
//
// Skips files we know to be Manager-owned bookkeeping: `.torrent.bolt`
// (anacrolix's persistence DB), `userdata*` (the SQLite store), and
// any anacrolix-internal hidden state.
func (m *Manager) sweepOrphanedDirs() {
	keep := map[string]struct{}{
		".torrent.bolt":     {},
		"userdata":          {},
		"userdata.db-shm":   {},
		"userdata.db-wal":   {},
		"userdata-shm":      {},
		"userdata-wal":      {},
	}
	m.mu.Lock()
	for _, it := range m.items {
		if name := it.T.Name(); name != "" {
			keep[name] = struct{}{}
		}
		// Single-file torrents may have a file directly in dataDir, not
		// inside a wrapper folder. Add their leaf names too.
		for _, f := range it.T.Files() {
			rel := f.Path()
			if !strings.Contains(rel, "/") {
				keep[rel] = struct{}{}
			}
		}
	}
	m.mu.Unlock()

	entries, err := os.ReadDir(m.downloadDir)
	if err != nil {
		return
	}
	swept := 0
	stuck := 0
	for _, e := range entries {
		if _, ok := keep[e.Name()]; ok {
			continue
		}
		path := filepath.Join(m.downloadDir, e.Name())
		if err := os.RemoveAll(path); err != nil {
			stuck++
			continue
		}
		swept++
	}
	if swept > 0 || stuck > 0 {
		log.Printf("torrent manager: orphan sweep — removed %d, still locked %d", swept, stuck)
	}
}

// gcLoop periodically scans the items map for stream-mode torrents that
// haven't been touched (Get'd) by the player in `gcOrphanThreshold`,
// and removes them with deleteFiles=true. This is the safety net for
// "user clicked browser-back, the unmount-time DELETE got cancelled
// mid-flight" — without it, those torrents would leak forever.
func (m *Manager) gcLoop() {
	ticker := time.NewTicker(gcInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ticker.C:
			m.gcOrphans()
		case <-m.gcStop:
			return
		}
	}
}

// gcOrphans collects ids of stream-mode torrents that haven't been
// accessed for longer than gcOrphanThreshold, then removes them. The
// removal goes through the same Manager.Remove path the explicit
// DELETE handler uses, so cleanup goroutines are scheduled identically.
// Download-mode torrents are never auto-removed — they're explicitly
// retained even when the user navigates away from the player.
func (m *Manager) gcOrphans() {
	cutoff := time.Now().Add(-gcOrphanThreshold)
	m.mu.Lock()
	var orphans []string
	for id, it := range m.items {
		if it.Mode != ModeStream {
			continue
		}
		if it.LastAccessedAt.Before(cutoff) {
			orphans = append(orphans, id)
		}
	}
	m.mu.Unlock()
	for _, id := range orphans {
		log.Printf("torrent manager: gc — auto-removing idle stream torrent %s (no access for >%s)", id, gcOrphanThreshold)
		if err := m.Remove(id, true); err != nil && !errors.Is(err, ErrNotFound) {
			log.Printf("torrent manager: gc remove %s: %v", id, err)
		}
	}
}

// sweepBufferDir removes every entry inside dir, logging anything that
// can't be deleted (stuck file handle from a still-running zombie process,
// permission issue, etc.). dir itself is preserved so anacrolix can
// continue to use it. Each entry is retried up to 20 times (10s) — covers
// the case where the previous app process was force-killed and Windows
// hasn't released the file locks yet by the time we boot.
func sweepBufferDir(dir string) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return
	}
	removed := 0
	for _, e := range entries {
		path := filepath.Join(dir, e.Name())
		var lastErr error
		ok := false
		for i := 0; i < 20; i++ {
			if err := os.RemoveAll(path); err == nil {
				ok = true
				break
			} else {
				lastErr = err
			}
			time.Sleep(500 * time.Millisecond)
		}
		if !ok {
			log.Printf("torrent manager: sweep %s gave up: %v", path, lastErr)
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

// waitForInfo blocks until the torrent's metadata arrives or ctx fires.
// While waiting it logs peer counts every 10s so it's possible to tell
// from the server log whether peers are being discovered (and just slow)
// or whether the swarm is genuinely empty for this client. On timeout
// it does NOT call t.Drop — the underlying anacrolix torrent stays alive
// so a subsequent retry from the user hits the same idempotent slot
// and benefits from the bootstrap work already done.
func waitForInfo(ctx context.Context, t *atorrent.Torrent, kind string) error {
	hash := t.InfoHash().HexString()
	tick := time.NewTicker(10 * time.Second)
	defer tick.Stop()
	start := time.Now()
	for {
		select {
		case <-t.GotInfo():
			log.Printf("torrent manager: GotInfo for %s after %s (kind=%s)", hash, time.Since(start).Truncate(time.Second), kind)
			return nil
		case <-ctx.Done():
			s := t.Stats()
			log.Printf(
				"torrent manager: GotInfo deadline hit on %s after %s (kind=%s, totalPeers=%d, activePeers=%d, halfOpen=%d, pending=%d) — leaving torrent warming up",
				hash, time.Since(start).Truncate(time.Second), kind,
				s.TotalPeers, s.ActivePeers, s.HalfOpenPeers, s.PendingPeers,
			)
			return ctx.Err()
		case <-tick.C:
			s := t.Stats()
			log.Printf(
				"torrent manager: still warming %s (%s, kind=%s) — totalPeers=%d activePeers=%d halfOpen=%d pending=%d",
				hash, time.Since(start).Truncate(time.Second), kind,
				s.TotalPeers, s.ActivePeers, s.HalfOpenPeers, s.PendingPeers,
			)
		}
	}
}

func (m *Manager) AddMagnet(ctx context.Context, magnet, mode string) (*Item, error) {
	if mode != ModeDownload {
		mode = ModeStream
	}
	// Enrich with our public-tracker fallback list. Critical for sources
	// that only embed a single private tracker (rintor) or no trackers at
	// all (btdig DHT meta-search) — anacrolix will at least have somewhere
	// to send announce requests.
	magnet = sources.EnrichMagnet(magnet)
	t, err := m.cli.AddMagnet(magnet)
	if err != nil {
		return nil, err
	}
	if err := waitForInfo(ctx, t, "magnet"); err != nil {
		return nil, err
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
	item := &Item{T: t, AddedAt: time.Now(), Mode: mode, LastAccessedAt: time.Now()}
	m.items[id] = item
	m.mu.Unlock()
	if mode == ModeDownload {
		t.DownloadAll()
	}
	return item, nil
}

// AddTorrentFileURL fetches a .torrent file from url, decodes it, and adds
// the resulting metainfo to the underlying anacrolix client. Used by
// sources that don't publish magnet URIs (e.g. porevotorrent, which only
// exposes .torrent downloads via a redirect CDN). Same lifecycle as
// AddMagnet from there on (GotInfo wait, sparse pre-create, mode promote).
func (m *Manager) AddTorrentFileURL(ctx context.Context, url, mode string) (*Item, error) {
	if mode != ModeDownload {
		mode = ModeStream
	}
	if strings.TrimSpace(url) == "" {
		return nil, errors.New("torrent file URL is empty")
	}

	// Fetch budget — generous because some CDN redirects insert a small
	// initial wait, but we want to fail fast if the URL is dead.
	fetchCtx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(fetchCtx, http.MethodGet, url, nil)
	if err != nil {
		return nil, fmt.Errorf("torrent file request: %w", err)
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 ZubraCinema")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("torrent file fetch: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("torrent file fetch: status %d", resp.StatusCode)
	}
	// Cap body size at 4 MiB. Real .torrent metadata for a 50 GB release
	// rarely tops 200 KiB; anything larger is an ad-page misroute or a
	// broken CDN.
	body, err := io.ReadAll(io.LimitReader(resp.Body, 4*1024*1024))
	if err != nil {
		return nil, fmt.Errorf("torrent file read: %w", err)
	}

	mi, err := metainfo.Load(strings.NewReader(string(body)))
	if err != nil {
		return nil, fmt.Errorf("torrent file decode: %w", err)
	}
	t, err := m.cli.AddTorrent(mi)
	if err != nil {
		return nil, fmt.Errorf("torrent client add: %w", err)
	}
	// Reinforce the trackers the .torrent ships with by appending our
	// public list. Most external .torrents already have a couple of
	// trackers but they're often dead or rate-limited — extra ones don't
	// hurt and double the chance of finding the swarm.
	t.AddTrackers([][]string{sources.DefaultTrackers})
	if err := waitForInfo(ctx, t, "torrent-file"); err != nil {
		return nil, err
	}
	m.precreateSparse(t)
	id := t.InfoHash().HexString()
	m.mu.Lock()
	existing, ok := m.items[id]
	if ok {
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
	item := &Item{T: t, AddedAt: time.Now(), Mode: mode, LastAccessedAt: time.Now()}
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
	if ok {
		it.LastAccessedAt = time.Now()
	}
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
	// Snapshot everything we need for cleanup BEFORE Drop, while we still
	// have access to the torrent's metadata. After Drop the methods on
	// the underlying *Torrent are not safe to call. Two pieces matter:
	//   - rootDir: the directory anacrolix wrote into. For multi-file
	//     torrents this is dataDir/<name>; for single-file it's dataDir
	//     itself (the file lives directly in dataDir).
	//   - files: the absolute disk paths of every member file. Mirrors
	//     the logic in precreateSparse so we touch the same paths we
	//     pre-allocated. Crucial for the case where t.Name() differs
	//     from the actual on-disk directory because of filesystem
	//     sanitisation.
	name := item.T.Name()
	files := item.T.Files()
	multi := len(files) != 1 || strings.Contains(files[0].Path(), "/")
	var rootDir string
	if multi && name != "" {
		rootDir = filepath.Join(m.downloadDir, name)
	} else {
		rootDir = ""
	}
	filePaths := make([]string, 0, len(files))
	for _, f := range files {
		rel := f.Path()
		parts := strings.Split(rel, "/")
		var full string
		if !multi {
			full = filepath.Join(m.downloadDir, rel)
		} else {
			full = filepath.Join(append([]string{m.downloadDir, name}, parts...)...)
		}
		filePaths = append(filePaths, full)
	}
	m.mu.Unlock()

	item.T.Drop()
	if deleteFiles && (rootDir != "" || len(filePaths) > 0) {
		// Run the delete in the background. Cancelled HTTP stream
		// readers and ffmpeg subprocesses don't release their file
		// handles instantly on Windows — we retry rather than block the
		// API caller waiting on Windows' lock-release timer.
		go cleanupTorrentFiles(rootDir, filePaths)
	}
	return nil
}

// cleanupTorrentFiles is the per-torrent cleanup pipeline run after
// Manager.Remove drops a torrent with deleteFiles=true. It tries removing
// each known member file first (anacrolix may write them as `*.part`
// during streaming, so we glob for both the bare name and the .part
// variant), then removes the wrapping directory if any. This is more
// reliable than a single RemoveAll on a presumed root path: if t.Name()
// disagrees with what's on disk because of filesystem sanitisation, we
// still hit the right files via their absolute paths.
//
// 5-second initial sleep covers the worst-case Windows lock-release
// window for ffmpeg subprocess termination + HTTP stream-reader teardown
// that happens AFTER the API call returns. Two cleanup passes — the
// second runs 30s later as a safety net for files that were still
// locked at first-pass deadline but might be free now.
func cleanupTorrentFiles(rootDir string, filePaths []string) {
	time.Sleep(5 * time.Second)
	if !runCleanupPass("first", rootDir, filePaths) {
		// First pass left something behind. Try once more after 30s —
		// by then any zombie ffmpeg has definitely been reaped and the
		// OS has released even the most stubborn locks.
		time.Sleep(30 * time.Second)
		runCleanupPass("retry", rootDir, filePaths)
	}
}

// runCleanupPass is one full removal sweep — files first, then the
// wrapping dir. Returns true when nothing's left on disk for this
// torrent. Per-file retry budget is bounded so a wedged handle on a
// single file doesn't block other torrents' cleanup.
func runCleanupPass(label, rootDir string, filePaths []string) bool {
	log.Printf("torrent manager: cleanup %s starting (rootDir=%q, files=%d)", label, rootDir, len(filePaths))
	deadline := time.Now().Add(2 * time.Minute)
	pending := make([]string, 0, len(filePaths)*2)
	for _, p := range filePaths {
		pending = append(pending, p, p+".part")
	}
	for time.Now().Before(deadline) {
		stillStuck := pending[:0]
		for _, p := range pending {
			if _, err := os.Stat(p); err != nil {
				continue
			}
			if err := os.Remove(p); err != nil {
				stillStuck = append(stillStuck, p)
			}
		}
		pending = stillStuck
		if len(pending) == 0 {
			break
		}
		time.Sleep(500 * time.Millisecond)
	}
	if len(pending) > 0 {
		log.Printf("torrent manager: cleanup %s: %d files still locked", label, len(pending))
		for _, p := range pending {
			log.Printf("  stuck: %s", p)
		}
	}

	if rootDir == "" {
		log.Printf("torrent manager: cleanup %s done (single-file torrent, no root dir)", label)
		return len(pending) == 0
	}

	// Phase 2: remove the wrapping directory. We've already individually
	// nuked the files we know about (anacrolix-tracked); whatever's left
	// inside rootDir is sidecar metadata or transient lock state. Try in
	// this order: full RemoveAll → log + RemoveAll any leftover entries
	// individually → os.Remove on the now-hopefully-empty dir. Keep
	// retrying until the deadline. The most common reason RemoveAll
	// fails immediately after Phase 1 is a still-open directory handle
	// from File Explorer or anacrolix's storage backend; both release
	// within a few seconds.
	for time.Now().Before(deadline) {
		err := os.RemoveAll(rootDir)
		if err == nil {
			log.Printf("torrent manager: cleanup %s done — removed %s", label, rootDir)
			return true
		}
		if os.IsNotExist(err) {
			log.Printf("torrent manager: cleanup %s: rootDir %s already gone", label, rootDir)
			return true
		}

		// Diagnostic: if RemoveAll failed, list what's still inside so we
		// know whether it's leftover files or just a transient dir lock.
		// Then attempt to remove children individually — that often gets
		// past a stuck child.
		if entries, derr := os.ReadDir(rootDir); derr == nil {
			if len(entries) == 0 {
				// Empty dir, pure handle-lock case. Plain os.Remove uses
				// the same RemoveDirectoryW syscall as RemoveAll but is
				// cheaper to retry — no recursion.
				if rerr := os.Remove(rootDir); rerr == nil {
					log.Printf("torrent manager: cleanup %s done — removed empty dir %s", label, rootDir)
					return true
				}
			} else {
				log.Printf("torrent manager: cleanup %s: rootDir %s has %d leftover entries:", label, rootDir, len(entries))
				for _, e := range entries {
					full := filepath.Join(rootDir, e.Name())
					log.Printf("  leftover: %s (dir=%v)", full, e.IsDir())
					_ = os.RemoveAll(full)
				}
			}
		}
		time.Sleep(500 * time.Millisecond)
	}
	log.Printf("torrent manager: cleanup %s: rootDir %s still locked after retries (last error: %v)", label, rootDir, "ERROR_SHARING_VIOLATION or similar; will retry on next startup sweep")
	return false
}

// removeAllWithRetry retries os.RemoveAll for up to 5 minutes. The long
// budget covers Windows ERROR_SHARING_VIOLATION situations where ffmpeg
// sidecar processes / HTTP-stream readers haven't released their file
// handles yet — anacrolix's Drop closes its own handles synchronously
// but the OS lock release is async, and downstream readers may still be
// in the middle of a piece flush. 60s used to be enough until we added
// transcode pipes; bumping to 5 min covers worst-case ffmpeg shutdown
// on slow disks.
//
// First attempt is delayed by 1s to let Windows settle file locks after
// Drop. On POSIX this is harmless overhead — POSIX unlink works on open
// files anyway.
func removeAllWithRetry(path string) {
	time.Sleep(1 * time.Second)
	deadline := time.Now().Add(5 * time.Minute)
	var lastErr error
	for {
		if err := os.RemoveAll(path); err == nil {
			if lastErr != nil {
				log.Printf("torrent manager: remove %s succeeded after retries", path)
			}
			return
		} else {
			lastErr = err
		}
		if time.Now().After(deadline) {
			log.Printf("torrent manager: remove %s gave up after retries: %v (will retry on next startup sweep)", path, lastErr)
			return
		}
		time.Sleep(500 * time.Millisecond)
	}
}

func (m *Manager) Close() error {
	// Stop the GC loop before tearing down anything else — otherwise it
	// could race against the items map cleanup below.
	if m.gcStop != nil {
		close(m.gcStop)
		m.gcStop = nil
	}
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
	// goroutines wouldn't survive — we have to do this inline. 30 attempts
	// over ~15 seconds covers the typical Windows lock-release window when
	// ffmpeg children are still terminating. Anything still stuck after
	// that is the next-startup sweep's problem.
	for _, name := range names {
		path := filepath.Join(m.downloadDir, name)
		for i := 0; i < 30; i++ {
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

	info := TorrentInfo{
		ID:           id,
		Name:         t.Name(),
		TotalSize:    totalSize,
		Progress:     progress,
		DownloadRate: rate,
		Peers:        stats.ActivePeers,
		TotalPeers:   stats.TotalPeers,
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
