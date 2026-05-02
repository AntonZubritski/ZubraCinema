package sources

import (
	"regexp"
	"strings"
	"unicode"
)

var (
	multiTagRe       = regexp.MustCompile(`(?i)\b(MULTI|MULTILANG)\b`)
	multiAudioHintRe = regexp.MustCompile(`(?i)\b(dub|dubbed|dualaudio|dual\s?audio)\b`)

	ukrTokenRe = regexp.MustCompile(`(?i)(укр|ukrainian|українськ|\bUKR\b|(?:^|[\s\W])UA(?:[\s\W\-]|$))`)

	ruMarkerRe = regexp.MustCompile(`(?i)(MVO|DVO|AVO|Дубляж|Многоголос|Одноголос|Двухголос|Озвучка|Перевод|Лицензия|Русский|на\s+русском|\bRUS\b|\bRU\b|\|\s?D\b|\|\s?L\b|\|\s?P\b|\|\s?A\b|\|\s?2x\b|\|\s?MVO\b|\|\s?DVO\b|\|\s?AVO\b|от\s+[A-ZА-Я])`)

	langFlagsRe = regexp.MustCompile(`(?i)\b(ENG|RUS|UKR|GER|FRE|FRA|ITA|SPA|POL|JPN|KOR|CHI|CZE|TUR|HIN|POR|DUT|SWE|NOR|DAN|FIN)\b`)
)

// DetectLanguage classifies a torrent title into one of:
// "ru", "uk", "en", "multi", "other".
//
// Apply the raw (uncleaned) title for richer signal.
func DetectLanguage(title string) string {
	if title == "" {
		return "other"
	}

	hasCyr := containsCyrillic(title)

	// 1. multi
	if multiTagRe.MatchString(title) {
		return "multi"
	}
	if hasCyr && multiAudioHintRe.MatchString(title) {
		return "multi"
	}
	if flags := langFlagsRe.FindAllString(title, -1); len(flags) >= 2 {
		seen := map[string]struct{}{}
		for _, f := range flags {
			seen[strings.ToUpper(f)] = struct{}{}
		}
		if len(seen) >= 2 {
			return "multi"
		}
	}

	// 2. uk
	if ukrTokenRe.MatchString(title) {
		return "uk"
	}

	// 3. ru — any Cyrillic letters in a torrent title from a RU tracker is
	// effectively always a Russian release (rip with RU dub, RU original, etc.).
	// Explicit MVO/DVO/AVO/etc. markers also trigger RU.
	if hasCyr {
		return "ru"
	}
	if ruMarkerRe.MatchString(title) {
		return "ru"
	}

	// 4. en
	if mostlyLatin(title) {
		return "en"
	}

	// 5. fallback
	return "other"
}

func containsCyrillic(s string) bool {
	for _, r := range s {
		if unicode.Is(unicode.Cyrillic, r) {
			return true
		}
	}
	return false
}

func mostlyCyrillic(s string) bool {
	cyr, lat := letterCounts(s)
	total := cyr + lat
	if total == 0 {
		return false
	}
	return cyr*2 > total
}

func mostlyLatin(s string) bool {
	cyr, lat := letterCounts(s)
	total := cyr + lat
	if total == 0 {
		return false
	}
	return lat*2 > total
}

func letterCounts(s string) (cyr, lat int) {
	for _, r := range s {
		if !unicode.IsLetter(r) {
			continue
		}
		switch {
		case unicode.Is(unicode.Cyrillic, r):
			cyr++
		case unicode.Is(unicode.Latin, r):
			lat++
		}
	}
	return cyr, lat
}
