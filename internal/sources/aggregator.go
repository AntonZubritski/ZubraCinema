package sources

import (
	"context"
	"log"
	"sort"
	"sync"
	"time"
)

const (
	perSourceTimeout = 8 * time.Second
	resultCap        = 30
)

type Aggregator struct {
	sources []Source
}

func NewAggregator(srcs ...Source) *Aggregator {
	return &Aggregator{sources: srcs}
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
