package server

import (
	"context"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/AntonZubritski/ZubraCinema/internal/grouping"
	"github.com/AntonZubritski/ZubraCinema/internal/sources"
	"github.com/AntonZubritski/ZubraCinema/internal/sources/rutor"
)

const (
	featuredCacheTTL    = 5 * time.Minute
	featuredMaxGroups   = 20
	featuredFetchBudget = 12 * time.Second
)

var hdQualities = map[string]struct{}{
	"1080P":   {},
	"4K":      {},
	"2160P":   {},
	"BDRIP":   {},
	"BLURAY":  {},
	"BRRIP":   {},
	"HDR":     {},
	"WEB-DL":  {},
	"WEBDL":   {},
	"WEB-RIP": {},
	"WEBRIP":  {},
}

type featuredCache struct {
	mu      sync.Mutex
	groups  []grouping.Group
	fetched time.Time
}

func (c *featuredCache) get() ([]grouping.Group, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.fetched.IsZero() || time.Since(c.fetched) > featuredCacheTTL {
		return nil, false
	}
	return c.groups, true
}

func (c *featuredCache) put(groups []grouping.Group) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.groups = groups
	c.fetched = time.Now()
}

func handleFeatured(rutorSrc *rutor.Source, agg *sources.Aggregator) http.HandlerFunc {
	cache := &featuredCache{}
	return func(w http.ResponseWriter, r *http.Request) {
		if cached, ok := cache.get(); ok {
			writeJSON(w, http.StatusOK, cached)
			return
		}

		ctx, cancel := context.WithTimeout(r.Context(), featuredFetchBudget)
		defer cancel()

		torrents, err := rutorSrc.BrowseLatest(ctx)
		if err != nil {
			log.Printf("featured: rutor browse failed: %v", err)
			writeJSON(w, http.StatusOK, []grouping.Group{})
			return
		}
		if len(torrents) > 40 {
			torrents = torrents[:40]
		}
		torrents = agg.EnrichPosters(ctx, torrents)
		groups := grouping.GroupTorrents(torrents)
		groups = filterHDGroups(groups)
		if len(groups) > featuredMaxGroups {
			groups = groups[:featuredMaxGroups]
		}
		if groups == nil {
			groups = []grouping.Group{}
		}
		cache.put(groups)
		writeJSON(w, http.StatusOK, groups)
	}
}

func filterHDGroups(in []grouping.Group) []grouping.Group {
	out := in[:0]
	for _, g := range in {
		if hasHDTorrent(g) {
			out = append(out, g)
		}
	}
	return out
}

func hasHDTorrent(g grouping.Group) bool {
	for _, t := range g.Torrents {
		if t.Quality == nil {
			continue
		}
		key := normalizeQuality(*t.Quality)
		if _, ok := hdQualities[key]; ok {
			return true
		}
	}
	return false
}

func normalizeQuality(q string) string {
	upper := make([]byte, 0, len(q))
	for i := 0; i < len(q); i++ {
		c := q[i]
		if c >= 'a' && c <= 'z' {
			c -= 32
		}
		upper = append(upper, c)
	}
	return string(upper)
}
