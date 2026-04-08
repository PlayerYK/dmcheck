package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"regexp"
	"strings"
	"sync"

	"github.com/redis/go-redis/v9"
)

var validKeyword = regexp.MustCompile(`^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?$`)

type ErrorResponse struct {
	Error string `json:"error"`
}

func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, ErrorResponse{Error: msg})
}

func stripSpaces(s string) string {
	var b strings.Builder
	for _, c := range s {
		if c != ' ' && c != '\t' && c != '\u3000' {
			b.WriteRune(c)
		}
	}
	return b.String()
}

func handleSearch(rdb *redis.Client) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			writeError(w, http.StatusMethodNotAllowed, "method not allowed")
			return
		}

		keyword := stripSpaces(r.URL.Query().Get("keyword"))
		if keyword == "" {
			writeError(w, http.StatusBadRequest, "keyword is required")
			return
		}

		hasTLD := strings.Contains(keyword, ".") && isAlpha(keyword[strings.LastIndex(keyword, ".")+1:])

		if !hasTLD {
			if len(keyword) > 63 || !validKeyword.MatchString(keyword) {
				writeError(w, http.StatusBadRequest, "invalid keyword: only letters, digits and hyphens allowed, max 63 chars")
				return
			}
		}

		tldParam := strings.TrimSpace(r.URL.Query().Get("tlds"))
		var tlds []string
		if !hasTLD {
			if tldParam != "" {
				for _, t := range strings.Split(tldParam, ",") {
					t = strings.TrimSpace(t)
					if t != "" {
						tlds = append(tlds, t)
					}
				}
			}
			if len(tlds) == 0 {
				tlds = DefaultTLDs
			}
		}

		stream := r.URL.Query().Get("stream") == "true"

		if stream {
			handleSearchSSE(w, r, rdb, keyword, hasTLD, tlds)
			return
		}

		var results []DomainResult
		if hasTLD {
			result := checkWithCache(r.Context(), rdb, keyword)
			results = []DomainResult{result}
		} else {
			var uncached []string
			cachedMap := make(map[string]DomainResult)
			for _, tld := range tlds {
				domain := keyword + "." + tld
				if cached, ok := getCache(r.Context(), rdb, domain); ok {
					cachedMap[domain] = cached
				} else {
					uncached = append(uncached, tld)
				}
			}
			if len(uncached) > 0 {
				fresh := SearchDomains(keyword, uncached)
				for _, res := range fresh {
					cachedMap[res.Domain] = res
					setCache(r.Context(), rdb, res.Domain, res)
				}
			}
			results = make([]DomainResult, 0, len(tlds))
			for _, tld := range tlds {
				domain := keyword + "." + tld
				if res, ok := cachedMap[domain]; ok {
					results = append(results, res)
				}
			}
		}

		showAvailable := r.URL.Query().Get("available") == "true"
		showRegistered := r.URL.Query().Get("registered") == "true"
		if showAvailable {
			results = filterByStatus(results, "available")
		} else if showRegistered {
			results = filterByStatus(results, "registered")
		}

		for i := range results {
			results[i].RawWhois = ""
		}
		writeJSON(w, http.StatusOK, results)
	}
}

func handleSearchSSE(w http.ResponseWriter, r *http.Request, rdb *redis.Client, keyword string, hasTLD bool, tlds []string) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		writeError(w, http.StatusInternalServerError, "streaming not supported")
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	sendEvent := func(result DomainResult) {
		result.RawWhois = ""
		data, _ := json.Marshal(result)
		fmt.Fprintf(w, "data: %s\n\n", data)
		flusher.Flush()
	}

	if hasTLD {
		result := checkWithCache(r.Context(), rdb, keyword)
		sendEvent(result)
	} else {
		ch := make(chan DomainResult, len(tlds))
		var wg sync.WaitGroup

		for _, tld := range tlds {
			wg.Add(1)
			go func(t string) {
				defer wg.Done()
				domain := keyword + "." + t
				if cached, ok := getCache(r.Context(), rdb, domain); ok {
					ch <- cached
					return
				}
				result := CheckDomain(domain)
				setCache(r.Context(), rdb, domain, result)
				ch <- result
			}(tld)
		}

		go func() {
			wg.Wait()
			close(ch)
		}()

		for result := range ch {
			sendEvent(result)
		}
	}

	fmt.Fprintf(w, "event: done\ndata: {}\n\n")
	flusher.Flush()
}

func handleWhois(rdb *redis.Client) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			writeError(w, http.StatusMethodNotAllowed, "method not allowed")
			return
		}

		domain := strings.TrimPrefix(r.URL.Path, "/api/whois/")
		domain = strings.TrimSpace(domain)

		if domain == "" || !strings.Contains(domain, ".") {
			writeError(w, http.StatusBadRequest, "invalid domain")
			return
		}

		result := checkWithCache(r.Context(), rdb, domain)
		writeJSON(w, http.StatusOK, result)
	}
}

func checkWithCache(ctx context.Context, rdb *redis.Client, domain string) DomainResult {
	if cached, ok := getCache(ctx, rdb, domain); ok {
		return cached
	}
	result := CheckDomain(domain)
	setCache(ctx, rdb, domain, result)
	return result
}

func getCache(ctx context.Context, rdb *redis.Client, domain string) (DomainResult, bool) {
	if rdb == nil {
		return DomainResult{}, false
	}
	val, err := rdb.Get(ctx, "dq:"+domain).Result()
	if err != nil {
		return DomainResult{}, false
	}
	var result DomainResult
	if err := json.Unmarshal([]byte(val), &result); err != nil {
		return DomainResult{}, false
	}
	return result, true
}

func setCache(ctx context.Context, rdb *redis.Client, domain string, result DomainResult) {
	if rdb == nil || result.Status == "unknown" {
		return
	}
	lite := DomainResult{
		Domain:     result.Domain,
		Status:     result.Status,
		Registered: result.Registered,
		Expires:    result.Expires,
	}
	data, err := json.Marshal(lite)
	if err != nil {
		return
	}
	if err := rdb.Set(ctx, "dq:"+domain, data, CacheTTL).Err(); err != nil {
		log.Printf("redis SET error for %s: %v", domain, err)
	}
}

func filterByStatus(results []DomainResult, status string) []DomainResult {
	filtered := make([]DomainResult, 0, len(results))
	for _, r := range results {
		if r.Status == status {
			filtered = append(filtered, r)
		}
	}
	return filtered
}

func isAlpha(s string) bool {
	if s == "" {
		return false
	}
	for _, c := range s {
		if !((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z')) {
			return false
		}
	}
	return true
}
