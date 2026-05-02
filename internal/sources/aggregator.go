package sources

import (
	"context"
	"log"
	"sort"
	"sync"
	"time"
)

const (
	perSourceTimeout  = 12 * time.Second
	resultCap         = 150
	enrichmentTimeout = 10 * time.Second
	enrichmentLimit   = 8
)

type Aggregator struct {
	sources []Source
}

func NewAggregator(srcs ...Source) *Aggregator {
	return &Aggregator{sources: srcs}
}

// posterFetcherFor returns a PosterFetcher for the given source name,
// or nil if none of the registered sources match or implement it.
func (a *Aggregator) posterFetcherFor(name string) PosterFetcher {
	for _, s := range a.sources {
		if s.Name() != name {
			continue
		}
		if pf, ok := s.(PosterFetcher); ok {
			return pf
		}
	}
	return nil
}

// EnrichPosters fills PosterURL on torrents that don't already have one,
// concurrently fetching detail pages via each torrent's source.
// Soft-fails: torrents with unreachable details simply keep an empty PosterURL.
func (a *Aggregator) EnrichPosters(ctx context.Context, torrents []Torrent) []Torrent {
	if len(torrents) == 0 {
		return torrents
	}
	cctx, cancel := context.WithTimeout(ctx, enrichmentTimeout)
	defer cancel()

	sem := make(chan struct{}, enrichmentLimit)
	var wg sync.WaitGroup

	for i := range torrents {
		t := &torrents[i]
		if t.PosterURL != "" || t.DetailURL == "" {
			continue
		}
		fetcher := a.posterFetcherFor(t.Source)
		if fetcher == nil {
			continue
		}
		wg.Add(1)
		sem <- struct{}{}
		go func(t *Torrent, f PosterFetcher) {
			defer wg.Done()
			defer func() { <-sem }()
			poster, err := f.FetchPoster(cctx, t.DetailURL)
			if err == nil && poster != "" {
				t.PosterURL = poster
			}
		}(t, fetcher)
	}
	wg.Wait()
	return torrents
}

func (a *Aggregator) Search(ctx context.Context, query string) []Torrent {
	if query == "" || len(a.sources) == 0 {
		return nil
	}
	var (
		wg  sync.WaitGroup
		mu  sync.Mutex
		all []Torrent
	)
	for _, src := range a.sources {
		wg.Add(1)
		go func(s Source) {
			defer wg.Done()
			cctx, cancel := context.WithTimeout(ctx, perSourceTimeout)
			defer cancel()
			res, err := s.Search(cctx, query)
			if err != nil {
				log.Printf("source %s failed: %v", s.Name(), err)
				return
			}
			mu.Lock()
			all = append(all, res...)
			mu.Unlock()
		}(src)
	}
	wg.Wait()

	merged := dedupe(all)
	sort.SliceStable(merged, func(i, j int) bool {
		return merged[i].Seeders > merged[j].Seeders
	})
	if len(merged) > resultCap {
		merged = merged[:resultCap]
	}
	return merged
}

func dedupe(in []Torrent) []Torrent {
	byID := make(map[string]*Torrent)
	var noID []Torrent
	for i := range in {
		t := in[i]
		if t.ID == "" {
			noID = append(noID, t)
			continue
		}
		if existing, ok := byID[t.ID]; ok {
			existing.Seeders += t.Seeders
			existing.Leechers += t.Leechers
			continue
		}
		copy := t
		byID[t.ID] = &copy
	}
	out := make([]Torrent, 0, len(byID)+len(noID))
	for _, v := range byID {
		out = append(out, *v)
	}
	out = append(out, noID...)
	return out
}
