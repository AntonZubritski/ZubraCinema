package sources

import (
	"net/url"
	"regexp"
	"strconv"
	"strings"
)

const UserAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"

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
