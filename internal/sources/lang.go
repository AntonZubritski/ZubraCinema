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
	// Polish detection: explicit POL tag, "Polish" word, "PL" boundary
	// (avoiding false positives on "Player", "Plus", etc. by requiring
	// non-word boundaries on both sides), and Polish-only diacritics.
	polTokenRe = regexp.MustCompile(`(?i)(\bPOL\b|polish|polski|polska|polskie|lektor|napisy\s+pl|dubbing\s+pl|(?:^|[\s\W])PL(?:[\s\W\-]|$))`)

	ruMarkerRe = regexp.MustCompile(`(?i)(MVO|DVO|AVO|Дубляж|Многоголос|Одноголос|Двухголос|Озвучка|Перевод|Лицензия|Русский|на\s+русском|\bRUS\b|\bRU\b|\|\s?D\b|\|\s?L\b|\|\s?P\b|\|\s?A\b|\|\s?2x\b|\|\s?MVO\b|\|\s?DVO\b|\|\s?AVO\b|от\s+[A-ZА-Я])`)

	langFlagsRe = regexp.MustCompile(`(?i)\b(ENG|RUS|UKR|GER|FRE|FRA|ITA|SPA|POL|JPN|KOR|CHI|CZE|TUR|HIN|POR|DUT|SWE|NOR|DAN|FIN)\b`)
)

// DetectLanguage classifies a torrent title into one of:
// "ru", "uk", "pl", "en", "multi", "other".
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

	// 2. uk — Ukrainian markers win over Russian even when Cyrillic is
	// present, since Ukrainian releases often include Russian-language
	// metadata too.
	if ukrTokenRe.MatchString(title) {
		return "uk"
	}

	// 3. pl — Polish lektor/dubbing/napisy markers; checked before the
	// Cyrillic catch-all because some Polish releases contain Cyrillic
	// in the original-name section but are clearly PL releases.
	if polTokenRe.MatchString(title) {
		return "pl"
	}

	// 4. ru — any Cyrillic letters in a torrent title from a RU tracker is
	// effectively always a Russian release (rip with RU dub, RU original, etc.).
	// Explicit MVO/DVO/AVO/etc. markers also trigger RU.
	if hasCyr {
		return "ru"
	}
	if ruMarkerRe.MatchString(title) {
		return "ru"
	}

	// 5. en
	if mostlyLatin(title) {
		return "en"
	}

	// 6. fallback
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
