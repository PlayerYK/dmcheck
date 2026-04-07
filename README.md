# dmcheck

**[dmcheck.app](https://dmcheck.app)** — Free domain availability checker powered by WHOIS & RDAP.

Enter a keyword, instantly check whether domains across multiple TLDs are available — results stream back in real time.

## Features

- **Real-time streaming** — results appear one by one via SSE, no waiting for all queries to finish
- **WHOIS + RDAP** — direct queries to registry WHOIS servers (port 43) with RDAP fallback via IANA bootstrap
- **85 TLDs** preconfigured with WHOIS servers; 1000+ TLDs supported via RDAP fallback
- **Customizable TLD list** — users can edit their TLD list in-browser (saved to localStorage)
- **Domain detail panel** — registration dates, registrar, DNS servers, status codes, raw WHOIS, site screenshot & favicon
- **Multi-language** — English (default), 中文, 日本語, 한국어, Español
- **Redis caching** — optional; gracefully degrades to no-cache mode
- **Rate limiting** — IP-based token bucket to prevent abuse
- **Single binary** — all static assets embedded via `go:embed`

## Quick Start

### Prerequisites

- Go 1.21+
- (Optional) Redis for caching

### Run locally

```bash
go run .
```

The server starts on `http://localhost:3300` by default.

### Build

```bash
go build -o dmcheck .
./dmcheck
```

## Configuration

### Config files


| File                        | Description                     |
| --------------------------- | ------------------------------- |
| `config/whois-servers.json` | TLD → WHOIS server mapping      |
| `config/default-tlds.json`  | Default TLD list shown to users |


### Environment variables


| Variable     | Default          | Description                          |
| ------------ | ---------------- | ------------------------------------ |
| `PORT`       | `3300`           | HTTP server port                     |
| `REDIS_ADDR` | `localhost:6379` | Redis address (set empty to disable) |
| `RATE_LIMIT` | `2`              | Requests per second per IP           |
| `RATE_BURST` | `5`              | Rate limiter burst size              |
| `CACHE_TTL`  | `5m`             | Cache duration (Go duration format)  |


## Project Structure

```
├── main.go              # Entry point, routing, middleware
├── whois.go             # WHOIS/RDAP query logic
├── handlers.go          # HTTP handlers (search, whois API)
├── ratelimit.go         # IP-based rate limiter
├── config.go            # Configuration loading
├── config/
│   ├── whois-servers.json
│   └── default-tlds.json
├── static/
│   ├── index.html       # Main page
│   ├── app.js           # Frontend logic + i18n
│   ├── style.css
│   ├── lang/            # Translation files
│   │   ├── en.json
│   │   ├── zh.json
│   │   ├── ja.json
│   │   ├── ko.json
│   │   └── es.json
│   ├── tos.html
│   ├── privacy.html
│   └── legal.css
└── deploy/              # systemd & nginx configs
```

## Deployment

### 1. VPS prerequisites

- Ubuntu 20.04+ with Nginx installed
- Domain DNS A record pointing to VPS IP
- (Optional) Redis for caching

### 2. First-time server setup

```bash
# Create application directory
sudo mkdir -p /opt/dmcheck
sudo chown deployer:deployer /opt/dmcheck

# Build locally and upload (or let GitHub Actions do it)
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -ldflags="-s -w" -o dmcheck .
scp dmcheck your-user@your-vps:/opt/dmcheck/

# Install systemd service
sudo cp deploy/dmcheck.service /etc/systemd/system/dmcheck.service
sudo systemctl daemon-reload
sudo systemctl enable dmcheck
sudo systemctl start dmcheck
```

### 3. Nginx + HTTPS

```bash
# Copy HTTP-only config and enable
sudo cp deploy/dmcheck.nginx /etc/nginx/sites-available/dmcheck
sudo ln -s /etc/nginx/sites-available/dmcheck /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

# Issue certificate — certbot auto-adds SSL config to Nginx
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d dmcheck.app
```

Certbot will modify the Nginx config to add SSL listeners, redirect HTTP→HTTPS, and set up auto-renewal.

### 5. GitHub Actions auto-deploy

The workflow in `.github/workflows/deploy.yml` automatically builds and deploys on every push to `publish`.

Add these secrets in your GitHub repo (Settings → Secrets → Actions):


| Secret        | Value                      |
| ------------- | -------------------------- |
| `VPS_HOST`    | Your VPS IP or hostname    |
| `VPS_USER`    | `deployer`                 |
| `VPS_SSH_KEY` | Private key for SSH access |


Flow: `git push origin publish` → GitHub Actions builds `linux/amd64` binary → `scp` to VPS → `systemctl restart dmcheck`.

### 6. Environment variables on VPS

Edit the systemd service to add environment variables:

```bash
sudo systemctl edit dmcheck
```

```ini
[Service]
Environment=RATE_LIMIT=5
Environment=RATE_BURST=10
Environment=CACHE_TTL=10m
```

Then `sudo systemctl restart dmcheck`.

## Acknowledgments

- [IANA](https://data.iana.org/rdap/dns.json) — RDAP bootstrap data
- [rdap.org](https://rdap.org) — RDAP query fallback
- [screenshot.domains](https://screenshot.domains) — website screenshots
- [favicon.im](https://favicon.im) — website favicons

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines on adding translations, WHOIS servers, and submitting pull requests.

## License

[AGPL-3.0](LICENSE)