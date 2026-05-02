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

	"github.com/AntonZubritski/ZubraCinema/internal/launcher"
	"github.com/AntonZubritski/ZubraCinema/internal/metadata/tmdb"
	"github.com/AntonZubritski/ZubraCinema/internal/server"
	"github.com/AntonZubritski/ZubraCinema/internal/sources"
	"github.com/AntonZubritski/ZubraCinema/internal/sources/onethreethreesevenx"
	"github.com/AntonZubritski/ZubraCinema/internal/sources/rutor"
	ztorrent "github.com/AntonZubritski/ZubraCinema/internal/torrent"
)

const (
	defaultPort      = 7777
	envPort          = "ZUBRACINEMA_PORT"
	envTMDBKey       = "ZUBRACINEMA_TMDB_KEY"
	envDownloadsDir  = "ZUBRACINEMA_DOWNLOADS_DIR"
)

func defaultDownloadsDir() string {
	if v := os.Getenv(envDownloadsDir); v != "" {
		return v
	}
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

	port := flag.Int("port", startPort, "HTTP port to listen on")
	noBrowser := flag.Bool("no-browser", false, "skip auto-opening the browser")
	downloadsDir := flag.String("downloads-dir", defaultDownloadsDir(), "directory for downloaded torrent data")
	tmdbKey := flag.String("tmdb-key", os.Getenv(envTMDBKey), "TMDB API key (or set "+envTMDBKey+")")
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

	tmdbClient := tmdb.NewClient(*tmdbKey)
	if !tmdbClient.Configured() {
		log.Printf("warning: TMDB API key not set — /api/search and /api/movie/* will return 503 (set --tmdb-key or %s)", envTMDBKey)
	}

	agg := sources.NewAggregator(rutor.New(), onethreethreesevenx.New())

	addr := net.JoinHostPort("localhost", strconv.Itoa(*port))
	srv := &http.Server{
		Addr: addr,
		Handler: server.New(server.Deps{
			Manager:    mgr,
			TMDB:       tmdbClient,
			Aggregator: agg,
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
