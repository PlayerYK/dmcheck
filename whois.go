package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"
)

type DomainResult struct {
	Domain       string   `json:"domain"`
	Status       string   `json:"status"`
	Registered   string   `json:"registered,omitempty"`
	Expires      string   `json:"expires,omitempty"`
	Updated      string   `json:"updated,omitempty"`
	Registrar    string   `json:"registrar,omitempty"`
	Nameservers  []string `json:"nameservers,omitempty"`
	DomainStatus []string `json:"domain_status,omitempty"`
	RawWhois     string   `json:"raw_whois,omitempty"`
}

var whoisServers = map[string]string{}

var DefaultTLDs []string

var availablePhrases = []string{
	"no match", "not found", "no data found",
	"no entries found", "is available",
	"domain not found", "status: free",
	"no object found", "object does not exist",
}

var whoisJunkPhrases = []string{
	"tld is not supported",
	"server is busy",
	"try again later",
	"access denied",
	"query rate limit",
	"rate limited",
	"too many requests",
}

func whoisQuery(domain, server string, timeout time.Duration) (string, error) {
	conn, err := net.DialTimeout("tcp", server+":43", timeout)
	if err != nil {
		return "", err
	}
	defer conn.Close()

	conn.SetDeadline(time.Now().Add(timeout))
	_, err = conn.Write([]byte(domain + "\r\n"))
	if err != nil {
		return "", err
	}

	buf, err := io.ReadAll(conn)
	if err != nil {
		return "", err
	}
	return string(buf), nil
}

func isWhoisJunk(raw string) bool {
	lower := strings.ToLower(raw)
	if strings.Contains(lower, "domain name:") || strings.Contains(lower, "creation date:") {
		return false
	}
	for _, phrase := range whoisJunkPhrases {
		if strings.Contains(lower, phrase) {
			return true
		}
	}
	trimmed := strings.TrimSpace(raw)
	if len(trimmed) < 50 && !strings.Contains(trimmed, ":") {
		return true
	}
	return false
}

func parseWhoisRaw(domain, raw string) (DomainResult, string) {
	result := DomainResult{Domain: domain, Status: "unknown"}

	if isWhoisJunk(raw) {
		return result, ""
	}

	lower := strings.ToLower(raw)

	hasReserved := strings.Contains(lower, "reserved")
	if !hasReserved {
		for _, phrase := range availablePhrases {
			if strings.Contains(lower, phrase) {
				result.Status = "available"
				return result, ""
			}
		}
	}

	result.Status = "registered"
	var nameservers []string
	var referralServer string
	hasDomainFields := false

	for _, line := range strings.Split(raw, "\n") {
		trimmed := strings.TrimSpace(line)
		ll := strings.ToLower(trimmed)

		switch {
		case containsAny(ll, "domain name:"):
			hasDomainFields = true
		case containsAny(ll, "creation date:", "registration time:", "created:"):
			hasDomainFields = true
			if result.Registered == "" {
				result.Registered = normalizeDate(extractValue(trimmed))
			}
		case containsAny(ll, "registry expiry date:", "expiration date:", "expire date:", "expiry date:", "paid-till:"):
			hasDomainFields = true
			val := extractValue(trimmed)
			if len(val) >= 8 {
				result.Expires = normalizeDate(val)
			}
		case containsAny(ll, "updated date:", "last updated:"):
			if result.Updated == "" {
				result.Updated = normalizeDate(extractValue(trimmed))
			}
		case strings.Contains(ll, "registrar:") && result.Registrar == "":
			hasDomainFields = true
			result.Registrar = extractValue(trimmed)
		case strings.Contains(ll, "domain status:"):
			hasDomainFields = true
			result.DomainStatus = append(result.DomainStatus, extractValue(trimmed))
		case containsAny(ll, "name server:", "nserver:"):
			ns := extractValue(trimmed)
			if ns != "" {
				nameservers = append(nameservers, ns)
			}
		case containsAny(ll, "registrar whois server:", "whois server:"):
			if referralServer == "" {
				referralServer = strings.ToLower(extractValue(trimmed))
			}
		}
	}

	if hasReserved && !hasDomainFields {
		result.Status = "reserved"
	}

	if len(nameservers) > 0 {
		result.Nameservers = nameservers
	}
	return result, referralServer
}

func parseWhoisResponse(domain, raw string) DomainResult {
	result, _ := parseWhoisRaw(domain, raw)
	return result
}

type rdapResponse struct {
	Events      []rdapEvent  `json:"events"`
	Entities    []rdapEntity `json:"entities"`
	Nameservers []rdapNS     `json:"nameservers"`
	Status      []string     `json:"status"`
}

type rdapEvent struct {
	EventAction string `json:"eventAction"`
	EventDate   string `json:"eventDate"`
}

type rdapEntity struct {
	Roles     []string    `json:"roles"`
	VcardArray interface{} `json:"vcardArray"`
}

type rdapNS struct {
	LdhName string `json:"ldhName"`
}

var (
	rdapBootstrap     map[string]string
	rdapBootstrapOnce sync.Once
	rdapSem           = make(chan struct{}, 5)

	whoisServerMu    sync.Mutex
	whoisServerLocks = make(map[string]*sync.Mutex)
	whoisPacerMu     sync.Mutex
	whoisLastQuery   time.Time
)

func getWhoisLock(server string) *sync.Mutex {
	whoisServerMu.Lock()
	defer whoisServerMu.Unlock()
	if m, ok := whoisServerLocks[server]; ok {
		return m
	}
	m := &sync.Mutex{}
	whoisServerLocks[server] = m
	return m
}

func whoisPace() {
	whoisPacerMu.Lock()
	defer whoisPacerMu.Unlock()
	since := time.Since(whoisLastQuery)
	if since < 100*time.Millisecond {
		time.Sleep(100*time.Millisecond - since)
	}
	whoisLastQuery = time.Now()
}

func loadRDAPBootstrap() {
	rdapBootstrap = make(map[string]string)
	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Get("https://data.iana.org/rdap/dns.json")
	if err != nil {
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return
	}
	var data struct {
		Services [][][]string `json:"services"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return
	}
	for _, svc := range data.Services {
		if len(svc) < 2 || len(svc[1]) == 0 {
			continue
		}
		baseURL := svc[1][0]
		if !strings.HasSuffix(baseURL, "/") {
			baseURL += "/"
		}
		for _, tld := range svc[0] {
			rdapBootstrap[strings.ToLower(tld)] = baseURL
		}
	}
}

func getRDAPURL(domain string) (string, bool) {
	rdapBootstrapOnce.Do(loadRDAPBootstrap)
	tld := domain[strings.LastIndex(domain, ".")+1:]
	if base, ok := rdapBootstrap[strings.ToLower(tld)]; ok {
		return base + "domain/" + domain, true
	}
	return "https://rdap.org/domain/" + domain, false
}

func rdapQuery(domain string, timeout time.Duration) (DomainResult, error) {
	result := DomainResult{Domain: domain, Status: "unknown"}

	rdapSem <- struct{}{}
	defer func() { <-rdapSem }()

	rdapURL, fromBootstrap := getRDAPURL(domain)
	client := &http.Client{Timeout: timeout}
	req, err := http.NewRequest("GET", rdapURL, nil)
	if err != nil {
		return result, err
	}
	req.Header.Set("Accept", "application/rdap+json")

	resp, err := client.Do(req)
	if err != nil {
		return result, err
	}
	defer resp.Body.Close()

	if resp.StatusCode == 404 {
		if fromBootstrap {
			result.Status = "available"
		}
		return result, nil
	}
	if resp.StatusCode != 200 {
		return result, fmt.Errorf("RDAP HTTP %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return result, err
	}

	var data rdapResponse
	if err := json.Unmarshal(body, &data); err != nil {
		return result, err
	}

	result.Status = "registered"
	for _, s := range data.Status {
		if strings.Contains(strings.ToLower(s), "reserved") {
			result.Status = "reserved"
			break
		}
	}

	for _, event := range data.Events {
		switch event.EventAction {
		case "registration":
			result.Registered = normalizeDate(event.EventDate)
		case "expiration":
			result.Expires = normalizeDate(event.EventDate)
		case "last changed":
			result.Updated = normalizeDate(event.EventDate)
		}
	}

	for _, ns := range data.Nameservers {
		if ns.LdhName != "" {
			result.Nameservers = append(result.Nameservers, ns.LdhName)
		}
	}

	for _, ent := range data.Entities {
		for _, role := range ent.Roles {
			if role == "registrar" {
				result.Registrar = extractRegistrarFromVcard(ent.VcardArray)
			}
		}
	}

	if len(data.Status) > 0 {
		result.DomainStatus = data.Status
	}

	return result, nil
}

func extractRegistrarFromVcard(vcardArray interface{}) string {
	arr, ok := vcardArray.([]interface{})
	if !ok || len(arr) < 2 {
		return ""
	}
	fields, ok := arr[1].([]interface{})
	if !ok {
		return ""
	}
	for _, field := range fields {
		f, ok := field.([]interface{})
		if !ok || len(f) < 4 {
			continue
		}
		if name, ok := f[0].(string); ok && name == "fn" {
			if val, ok := f[3].(string); ok {
				return val
			}
		}
	}
	return ""
}

func (r *DomainResult) missingInfo() bool {
	return r.Status == "registered" && (r.Registered == "" || r.Expires == "" || r.Registrar == "")
}

func CheckDomain(domain string) DomainResult {
	tld := domain[strings.LastIndex(domain, ".")+1:]
	server, ok := whoisServers[strings.ToLower(tld)]

	var result DomainResult
	whoisOK := false

	if ok {
		srvMu := getWhoisLock(server)
		srvMu.Lock()
		whoisPace()
		raw, err := whoisQuery(domain, server, 15*time.Second)
		if err == nil && strings.TrimSpace(raw) == "" {
			time.Sleep(500 * time.Millisecond)
			raw, err = whoisQuery(domain, server, 15*time.Second)
		}
		srvMu.Unlock()

		if err == nil && raw != "" {
			var referral string
			result, referral = parseWhoisRaw(domain, raw)
			if result.Status != "unknown" {
				whoisOK = true
				result.RawWhois = raw
			}
			if result.Status == "available" || result.Status == "reserved" {
				return result
			}
			if whoisOK && referral != "" && referral != server {
				refMu := getWhoisLock(referral)
				refMu.Lock()
				whoisPace()
				refRaw, refErr := whoisQuery(domain, referral, 15*time.Second)
				refMu.Unlock()
				if refErr == nil && refRaw != "" {
					refResult, _ := parseWhoisRaw(domain, refRaw)
					mergeWhoisResults(&result, &refResult)
					result.RawWhois = refRaw
				}
			}
		}
	}

	if !whoisOK || result.missingInfo() {
		rdapResult, err := rdapQuery(domain, 15*time.Second)
		if err == nil {
			if !whoisOK {
				return rdapResult
			}
			if rdapResult.Status != "available" {
				mergeWhoisResults(&result, &rdapResult)
			}
		}
	}

	if !whoisOK && result.Domain == "" {
		return DomainResult{Domain: domain, Status: "unknown"}
	}
	return result
}

func mergeWhoisResults(base, ref *DomainResult) {
	if base.Registered == "" && ref.Registered != "" {
		base.Registered = ref.Registered
	}
	if base.Expires == "" && ref.Expires != "" {
		base.Expires = ref.Expires
	}
	if base.Updated == "" && ref.Updated != "" {
		base.Updated = ref.Updated
	}
	if base.Registrar == "" && ref.Registrar != "" {
		base.Registrar = ref.Registrar
	}
	if len(base.Nameservers) == 0 && len(ref.Nameservers) > 0 {
		base.Nameservers = ref.Nameservers
	}
	if len(base.DomainStatus) == 0 && len(ref.DomainStatus) > 0 {
		base.DomainStatus = ref.DomainStatus
	}
}

func SearchDomains(keyword string, tlds []string) []DomainResult {
	type indexed struct {
		idx    int
		result DomainResult
	}

	var (
		wg sync.WaitGroup
		mu sync.Mutex
	)
	collected := make([]indexed, 0, len(tlds))

	for i, tld := range tlds {
		wg.Add(1)
		go func(idx int, t string) {
			defer wg.Done()
			domain := keyword + "." + t
			r := CheckDomain(domain)
			mu.Lock()
			collected = append(collected, indexed{idx: idx, result: r})
			mu.Unlock()
		}(i, tld)
	}
	wg.Wait()

	sort.Slice(collected, func(i, j int) bool {
		return collected[i].idx < collected[j].idx
	})

	results := make([]DomainResult, len(collected))
	for i, c := range collected {
		results[i] = c.result
	}
	return results
}

func containsAny(s string, substrs ...string) bool {
	for _, sub := range substrs {
		if strings.Contains(s, sub) {
			return true
		}
	}
	return false
}

func extractValue(line string) string {
	idx := strings.Index(line, ":")
	if idx < 0 {
		return ""
	}
	return strings.TrimSpace(line[idx+1:])
}

func normalizeDate(s string) string {
	s = strings.TrimSpace(s)
	if s == "" {
		return ""
	}
	formats := []string{
		time.RFC3339,
		"2006-01-02T15:04:05Z07:00",
		"2006-01-02T15:04:05",
		"2006-01-02 15:04:05",
		"2006-01-02",
		"02/01/2006 15:04:05",
		"02/01/2006",
		"01/02/2006",
		"20060102",
		"2006.01.02",
		"02-Jan-2006",
		"January 02 2006",
	}
	for _, f := range formats {
		if t, err := time.Parse(f, s); err == nil {
			return t.UTC().Format(time.RFC3339)
		}
	}
	return s
}
