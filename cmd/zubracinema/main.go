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
	"strconv"
	"syscall"
	"time"

	"github.com/AntonZubritski/ZubraCinema/internal/launcher"
	"github.com/AntonZubritski/ZubraCinema/internal/server"
)

const (
	defaultPort = 7777
	envPort     = "ZUBRACINEMA_PORT"
)

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
	flag.Parse()

	addr := net.JoinHostPort("localhost", strconv.Itoa(*port))
	srv := &http.Server{
		Addr:    addr,
		Handler: server.New(),
	}

	serverErr := make(chan error, 1)
	go func() {
		log.Printf("ZubraCinema listening on http://%s", addr)
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
