package main

import (
	"context"
	"errors"
	"flag"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"syscall"
	"time"

	"github.com/AntonZubritski/ZubraCinema/internal/config"
	"github.com/AntonZubritski/ZubraCinema/internal/launcher"
	"github.com/AntonZubritski/ZubraCinema/internal/metadata"
	"github.com/AntonZubritski/ZubraCinema/internal/server"
	"github.com/AntonZubritski/ZubraCinema/internal/setup"
	"github.com/AntonZubritski/ZubraCinema/internal/sources"
	"github.com/AntonZubritski/ZubraCinema/internal/sources/apibay"
	"github.com/AntonZubritski/ZubraCinema/internal/sources/btdig"
	"github.com/AntonZubritski/ZubraCinema/internal/sources/eztv"
	"github.com/AntonZubritski/ZubraCinema/internal/sources/onethreethreesevenx"
	"github.com/AntonZubritski/ZubraCinema/internal/sources/rintor"
	"github.com/AntonZubritski/ZubraCinema/internal/sources/rutor"
	"github.com/AntonZubritski/ZubraCinema/internal/sources/rutracker"
	"github.com/AntonZubritski/ZubraCinema/internal/sources/solidtorrents"
	"github.com/AntonZubritski/ZubraCinema/internal/sources/torrentscsv"
	"github.com/AntonZubritski/ZubraCinema/internal/sources/yts"
	ztorrent "github.com/AntonZubritski/ZubraCinema/internal/torrent"
	"github.com/AntonZubritski/ZubraCinema/internal/transcode"
	"github.com/AntonZubritski/ZubraCinema/internal/userdata"
)

const (
	defaultPort           = 7777
	envPort               = "ZUBRACINEMA_PORT"
	envDownloadsDir       = "ZUBRACINEMA_DOWNLOADS_DIR"
	envRutrackerLogin     = "ZUBRACINEMA_RUTRACKER_LOGIN"
	envRutrackerPassword  = "ZUBRACINEMA_RUTRACKER_PASSWORD"
)

// defaultDownloadsDirFallback is the built-in default — used when neither
// the flag, env, nor config file has provided one.
func defaultDownloadsDirFallback() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return filepath.Join(".", "ZubraCinema", "downloads")
	}
	return filepath.Join(home, "ZubraCinema", "downloads")
}

func main() {
	startPort := defaultPort
	if v := os.Getenv(envPort); v != "" {
		if p, err := strconv.Atoi(v); err == nil && p > 0 && p < 65536 {
			startPort = p
		} else {
			log.Printf("invalid %s=%q, using default %d", envPort, v, defaultPort)
		}
	}

	// Resolve the downloads dir with this priority: explicit --downloads-dir
	// flag > env var > persisted config file > built-in default. We always
	// know the configPath up front so the settings API can write back to
	// the same location regardless of how the dir was sourced this run.
	configPath := config.DefaultPath()
	cfg, err := config.Load(configPath)
	if err != nil {
		log.Printf("config load: %v (continuing with defaults)", err)
	}

	resolvedDir := defaultDownloadsDirFallback()
	if cfg.DownloadsDir != "" {
		resolvedDir = cfg.DownloadsDir
	}
	if v := os.Getenv(envDownloadsDir); v != "" {
		resolvedDir = v
	}

	port := flag.Int("port", startPort, "HTTP port to listen on")
	noBrowser := flag.Bool("no-browser", false, "skip auto-opening the browser")
	downloadsDir := flag.String("downloads-dir", resolvedDir, "directory for downloaded torrent data")
	flag.Parse()

	if err := os.MkdirAll(*downloadsDir, 0o755); err != nil {
		log.Fatalf("create downloads dir: %v", err)
	}

	mgr, err := ztorrent.New(*downloadsDir)
	if err != nil {
		log.Fatalf("init torrent manager: %v", err)
	}
	defer func() {
		if err := mgr.Close(); err != nil {
			log.Printf("torrent client close: %v", err)
		}
	}()

	rutorSrc := rutor.New()
	srcs := []sources.Source{
		rutorSrc,
		onethreethreesevenx.New(),
		apibay.New(),
		yts.New(),
	}
	if rtLogin := os.Getenv(envRutrackerLogin); rtLogin != "" {
		srcs = append(srcs, rutracker.New(rtLogin, os.Getenv(envRutrackerPassword)))
		log.Printf("rutracker source enabled (login=%s)", rtLogin)
	}
	srcs = append(srcs,
		torrentscsv.New(),
		solidtorrents.New(),
		eztv.New(),
		// btdig — DHT meta-search; covers Polish/Ukrainian releases
		// that the western trackers miss. No seeder data on its end,
		// so streamability tier on btdig-only results will be "poor".
		btdig.New(),
	)
	agg := sources.NewAggregator(srcs...)

	tc := transcode.New()
	if tc.Available() {
		log.Printf("ffmpeg available at %s — in-browser transcode enabled", tc.Path())
	} else {
		log.Printf("ffmpeg not in PATH — incompatible files will require external player")
	}

	setupMgr := setup.NewManager()

	mdClient := metadata.New(os.Getenv("TMDB_API_KEY"))
	if mdClient.Available() {
		log.Printf("TMDB metadata enabled")
	} else {
		log.Printf("TMDB metadata disabled (set TMDB_API_KEY to enable)")
	}
	omdbClient := metadata.NewOMDb(os.Getenv("OMDB_API_KEY"))
	if omdbClient.Available() {
		log.Printf("OMDb (IMDb rating) enabled")
	} else {
		log.Printf("OMDb disabled (set OMDB_API_KEY to enable)")
	}
	kpClient := metadata.NewKP(os.Getenv("KINOPOISK_DEV_API_KEY"))
	if kpClient.Available() {
		log.Printf("kinopoisk.dev (KP rating) enabled")
	} else {
		log.Printf("kinopoisk.dev disabled (set KINOPOISK_DEV_API_KEY to enable)")
	}

	// Local user-data store: SQLite file alongside the torrent data dir.
	// Failure to open is non-fatal — we just disable /api/userdata/* and
	// log; the rest of the app still works.
	udPath := filepath.Join(*downloadsDir, "userdata.db")
	udStore, udErr := userdata.Open(udPath)
	if udErr != nil {
		log.Printf("userdata store disabled: %v", udErr)
		udStore = nil
	} else {
		log.Printf("userdata store at %s", udPath)
		defer func() {
			if err := udStore.Close(); err != nil {
				log.Printf("userdata close: %v", err)
			}
		}()
	}

	// rintor.org — adult tracker; only used by 18+ category rows when the
	// Settings → Adult flag is on. Constructed unconditionally (the source
	// is cheap — just an http.Client wrapper) so toggling the flag in the
	// Settings UI takes effect without a restart.
	rintorSrc := rintor.New()

	addr := net.JoinHostPort("localhost", strconv.Itoa(*port))
	srv := &http.Server{
		Addr: addr,
		Handler: server.New(server.Deps{
			Manager:    mgr,
			Aggregator: agg,
			Rutor:      rutorSrc,
			Rintor:     rintorSrc,
			Transcoder: tc,
			Setup:      setupMgr,
			Metadata:   mdClient,
			OMDb:       omdbClient,
			KP:         kpClient,
			UserData:   udStore,
			ConfigPath: configPath,
		}),
	}

	serverErr := make(chan error, 1)
	go func() {
		log.Printf("ZubraCinema listening on http://%s", addr)
		log.Printf("downloads dir: %s", *downloadsDir)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			serverErr <- err
		}
	}()

	if !*noBrowser {
		go func() {
			time.Sleep(500 * time.Millisecond)
			url := "http://" + addr
			if err := launcher.OpenURL(url); err != nil {
				log.Printf("failed to open browser: %v", err)
			}
		}()
	}

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)

	select {
	case err := <-serverErr:
		log.Fatalf("server error: %v", err)
	case sig := <-stop:
		log.Printf("received signal %s, shutting down", sig)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		log.Printf("graceful shutdown failed: %v", err)
	}
}
