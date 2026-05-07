package userdata_test

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	"github.com/AntonZubritski/ZubraCinema/internal/userdata"
)

func openTestStore(t *testing.T) *userdata.Store {
	t.Helper()
	path := filepath.Join(t.TempDir(), "userdata.db")
	s, err := userdata.Open(path)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	t.Cleanup(func() { _ = s.Close() })
	return s
}

func TestReactions(t *testing.T) {
	s := openTestStore(t)
	ctx := context.Background()

	t.Run("set and get", func(t *testing.T) {
		if err := s.SetReaction(ctx, "m1", "fire"); err != nil {
			t.Fatal(err)
		}
		got, err := s.MyReaction(ctx, "m1")
		if err != nil {
			t.Fatal(err)
		}
		if got != "fire" {
			t.Errorf("got %q, want \"fire\"", got)
		}
	})

	t.Run("clear with empty emoji", func(t *testing.T) {
		if err := s.SetReaction(ctx, "m1", ""); err != nil {
			t.Fatal(err)
		}
		got, err := s.MyReaction(ctx, "m1")
		if err != nil {
			t.Fatal(err)
		}
		if got != "" {
			t.Errorf("got %q, want \"\"", got)
		}
	})

	t.Run("missing movie returns empty", func(t *testing.T) {
		got, err := s.MyReaction(ctx, "does-not-exist")
		if err != nil {
			t.Fatal(err)
		}
		if got != "" {
			t.Errorf("got %q, want \"\"", got)
		}
	})
}

func TestBookmarks(t *testing.T) {
	s := openTestStore(t)
	ctx := context.Background()
	snap := userdata.Snapshot{Title: "Interstellar", PosterURL: "http://img/1.jpg", Year: 2014}

	t.Run("on then off", func(t *testing.T) {
		if err := s.SetBookmark(ctx, "m2", true, snap); err != nil {
			t.Fatal(err)
		}
		ok, err := s.IsBookmarked(ctx, "m2")
		if err != nil {
			t.Fatal(err)
		}
		if !ok {
			t.Fatal("expected bookmarked=true")
		}

		if err := s.SetBookmark(ctx, "m2", false, userdata.Snapshot{}); err != nil {
			t.Fatal(err)
		}
		ok, err = s.IsBookmarked(ctx, "m2")
		if err != nil {
			t.Fatal(err)
		}
		if ok {
			t.Fatal("expected bookmarked=false after removal")
		}
	})
}

func TestProgress(t *testing.T) {
	s := openTestStore(t)
	ctx := context.Background()
	snap := userdata.Snapshot{Title: "Dune", PosterURL: "http://img/2.jpg", Year: 2021}

	t.Run("save and load", func(t *testing.T) {
		if err := s.SaveProgress(ctx, "m3", 600, snap); err != nil {
			t.Fatal(err)
		}
		p, ok, err := s.LastWatched(ctx, "m3")
		if err != nil {
			t.Fatal(err)
		}
		if !ok {
			t.Fatal("expected progress to be found")
		}
		if p.AtSec != 600 {
			t.Errorf("AtSec=%d, want 600", p.AtSec)
		}
		if p.When.IsZero() {
			t.Error("When is zero")
		}
	})

	t.Run("not found returns false", func(t *testing.T) {
		_, ok, err := s.LastWatched(ctx, "no-such-movie")
		if err != nil {
			t.Fatal(err)
		}
		if ok {
			t.Fatal("expected ok=false for unknown movie")
		}
	})
}

func TestListBookmarksOrdering(t *testing.T) {
	s := openTestStore(t)
	ctx := context.Background()

	movies := []struct {
		id   string
		snap userdata.Snapshot
	}{
		{"old", userdata.Snapshot{Title: "Old Film", PosterURL: "", Year: 2000}},
		{"mid", userdata.Snapshot{Title: "Mid Film", PosterURL: "", Year: 2010}},
		{"new", userdata.Snapshot{Title: "New Film", PosterURL: "", Year: 2022}},
	}
	// Insert with 1-second spacing so CURRENT_TIMESTAMP differs.
	base := time.Now().Add(-3 * time.Second).Truncate(time.Second)
	for i, m := range movies {
		snap := m.snap
		if err := s.SetBookmarkAt(ctx, m.id, true, snap, base.Add(time.Duration(i)*time.Second)); err != nil {
			t.Fatalf("SetBookmarkAt %s: %v", m.id, err)
		}
	}

	items, err := s.ListBookmarks(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 3 {
		t.Fatalf("got %d items, want 3", len(items))
	}
	// DESC order: newest first
	if items[0].MovieID != "new" || items[2].MovieID != "old" {
		t.Errorf("wrong order: %v %v %v", items[0].MovieID, items[1].MovieID, items[2].MovieID)
	}
}
