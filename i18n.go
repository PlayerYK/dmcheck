package main

import (
	"encoding/json"
	"io/fs"
	"log"
	"regexp"
	"strings"
)

var allLangs = []string{"en", "zh", "ja", "ko", "es"}

var htmlLangMap = map[string]string{
	"en": "en",
	"zh": "zh-CN",
	"ja": "ja",
	"ko": "ko",
	"es": "es",
}

var langPages map[string][]byte

func buildLangPages(sfs fs.FS) {
	tpl, err := fs.ReadFile(sfs, "index.html")
	if err != nil {
		log.Fatalf("Cannot read embedded index.html: %v", err)
	}
	template := string(tpl)

	langPages = make(map[string][]byte, len(allLangs))
	for _, lang := range allLangs {
		data, err := fs.ReadFile(sfs, "lang/"+lang+".json")
		if err != nil {
			log.Printf("Warning: lang/%s.json not found, using template as-is", lang)
			langPages[lang] = tpl
			continue
		}
		var tr map[string]string
		if err := json.Unmarshal(data, &tr); err != nil {
			log.Printf("Warning: invalid lang/%s.json: %v", lang, err)
			langPages[lang] = tpl
			continue
		}
		page := renderTemplate(template, tr, lang)
		langPages[lang] = []byte(page)
		log.Printf("Built %s page (%d bytes)", lang, len(langPages[lang]))
	}
}

var (
	reHtmlLang    = regexp.MustCompile(`<html\s+lang="[^"]*"`)
	reLangOption  = regexp.MustCompile(`(<option\s+value="([^"]+)")\s*selected?\s*`)
)

func renderTemplate(tpl string, tr map[string]string, lang string) string {
	result := replaceI18nAttrs(tpl, tr)
	result = replacePlaceholders(result, tr)
	result = replaceContentAttrs(result, tr)

	if htmlLang, ok := htmlLangMap[lang]; ok {
		result = reHtmlLang.ReplaceAllString(result, `<html lang="`+htmlLang+`"`)
	}

	result = setSelectedLang(result, lang)
	return result
}

func replaceI18nAttrs(html string, tr map[string]string) string {
	const marker = `data-i18n="`
	var b strings.Builder
	b.Grow(len(html))
	pos := 0

	for {
		idx := strings.Index(html[pos:], marker)
		if idx < 0 {
			b.WriteString(html[pos:])
			break
		}
		idx += pos

		tagStart := strings.LastIndex(html[pos:idx], "<")
		if tagStart < 0 {
			b.WriteString(html[pos : idx+len(marker)])
			pos = idx + len(marker)
			continue
		}
		tagStart += pos

		keyStart := idx + len(marker)
		keyEnd := strings.Index(html[keyStart:], `"`)
		if keyEnd < 0 {
			b.WriteString(html[pos : keyStart])
			pos = keyStart
			continue
		}
		keyEnd += keyStart
		key := html[keyStart:keyEnd]

		tagClose := strings.Index(html[keyEnd:], ">")
		if tagClose < 0 {
			b.WriteString(html[pos : keyEnd])
			pos = keyEnd
			continue
		}
		afterOpen := keyEnd + tagClose + 1

		tagNameEnd := tagStart + 1
		for tagNameEnd < len(html) && html[tagNameEnd] != ' ' && html[tagNameEnd] != '>' && html[tagNameEnd] != '/' {
			tagNameEnd++
		}
		tagName := html[tagStart+1 : tagNameEnd]

		closeTag := "</" + tagName + ">"
		closeIdx := strings.Index(html[afterOpen:], closeTag)
		if closeIdx < 0 {
			b.WriteString(html[pos:afterOpen])
			pos = afterOpen
			continue
		}
		closeIdx += afterOpen

		val, ok := tr[key]
		if !ok {
			b.WriteString(html[pos : closeIdx+len(closeTag)])
			pos = closeIdx + len(closeTag)
			continue
		}

		b.WriteString(html[pos:afterOpen])
		b.WriteString(escapeHTML(val))
		b.WriteString(closeTag)
		pos = closeIdx + len(closeTag)
	}

	return b.String()
}

func replacePlaceholders(html string, tr map[string]string) string {
	const marker = `data-i18n-placeholder="`
	var b strings.Builder
	b.Grow(len(html))
	pos := 0

	for {
		idx := strings.Index(html[pos:], marker)
		if idx < 0 {
			b.WriteString(html[pos:])
			break
		}
		idx += pos

		keyStart := idx + len(marker)
		keyEnd := strings.Index(html[keyStart:], `"`)
		if keyEnd < 0 {
			b.WriteString(html[pos:keyStart])
			pos = keyStart
			continue
		}
		keyEnd += keyStart
		key := html[keyStart:keyEnd]

		val, ok := tr[key]
		if !ok {
			b.WriteString(html[pos : keyEnd+1])
			pos = keyEnd + 1
			continue
		}

		phMarker := `placeholder="`
		phIdx := strings.Index(html[keyEnd:], phMarker)
		if phIdx < 0 {
			b.WriteString(html[pos : keyEnd+1])
			pos = keyEnd + 1
			continue
		}
		phIdx += keyEnd
		phValStart := phIdx + len(phMarker)
		phValEnd := strings.Index(html[phValStart:], `"`)
		if phValEnd < 0 {
			b.WriteString(html[pos:phValStart])
			pos = phValStart
			continue
		}
		phValEnd += phValStart

		b.WriteString(html[pos:phValStart])
		b.WriteString(escapeHTML(val))
		pos = phValEnd
	}

	return b.String()
}

func replaceContentAttrs(html string, tr map[string]string) string {
	const marker = `data-i18n-content="`
	var b strings.Builder
	b.Grow(len(html))
	pos := 0

	for {
		idx := strings.Index(html[pos:], marker)
		if idx < 0 {
			b.WriteString(html[pos:])
			break
		}
		idx += pos

		keyStart := idx + len(marker)
		keyEnd := strings.Index(html[keyStart:], `"`)
		if keyEnd < 0 {
			b.WriteString(html[pos:keyStart])
			pos = keyStart
			continue
		}
		keyEnd += keyStart
		key := html[keyStart:keyEnd]

		val, ok := tr[key]
		if !ok {
			b.WriteString(html[pos : keyEnd+1])
			pos = keyEnd + 1
			continue
		}

		cMarker := `content="`
		cIdx := strings.Index(html[keyEnd:], cMarker)
		if cIdx < 0 {
			b.WriteString(html[pos : keyEnd+1])
			pos = keyEnd + 1
			continue
		}
		cIdx += keyEnd
		cValStart := cIdx + len(cMarker)
		cValEnd := strings.Index(html[cValStart:], `"`)
		if cValEnd < 0 {
			b.WriteString(html[pos:cValStart])
			pos = cValStart
			continue
		}
		cValEnd += cValStart

		b.WriteString(html[pos:cValStart])
		b.WriteString(escapeHTML(val))
		pos = cValEnd
	}

	return b.String()
}

func setSelectedLang(html string, lang string) string {
	const optTag = `<option value="`
	var b strings.Builder
	b.Grow(len(html))
	pos := 0

	for {
		idx := strings.Index(html[pos:], optTag)
		if idx < 0 {
			b.WriteString(html[pos:])
			break
		}
		idx += pos

		valStart := idx + len(optTag)
		valEnd := strings.Index(html[valStart:], `"`)
		if valEnd < 0 {
			b.WriteString(html[pos:valStart])
			pos = valStart
			continue
		}
		valEnd += valStart
		optVal := html[valStart:valEnd]

		closeAngle := strings.Index(html[valEnd:], ">")
		if closeAngle < 0 {
			b.WriteString(html[pos : valEnd+1])
			pos = valEnd + 1
			continue
		}
		closeAngle += valEnd

		between := html[valEnd+1 : closeAngle]
		between = strings.Replace(between, " selected", "", 1)

		b.WriteString(html[pos : valEnd+1])
		if optVal == lang {
			b.WriteString(" selected")
		}
		b.WriteString(between)
		pos = closeAngle
	}

	return b.String()
}

func escapeHTML(s string) string {
	s = strings.ReplaceAll(s, "&", "&amp;")
	s = strings.ReplaceAll(s, "<", "&lt;")
	s = strings.ReplaceAll(s, ">", "&gt;")
	s = strings.ReplaceAll(s, `"`, "&quot;")
	return s
}
