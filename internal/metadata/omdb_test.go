package metadata

import "testing"

func TestParseRating(t *testing.T) {
	t.Run("typical response", func(t *testing.T) {
		raw := omdbResponse{
			Response:   "True",
			ImdbRating: "7.6",
			ImdbVotes:  "292,431",
			Metascore:  "36",
			Ratings: []struct {
				Source string `json:"Source"`
				Value  string `json:"Value"`
			}{
				{Source: "Rotten Tomatoes", Value: "29%"},
			},
		}
		r := parseRating(raw)
		if r.ImdbRating != 7.6 {
			t.Errorf("ImdbRating: want 7.6, got %v", r.ImdbRating)
		}
		if r.ImdbVotes != 292431 {
			t.Errorf("ImdbVotes: want 292431, got %v", r.ImdbVotes)
		}
		if r.Metascore != 36 {
			t.Errorf("Metascore: want 36, got %v", r.Metascore)
		}
		if r.RottenTomatoes != 29 {
			t.Errorf("RottenTomatoes: want 29, got %v", r.RottenTomatoes)
		}
	})

	t.Run("N/A fields degrade to zero", func(t *testing.T) {
		raw := omdbResponse{
			Response:   "True",
			ImdbRating: "N/A",
			ImdbVotes:  "N/A",
			Metascore:  "N/A",
		}
		r := parseRating(raw)
		if r.ImdbRating != 0 || r.ImdbVotes != 0 || r.Metascore != 0 || r.RottenTomatoes != 0 {
			t.Errorf("expected all zeros for N/A fields, got %+v", r)
		}
	})
}

func TestValidImdbID(t *testing.T) {
	cases := []struct {
		id   string
		want bool
	}{
		{"tt0814314", true},
		{"tt1", true},
		{"tt", false},
		{"nm0814314", false},
		{"tt08abc", false},
		{"", false},
	}
	for _, c := range cases {
		if got := validImdbID(c.id); got != c.want {
			t.Errorf("validImdbID(%q) = %v, want %v", c.id, got, c.want)
		}
	}
}
