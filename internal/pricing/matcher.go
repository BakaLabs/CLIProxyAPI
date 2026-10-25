package pricing

import (
	"regexp"
	"strings"
)

var (
	dateSuffixRegex = regexp.MustCompile(`[-_](20\d{2}[-_]?\d{2}[-_]?\d{2}|[01]\d[0-3]\d)$`)
	versionSuffixes = []string{"-latest", "-preview", "-thinking", "-exp", "-instruct", "-chat"}
)

// NormalizeModelName cleans model name variants into a canonical form for matching.
func NormalizeModelName(name string) string {
	cleaned := strings.TrimSpace(strings.ToLower(name))
	if cleaned == "" {
		return ""
	}

	// Remove common prefixes (e.g., "openai/", "anthropic/", "deepseek/")
	if idx := strings.LastIndex(cleaned, "/"); idx >= 0 && idx < len(cleaned)-1 {
		cleaned = cleaned[idx+1:]
	}

	// Remove colon qualifiers (e.g., "gpt-4o:free", "model:tag")
	if idx := strings.Index(cleaned, ":"); idx >= 0 {
		cleaned = cleaned[:idx]
	}

	return cleaned
}

// FindPrice attempts to match a model name against the price catalog using:
// 1. Exact match with original name (case-insensitive)
// 2. Normalized name (provider prefix stripped)
// 3. Date-suffix stripped name (e.g., claude-3-5-sonnet-20241022 -> claude-3-5-sonnet)
// 4. Version/qualifier suffix stripped name (e.g., gemini-2.5-flash-preview -> gemini-2.5-flash)
// 5. Prefix/stem matching
func FindPrice(catalog map[string]ModelPrice, model string) (ModelPrice, bool) {
	if len(catalog) == 0 {
		return ModelPrice{}, false
	}

	raw := strings.TrimSpace(strings.ToLower(model))
	if raw == "" {
		return ModelPrice{}, false
	}

	// 1. Direct exact match
	if p, ok := catalog[raw]; ok {
		return p, true
	}

	// 2. Normalized name
	norm := NormalizeModelName(raw)
	if p, ok := catalog[norm]; ok {
		return p, true
	}

	// 3. Strip date suffix
	withoutDate := dateSuffixRegex.ReplaceAllString(norm, "")
	if withoutDate != norm {
		if p, ok := catalog[withoutDate]; ok {
			return p, true
		}
	}

	// 4. Strip version/preview suffixes
	for _, suffix := range versionSuffixes {
		if strings.HasSuffix(withoutDate, suffix) {
			trimmed := strings.TrimSuffix(withoutDate, suffix)
			if p, ok := catalog[trimmed]; ok {
				return p, true
			}
		}
	}

	// 5. Stem matching against catalog keys
	for k, p := range catalog {
		kNorm := NormalizeModelName(k)
		if kNorm == norm || kNorm == withoutDate {
			return p, true
		}
	}

	return ModelPrice{}, false
}
