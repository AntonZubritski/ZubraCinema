package server

import (
	"context"
	"errors"
	"log"
	"net/http"
	"strconv"
	"time"

	"github.com/AntonZubritski/ZubraCinema/internal/categories"
	"github.com/AntonZubritski/ZubraCinema/internal/grouping"
	"github.com/AntonZubritski/ZubraCinema/internal/sources"
	"github.com/AntonZubritski/ZubraCinema/internal/sources/rintor"
	"github.com/AntonZubritski/ZubraCinema/internal/sources/rutor"
)

const (
	categoryFetchBudget = 15 * time.Second
	categoryMaxPage     = 50
	// hasMoreThreshold — rutor pages typically carry ~50 entries; if a page
	// returns noticeably fewer, we're at (or near) the end of the listing.
	// 30 keeps us comfortably below the typical page size while tolerating
	// the odd short page.
	categoryHasMoreThreshold = 30
)

type categoryListItem struct {
	Slug    string `json:"slug"`
	Label   string `json:"label"`
	RutorID string `json:"rutorId"`
	Adult   bool   `json:"adult"`
}

type categoryPageResponse struct {
	Groups  []grouping.Group `json:"groups"`
	Page    int              `json:"page"`
	HasMore bool             `json:"hasMore"`
}

// handleListCategories serves GET /api/categories — a static list of the
// rutor categories the UI knows how to browse.
func handleListCategories() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		all := categories.All()
		out := make([]categoryListItem, 0, len(all))
		for _, c := range all {
			out = append(out, categoryListItem{
				Slug:    c.Slug,
				Label:   c.LabelRU,
				RutorID: c.RutorID,
				Adult:   c.Adult,
			})
		}
		writeJSON(w, http.StatusOK, out)
	}
}

// handleCategoryBrowse serves GET /api/category/{slug}?page=N — paginated
// browse of a single category, grouped the same way /api/search and
// /api/featured are. Dispatches to the source named in cat.Source
// (default "rutor").
func handleCategoryBrowse(rutorSrc *rutor.Source, rintorSrc *rintor.Source, agg *sources.Aggregator) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		slug := r.PathValue("slug")
		cat, ok := categories.BySlug(slug)
		if !ok {
			writeError(w, http.StatusNotFound, "unknown category")
			return
		}

		page := 0
		if v := r.URL.Query().Get("page"); v != "" {
			n, err := strconv.Atoi(v)
			if err != nil || n < 0 {
				writeError(w, http.StatusBadRequest, "bad page")
				return
			}
			// Past the safety cap, return an empty page with hasMore=false
			// so the client's infinite scroll terminates instead of
			// hammering the same upstream page over and over.
			if n > categoryMaxPage {
				writeJSON(w, http.StatusOK, categoryPageResponse{
					Groups: []grouping.Group{}, Page: n, HasMore: false,
				})
				return
			}
			page = n
		}

		ctx, cancel := context.WithTimeout(r.Context(), categoryFetchBudget)
		defer cancel()

		var (
			torrents []sources.Torrent
			err      error
			tagOnly  bool // tag listings can't paginate; force hasMore=false
		)
		switch cat.Source {
		case "rintor":
			if rintorSrc == nil {
				writeError(w, http.StatusServiceUnavailable, "rintor source not configured")
				return
			}
			torrents, err = rintorSrc.BrowseCategory(ctx, cat.RintorID, page)
		case "", "rutor":
			if cat.RutorTag != "" {
				// Tag (genre) listing: rutor's /tag/ endpoint doesn't
				// paginate, so we force hasMore=false. A page > 0 just
				// yields the same first page again, which would loop
				// infinite-scroll forever.
				tagOnly = true
				if page > 0 {
					writeJSON(w, http.StatusOK, categoryPageResponse{
						Groups: []grouping.Group{}, Page: page, HasMore: false,
					})
					return
				}
				torrents, err = rutorSrc.BrowseTag(ctx, cat.RutorID, cat.RutorTag)
			} else {
				torrents, err = rutorSrc.BrowseCategory(ctx, cat.RutorID, page)
			}
		default:
			writeError(w, http.StatusInternalServerError, "unknown source: "+cat.Source)
			return
		}
		if err != nil {
			log.Printf("category browse: %s failed (slug=%s page=%d): %v", cat.Source, slug, page, err)
			if errors.Is(err, context.Canceled) && r.Context().Err() != nil {
				return
			}
			writeError(w, http.StatusBadGateway, "upstream error: "+err.Error())
			return
		}

		hasMore := !tagOnly && len(torrents) >= categoryHasMoreThreshold

		torrents = agg.EnrichPosters(ctx, torrents)
		groups := grouping.GroupTorrents(torrents)
		if groups == nil {
			groups = []grouping.Group{}
		}

		writeJSON(w, http.StatusOK, categoryPageResponse{
			Groups:  groups,
			Page:    page,
			HasMore: hasMore,
		})
	}
}
