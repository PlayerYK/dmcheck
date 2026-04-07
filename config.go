package main

import (
	"embed"
	"encoding/json"
	"log"
	"os"
	"strconv"
	"time"

	"golang.org/x/time/rate"
)

//go:embed config/*
var configFiles embed.FS

var (
	CacheTTL  = 5 * time.Minute
	RateLimit = rate.Limit(2)
	RateBurst = 5
)

func loadConfig() {
	loadWhoisServers()
	loadDefaultTLDs()
	loadEnvConfig()
}

func loadWhoisServers() {
	data, err := readConfigFile("config/whois-servers.json")
	if err != nil {
		log.Printf("Using embedded whois-servers.json: %v", err)
		data, err = configFiles.ReadFile("config/whois-servers.json")
		if err != nil {
			log.Fatalf("Cannot read embedded whois-servers.json: %v", err)
		}
	}
	var servers map[string]string
	if err := json.Unmarshal(data, &servers); err != nil {
		log.Fatalf("Invalid whois-servers.json: %v", err)
	}
	whoisServers = servers
	log.Printf("Loaded %d WHOIS servers", len(whoisServers))
}

func loadDefaultTLDs() {
	data, err := readConfigFile("config/default-tlds.json")
	if err != nil {
		log.Printf("Using embedded default-tlds.json: %v", err)
		data, err = configFiles.ReadFile("config/default-tlds.json")
		if err != nil {
			log.Fatalf("Cannot read embedded default-tlds.json: %v", err)
		}
	}
	var tlds []string
	if err := json.Unmarshal(data, &tlds); err != nil {
		log.Fatalf("Invalid default-tlds.json: %v", err)
	}
	DefaultTLDs = tlds
	log.Printf("Loaded %d default TLDs", len(DefaultTLDs))
}

func loadEnvConfig() {
	if v := os.Getenv("RATE_LIMIT"); v != "" {
		if f, err := strconv.ParseFloat(v, 64); err == nil {
			RateLimit = rate.Limit(f)
		}
	}
	if v := os.Getenv("RATE_BURST"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			RateBurst = n
		}
	}
	if v := os.Getenv("CACHE_TTL"); v != "" {
		if d, err := time.ParseDuration(v); err == nil {
			CacheTTL = d
		}
	}
}

func readConfigFile(path string) ([]byte, error) {
	return os.ReadFile(path)
}
