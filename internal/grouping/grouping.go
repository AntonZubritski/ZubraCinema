package grouping

import (
	"crypto/sha256"
	"encoding/hex"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"unicode"

	"github.com/AntonZubritski/ZubraCinema/internal/sources"
)

type Group struct {
	ID        string            `json:"id"`
	Title     string            `json:"title"`
	Year      int               `json:"year"`
	PosterURL string            `json:"posterUrl"`
	Torrents  []sources.Torrent `json:"torrents"`
}

var (
	yearRe = regexp.MustCompile(`(19|20)\d{2}`)

	// Quality / source / codec / audio noise tokens. Word-boundary and
	// non-word boundaries are loose because rutor/1337x titles often use
	// dots and brackets as separators.
	noiseRe = regexp.MustCompile(`(?i)\b(2160p|1080p|720p|480p|4k|uhd|hdtv|web-?dl|web-?rip|bdrip|bluray|brrip|dvdrip|hdrip|camrip|ts|hdr10\+?|hdr|dv|dolby\s?vision|imax|remux|bdremux|repack|proper|extended|directors?\.?cut|uncut|x264|x265|h264|h265|hevc|avc|xvid|divx|aac|ac3|eac3|dts-?hd|dts|truehd|opus|flac|atmos|ma|mvo|dvo|avo|dub|sub|sdh)\b`)

	multiAudioRe = regexp.MustCompile(`(?i)\b(ddp?\d\.\d|dd\d\.\d|ddp?\d|dd\d|5\.1|7\.1|2\.0|6ch|8ch|stereo|mono)\b`)

	// Russian markers / dubbing types.
	ruNoiseRe = regexp.MustCompile(`(?i)(на\s+русском|многоголос[а-яё]*|одноголос[а-яё]*|двухголос[а-яё]*|дубляж|озвучка|перевод|лицензия|субтитры|укр\.?\s?)`)

	// Trailing release-group: "...-RARBG", "...-YTS.MX", "...[YTS]".
	releaseGroupTailRe = regexp.MustCompile(`[-_.\s]+([A-Za-z0-9._]{2,15})$`)
	bracketTailRe      = regexp.MustCompile(`[\[\(]\s*([A-Za-z0-9._\-]{2,20})\s*[\]\)]\s*$`)

	whitespaceRe = regexp.MustCompile(`\s+`)
	separatorsRe = regexp.MustCompile(`[._\-]+`)

	hasLatin = regexp.MustCompile(`[A-Za-z]`)

	otTeamRe = regexp.MustCompile(`(?i)\s+(От|от|from)\s+[A-Za-zА-Яа-яЁё][\w.]*(?:\s+(?:CLUB|TEAM|GROUP|RIPS|STUDIO))?.*$`)
)

// normalize returns (normalizedKey, displayTitle, year) for a raw torrent title.
//
// normalizedKey is lowercased / stripped, used as the grouping key.
// displayTitle is a user-facing cleaned title (case-preserved from input minus noise).
func normalize(raw string) (key, display string, year int) {
	s := strings.TrimSpace(raw)
	if s == "" {
		return "", "", 0
	}

	// Pick a half from "Russian / English" titles — prefer Latin half when both present.
	if i := strings.Index(s, " / "); i >= 0 {
		left := strings.TrimSpace(s[:i])
		right := strings.TrimSpace(s[i+3:])
		if hasLatin.MatchString(right) {
			s = right
		} else if hasLatin.MatchString(left) {
			s = left
		}
	}

	// rutor-style trailing tag lists are pipe-delimited: "...title | D | P, P2, A".
	if i := strings.Index(s, "|"); i >= 0 {
		s = strings.TrimSpace(s[:i])
	}

	// rutor-style "От RIPS CLUB" / "от HELLYWOOD" release-team marker.
	if loc := otTeamRe.FindStringIndex(s); loc != nil {
		s = strings.TrimSpace(s[:loc[0]])
	}

	// Strip leading [tag] noise.
	for {
		t := strings.TrimSpace(s)
		if strings.HasPrefix(t, "[") {
			if j := strings.Index(t, "]"); j > 0 {
				s = strings.TrimSpace(t[j+1:])
				continue
			}
		}
		break
	}

	// Extract first plausible year before noise stripping.
	if m := yearRe.FindString(s); m != "" {
		if y, err := strconv.Atoi(m); err == nil && y >= 1900 && y <= 2099 {
			year = y
		}
	}

	// Strip release-group suffix in brackets first (e.g. "[YTS.MX]").
	s = bracketTailRe.ReplaceAllString(s, "")

	// Remove all years.
	s = yearRe.ReplaceAllString(s, " ")

	// Replace common separators with spaces so noise tokens hit word boundaries.
	s = separatorsRe.ReplaceAllString(s, " ")

	// Strip Russian-language hints.
	s = ruNoiseRe.ReplaceAllString(s, " ")

	// Strip quality / codec / audio / source noise.
	s = noiseRe.ReplaceAllString(s, " ")
	s = multiAudioRe.ReplaceAllString(s, " ")

	// Trailing release-group token (e.g. "RARBG", "FGT", "YTS").
	for i := 0; i < 2; i++ {
		t := strings.TrimSpace(s)
		t = strings.TrimRight(t, " .,-_")
		if m := releaseGroupTailRe.FindStringSubmatch(t); len(m) == 2 {
			tok := m[1]
			if looksLikeReleaseGroup(tok) {
				t = strings.TrimSuffix(t, m[0])
				s = t
				continue
			}
		}
		break
	}

	// Drop residual punctuation we don't want in keys.
	s = strings.Map(func(r rune) rune {
		if r == '"' || r == '\'' || r == '«' || r == '»' || r == '“' || r == '”' {
			return -1
		}
		if r == '(' || r == ')' || r == '[' || r == ']' || r == '{' || r == '}' {
			return ' '
		}
		return r
	}, s)

	s = whitespaceRe.ReplaceAllString(s, " ")
	s = strings.TrimSpace(s)

	display = titleCase(s)
	key = strings.ToLower(s)
	key = whitespaceRe.ReplaceAllString(key, " ")
	key = strings.TrimSpace(key)
	return key, display, year
}

func looksLikeReleaseGroup(tok string) bool {
	if tok == "" {
		return false
	}
	upper := 0
	letters := 0
	for _, r := range tok {
		if unicode.IsLetter(r) {
			letters++
			if unicode.IsUpper(r) {
				upper++
			}
		}
	}
	if letters == 0 {
		return false
	}
	// Mostly-uppercase short tokens are typically release groups.
	if letters <= 6 && upper*2 >= letters {
		return true
	}
	// Dotted release tags like YTS.MX / YIFY.HD.
	if strings.Contains(tok, ".") && letters <= 12 {
		return true
	}
	return false
}

func titleCase(s string) string {
	if s == "" {
		return ""
	}
	parts := strings.Fields(s)
	for i, p := range parts {
		runes := []rune(p)
		if len(runes) == 0 {
			continue
		}
		// If the word already has any uppercase letter, keep as-is (likely an
		// acronym or stylized title like "iPhone").
		hasUp := false
		for _, r := range runes {
			if unicode.IsUpper(r) {
				hasUp = true
				break
			}
		}
		if hasUp {
			continue
		}
		runes[0] = unicode.ToUpper(runes[0])
		parts[i] = string(runes)
	}
	return strings.Join(parts, " ")
}

func groupID(key string, year int) string {
	h := sha256.Sum256([]byte(key + "|" + strconv.Itoa(year)))
	return hex.EncodeToString(h[:])[:16]
}

// GroupTorrents collapses a list of torrents into Group entries keyed by
// (normalized title, year). Torrents inside a group are sorted by seeders desc;
// groups are sorted by total seeders desc.
func GroupTorrents(torrents []sources.Torrent) []Group {
	if len(torrents) == 0 {
		return []Group{}
	}

	type bucket struct {
		group  *Group
		titles map[string]int
	}
	buckets := make(map[string]*bucket)
	order := []string{}

	for _, t := range torrents {
		key, display, year := normalize(t.Title)
		if key == "" {
			// Fallback: use raw lowercased title to avoid a single empty bucket.
			key = strings.ToLower(strings.TrimSpace(t.Title))
			display = strings.TrimSpace(t.Title)
		}
		gid := groupID(key, year)
		b, ok := buckets[gid]
		if !ok {
			b = &bucket{
				group: &Group{
					ID:    gid,
					Title: display,
					Year:  year,
				},
				titles: map[string]int{},
			}
			buckets[gid] = b
			order = append(order, gid)
		}
		b.group.Torrents = append(b.group.Torrents, t)
		if display != "" {
			b.titles[display]++
		}
	}

	out := make([]Group, 0, len(buckets))
	for _, gid := range order {
		b := buckets[gid]
		// Pick the most common display variant (stable for ties).
		var bestTitle string
		bestCount := -1
		for title, count := range b.titles {
			if count > bestCount || (count == bestCount && title < bestTitle) {
				bestTitle = title
				bestCount = count
			}
		}
		if bestTitle != "" {
			b.group.Title = bestTitle
		}

		sort.SliceStable(b.group.Torrents, func(i, j int) bool {
			return b.group.Torrents[i].Seeders > b.group.Torrents[j].Seeders
		})
		for _, t := range b.group.Torrents {
			if t.PosterURL != "" {
				b.group.PosterURL = t.PosterURL
				break
			}
		}
		out = append(out, *b.group)
	}

	sort.SliceStable(out, func(i, j int) bool {
		return totalSeeders(out[i]) > totalSeeders(out[j])
	})
	return out
}

func totalSeeders(g Group) int {
	n := 0
	for _, t := range g.Torrents {
		n += t.Seeders
	}
	return n
}
