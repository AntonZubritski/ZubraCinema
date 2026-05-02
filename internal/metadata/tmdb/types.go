package tmdb

type Movie struct {
	TmdbID        int64    `json:"tmdbId"`
	Title         string   `json:"title"`
	OriginalTitle string   `json:"originalTitle"`
	Year          *int     `json:"year"`
	Rating        float64  `json:"rating"`
	PosterURL     string   `json:"posterUrl"`
	BackdropURL   *string  `json:"backdropUrl"`
	Overview      string   `json:"overview"`
	Runtime       *int     `json:"runtime,omitempty"`
	Genres        []string `json:"genres,omitempty"`
}
