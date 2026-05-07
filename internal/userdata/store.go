package userdata

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	_ "modernc.org/sqlite"
)

// Store holds an open connection to the user-data SQLite database.
type Store struct {
	db *sql.DB
}

// Open opens or creates the SQLite file at path and runs schema migrations.
func Open(path string) (*Store, error) {
	dsn := fmt.Sprintf("file:%s?_pragma=foreign_keys(1)&_pragma=journal_mode(wal)&_pragma=busy_timeout(2000)", path)
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("userdata: open db: %w", err)
	}
	if err := db.Ping(); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("userdata: ping db: %w", err)
	}
	s := &Store{db: db}
	if err := s.migrate(); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("userdata: migrate: %w", err)
	}
	return s, nil
}

// Close closes the underlying database connection.
func (s *Store) Close() error {
	return s.db.Close()
}

const schema = `
CREATE TABLE IF NOT EXISTS my_reactions (
  movie_id TEXT PRIMARY KEY,
  emoji    TEXT NOT NULL,
  set_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS bookmarks (
  movie_id   TEXT PRIMARY KEY,
  title      TEXT NOT NULL,
  poster_url TEXT NOT NULL,
  year       INTEGER NOT NULL,
  added_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS history (
  movie_id     TEXT PRIMARY KEY,
  title        TEXT NOT NULL,
  poster_url   TEXT NOT NULL,
  year         INTEGER NOT NULL,
  watched_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  position_sec INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_bookmarks_added_at ON bookmarks(added_at DESC);
CREATE INDEX IF NOT EXISTS idx_history_watched_at ON history(watched_at DESC);
`

func (s *Store) migrate() error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.Exec(schema); err != nil {
		return err
	}
	return tx.Commit()
}

// Snapshot holds the display metadata stored alongside bookmarks and history
// entries so listings can render cards without re-querying trackers.
type Snapshot struct {
	Title     string
	PosterURL string
	Year      int
}

// Progress holds a single watch-position sample.
type Progress struct {
	AtSec int
	When  time.Time
}

// BookmarkItem is the wire/storage shape for a bookmarked movie.
type BookmarkItem struct {
	MovieID   string    `json:"movieId"`
	Title     string    `json:"title"`
	PosterURL string    `json:"posterUrl"`
	Year      int       `json:"year"`
	AddedAt   time.Time `json:"addedAt"`
}

// HistoryItem is the wire/storage shape for a history entry.
type HistoryItem struct {
	MovieID   string    `json:"movieId"`
	Title     string    `json:"title"`
	PosterURL string    `json:"posterUrl"`
	Year      int       `json:"year"`
	WatchedAt time.Time `json:"watchedAt"`
	AtSec     int       `json:"atSec"`
}

// MyReaction returns the user's reaction emoji for movieID ("" if none).
func (s *Store) MyReaction(ctx context.Context, movieID string) (string, error) {
	var emoji string
	err := s.db.QueryRowContext(ctx,
		`SELECT emoji FROM my_reactions WHERE movie_id = ?`, movieID,
	).Scan(&emoji)
	if err == sql.ErrNoRows {
		return "", nil
	}
	if err != nil {
		return "", fmt.Errorf("userdata: MyReaction: %w", err)
	}
	return emoji, nil
}

// SetReaction sets or clears (emoji=="") the user's reaction for movieID.
func (s *Store) SetReaction(ctx context.Context, movieID, emoji string) error {
	if emoji == "" {
		_, err := s.db.ExecContext(ctx,
			`DELETE FROM my_reactions WHERE movie_id = ?`, movieID,
		)
		return err
	}
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO my_reactions (movie_id, emoji, set_at)
		 VALUES (?, ?, CURRENT_TIMESTAMP)
		 ON CONFLICT(movie_id) DO UPDATE SET emoji=excluded.emoji, set_at=excluded.set_at`,
		movieID, emoji,
	)
	return err
}

// IsBookmarked reports whether movieID is currently bookmarked.
func (s *Store) IsBookmarked(ctx context.Context, movieID string) (bool, error) {
	var count int
	err := s.db.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM bookmarks WHERE movie_id = ?`, movieID,
	).Scan(&count)
	if err != nil {
		return false, fmt.Errorf("userdata: IsBookmarked: %w", err)
	}
	return count > 0, nil
}

// SetBookmark toggles the bookmark for movieID on or off. When on=true,
// snapshot fields are stored so ListBookmarks can render cards without
// re-querying trackers. When on=false, the row is removed.
func (s *Store) SetBookmark(ctx context.Context, movieID string, on bool, snapshot Snapshot) error {
	return s.setBookmarkAt(ctx, movieID, on, snapshot, time.Time{})
}

// SetBookmarkAt is like SetBookmark but accepts an explicit timestamp for
// testing purposes. A zero addedAt uses CURRENT_TIMESTAMP.
func (s *Store) SetBookmarkAt(ctx context.Context, movieID string, on bool, snapshot Snapshot, addedAt time.Time) error {
	return s.setBookmarkAt(ctx, movieID, on, snapshot, addedAt)
}

func (s *Store) setBookmarkAt(ctx context.Context, movieID string, on bool, snapshot Snapshot, addedAt time.Time) error {
	if !on {
		_, err := s.db.ExecContext(ctx,
			`DELETE FROM bookmarks WHERE movie_id = ?`, movieID,
		)
		return err
	}
	if addedAt.IsZero() {
		_, err := s.db.ExecContext(ctx,
			`INSERT INTO bookmarks (movie_id, title, poster_url, year, added_at)
			 VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
			 ON CONFLICT(movie_id) DO UPDATE SET title=excluded.title, poster_url=excluded.poster_url, year=excluded.year`,
			movieID, snapshot.Title, snapshot.PosterURL, snapshot.Year,
		)
		return err
	}
	ts := addedAt.UTC().Format("2006-01-02 15:04:05")
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO bookmarks (movie_id, title, poster_url, year, added_at)
		 VALUES (?, ?, ?, ?, ?)
		 ON CONFLICT(movie_id) DO UPDATE SET title=excluded.title, poster_url=excluded.poster_url, year=excluded.year, added_at=excluded.added_at`,
		movieID, snapshot.Title, snapshot.PosterURL, snapshot.Year, ts,
	)
	return err
}

// LastWatched returns the most recent progress for movieID.
// Returns ({}, false, nil) when nothing has been recorded yet.
func (s *Store) LastWatched(ctx context.Context, movieID string) (Progress, bool, error) {
	var p Progress
	var watchedAt string
	err := s.db.QueryRowContext(ctx,
		`SELECT position_sec, watched_at FROM history WHERE movie_id = ?`, movieID,
	).Scan(&p.AtSec, &watchedAt)
	if err == sql.ErrNoRows {
		return Progress{}, false, nil
	}
	if err != nil {
		return Progress{}, false, fmt.Errorf("userdata: LastWatched: %w", err)
	}
	// SQLite stores timestamps as text; try a few common layouts.
	t, parseErr := parseTimestamp(watchedAt)
	if parseErr != nil {
		return Progress{}, false, fmt.Errorf("userdata: LastWatched parse time %q: %w", watchedAt, parseErr)
	}
	p.When = t
	return p, true, nil
}

// SaveProgress upserts the watch position for movieID. Snapshot fields are
// stored on first insert; on update only atSec and watched_at are refreshed.
func (s *Store) SaveProgress(ctx context.Context, movieID string, atSec int, snapshot Snapshot) error {
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO history (movie_id, title, poster_url, year, watched_at, position_sec)
		 VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, ?)
		 ON CONFLICT(movie_id) DO UPDATE SET watched_at=CURRENT_TIMESTAMP, position_sec=excluded.position_sec`,
		movieID, snapshot.Title, snapshot.PosterURL, snapshot.Year, atSec,
	)
	return err
}

// ListBookmarks returns all bookmarks ordered by added_at DESC.
func (s *Store) ListBookmarks(ctx context.Context) ([]BookmarkItem, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT movie_id, title, poster_url, year, added_at FROM bookmarks ORDER BY added_at DESC`,
	)
	if err != nil {
		return nil, fmt.Errorf("userdata: ListBookmarks: %w", err)
	}
	defer rows.Close()

	var items []BookmarkItem
	for rows.Next() {
		var b BookmarkItem
		var addedAt string
		if err := rows.Scan(&b.MovieID, &b.Title, &b.PosterURL, &b.Year, &addedAt); err != nil {
			return nil, fmt.Errorf("userdata: ListBookmarks scan: %w", err)
		}
		t, parseErr := parseTimestamp(addedAt)
		if parseErr != nil {
			return nil, fmt.Errorf("userdata: ListBookmarks parse time %q: %w", addedAt, parseErr)
		}
		b.AddedAt = t
		items = append(items, b)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("userdata: ListBookmarks rows: %w", err)
	}
	return items, nil
}

// ListHistory returns all history rows ordered by watched_at DESC.
func (s *Store) ListHistory(ctx context.Context) ([]HistoryItem, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT movie_id, title, poster_url, year, watched_at, position_sec FROM history ORDER BY watched_at DESC`,
	)
	if err != nil {
		return nil, fmt.Errorf("userdata: ListHistory: %w", err)
	}
	defer rows.Close()

	var items []HistoryItem
	for rows.Next() {
		var h HistoryItem
		var watchedAt string
		if err := rows.Scan(&h.MovieID, &h.Title, &h.PosterURL, &h.Year, &watchedAt, &h.AtSec); err != nil {
			return nil, fmt.Errorf("userdata: ListHistory scan: %w", err)
		}
		t, parseErr := parseTimestamp(watchedAt)
		if parseErr != nil {
			return nil, fmt.Errorf("userdata: ListHistory parse time %q: %w", watchedAt, parseErr)
		}
		h.WatchedAt = t
		items = append(items, h)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("userdata: ListHistory rows: %w", err)
	}
	return items, nil
}

// parseTimestamp tries to parse a SQLite timestamp string in the layouts
// SQLite uses for CURRENT_TIMESTAMP and datetime().
func parseTimestamp(s string) (time.Time, error) {
	layouts := []string{
		"2006-01-02 15:04:05",
		"2006-01-02T15:04:05Z",
		time.RFC3339,
		time.RFC3339Nano,
	}
	for _, layout := range layouts {
		if t, err := time.Parse(layout, s); err == nil {
			return t, nil
		}
	}
	return time.Time{}, fmt.Errorf("unrecognised timestamp layout")
}
