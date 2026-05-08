package sources

import (
	"net/url"
	"regexp"
	"strconv"
	"strings"
)

const UserAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"

// DefaultTrackers is the canonical tracker list embedded into magnet URIs we
// build ourselves. Many trackers historically embedded by sources are dead or
// rate-limited; this list focuses on currently live, public UDP/HTTPS trackers
// to improve peer discovery in sparse swarms.
var DefaultTrackers = []string{
	"udp://tracker.opentrackr.org:1337/announce",
	"udp://tracker.openbittorrent.com:6969/announce",
	"udp://open.demonii.com:1337/announce",
	"udp://open.stealth.si:80/announce",
	"udp://exodus.desync.com:6969/announce",
	"udp://tracker.torrent.eu.org:451/announce",
	"udp://tracker.dler.org:6969/announce",
	"udp://9.rarbg.com:2810/announce",
	"udp://tracker.cyberia.is:6969/announce",
	"udp://tracker.moeking.me:6969/announce",
	"udp://retracker.lanta-net.ru:2710/announce",
	"udp://opentracker.io:6969/announce",
	"udp://p4p.arenabg.com:1337/announce",
	"udp://tracker-udp.gbitt.info:80/announce",
	"udp://tracker.tiny-vps.com:6969/announce",
	"https://tracker.tamersunion.org:443/announce",
}

// BuildMagnet builds a magnet URI from an info hash (40-hex lowercase) and
// display name. Uses the default tracker list.
func BuildMagnet(infoHash, displayName string) string {
	var b strings.Builder
	b.WriteString("magnet:?xt=urn:btih:")
	b.WriteString(infoHash)
	if displayName != "" {
		b.WriteString("&dn=")
		b.WriteString(url.QueryEscape(displayName))
	}
	for _, t := range DefaultTrackers {
		b.WriteString("&tr=")
		b.WriteString(url.QueryEscape(t))
	}
	return b.String()
}

var qualityRe = regexp.MustCompile(`(?i)\b(2160p|4K|1080p|720p|480p|HDTV|WEB-?DL|BDRip|BluRay|DVDRip|HDRip|CAMRip|TS)\b`)

// DetectQuality returns a normalized quality token or nil if unknown.
func DetectQuality(title string) *string {
	m := qualityRe.FindString(title)
	if m == "" {
		return nil
	}
	upper := strings.ToUpper(m)
	switch upper {
	case "2160P", "4K":
		s := "4K"
		return &s
	case "1080P":
		s := "1080p"
		return &s
	case "720P":
		s := "720p"
		return &s
	case "480P":
		s := "480p"
		return &s
	}
	return &upper
}

// EnrichMagnet appends DefaultTrackers to an existing magnet URI as
// additional &tr= parameters, skipping any that are already present
// (case-insensitive comparison). Used to rescue magnets from sources
// that only embed a private tracker (e.g. rintor.org/bt/announce.php
// without a passkey) — without this, anacrolix has nothing to talk to
// except DHT, which can be slow or empty for niche swarms.
//
// Returns the input unchanged if it isn't a magnet URI.
func EnrichMagnet(magnet string) string {
	if !strings.HasPrefix(strings.ToLower(magnet), "magnet:") {
		return magnet
	}
	q := magnet
	if i := strings.Index(magnet, "?"); i >= 0 {
		q = magnet[i+1:]
	}
	v, err := url.ParseQuery(q)
	if err != nil {
		return magnet
	}
	have := make(map[string]struct{}, len(v["tr"]))
	for _, t := range v["tr"] {
		have[strings.ToLower(strings.TrimSpace(t))] = struct{}{}
	}
	var b strings.Builder
	b.WriteString(magnet)
	for _, t := range DefaultTrackers {
		if _, ok := have[strings.ToLower(t)]; ok {
			continue
		}
		b.WriteString("&tr=")
		b.WriteString(url.QueryEscape(t))
	}
	return b.String()
}

// MagnetInfoHash extracts the BTIH (lowercase hex) from a magnet URI.
// Returns empty string if not present.
func MagnetInfoHash(magnet string) string {
	if !strings.HasPrefix(strings.ToLower(magnet), "magnet:") {
		return ""
	}
	q := magnet
	if i := strings.Index(magnet, "?"); i >= 0 {
		q = magnet[i+1:]
	}
	v, err := url.ParseQuery(q)
	if err != nil {
		return ""
	}
	for _, xt := range v["xt"] {
		const p = "urn:btih:"
		if strings.HasPrefix(strings.ToLower(xt), p) {
			h := xt[len(p):]
			h = strings.ToLower(strings.TrimSpace(h))
			// btih can be 40-char hex or 32-char base32. We only treat 40-hex as id;
			// otherwise return the original string lowercased — caller can dedupe by it.
			return h
		}
	}
	return ""
}

var sizeRe = regexp.MustCompile(`(?i)([\d.,]+)\s*(КБ|МБ|ГБ|ТБ|KB|KIB|MB|MIB|GB|GIB|TB|TIB)\b`)

// ParseSize parses a human size like "1.4 GB" / "700 MiB" / "13.7 ГБ" → bytes.
// Returns 0 if no size unit is detected. Bare integers (e.g. comment counts) are NOT treated as bytes.
func ParseSize(s string) int64 {
	s = strings.ReplaceAll(s, " ", " ") // nbsp → space (rutor uses &nbsp;)
	s = strings.TrimSpace(s)
	if s == "" {
		return 0
	}
	m := sizeRe.FindStringSubmatch(s)
	if len(m) != 3 {
		return 0
	}
	num := strings.ReplaceAll(m[1], ",", ".")
	v, err := strconv.ParseFloat(num, 64)
	if err != nil {
		return 0
	}
	mult := int64(1)
	switch strings.ToUpper(m[2]) {
	case "КБ", "KB", "KIB":
		mult = 1024
	case "МБ", "MB", "MIB":
		mult = 1024 * 1024
	case "ГБ", "GB", "GIB":
		mult = 1024 * 1024 * 1024
	case "ТБ", "TB", "TIB":
		mult = 1024 * 1024 * 1024 * 1024
	}
	return int64(v * float64(mult))
}
