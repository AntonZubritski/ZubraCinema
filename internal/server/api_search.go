package server

import (
	"net/http"
	"strings"

	"github.com/AntonZubritski/ZubraCinema/internal/grouping"
	"github.com/AntonZubritski/ZubraCinema/internal/sources"
)

const maxGroups = 30

func handleSearch(agg *sources.Aggregator) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		q := strings.TrimSpace(r.URL.Query().Get("q"))
		if q == "" {
			writeJSON(w, http.StatusOK, []grouping.Group{})
			return
		}

		torrents := agg.Search(r.Context(), q)
		torrents = agg.EnrichPosters(r.Context(), torrents)
		groups := grouping.GroupTorrents(torrents)
		if len(groups) > maxGroups {
			groups = groups[:maxGroups]
		}
		writeJSON(w, http.StatusOK, groups)
	}
}
