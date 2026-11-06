# dmcheck

语言：[English](README.md) | 简体中文

**[dmcheck.app](https://dmcheck.app)** — 基于 WHOIS 和 RDAP 的免费域名可用性查询工具。

输入一个关键词，即可同时查询多个后缀下的域名是否可注册，结果会实时流式返回。

## 功能

- **实时流式结果** — 通过 SSE 逐条展示结果，不必等待所有查询完成
- **WHOIS + RDAP** — 直接查询注册局 WHOIS 服务器（43 端口），并通过 IANA bootstrap 回退到 RDAP
- **预置 83 个 TLD**，并可通过 RDAP fallback 支持 1000+ 后缀
- **可自定义 TLD 列表** — 用户可在浏览器内编辑后缀列表，并保存到 localStorage
- **域名详情面板** — 展示注册日期、注册商、DNS 服务器、状态码、原始 WHOIS，以及可选加载的网站截图和 favicon
- **可选注册商跳转和价格比价** — 启用后，可注册域名可展示注册商跳转链接、首年美元参考价，以及详情抽屉中的注册商比价
- **保留域名识别** — 将注册局保留域名与已注册、可注册域名区分开
- **多语言** — English（默认）、中文、日本語、한국어、Español
- **Redis 缓存** — 可选；未配置时会自动降级为无缓存模式
- **请求限流** — 基于 IP 的 token bucket，防止滥用
- **单二进制部署** — 所有静态资源通过 `go:embed` 内嵌

## 快速开始

### 前置要求

- Go 1.21+
- （可选）Node.js 18+，用于刷新注册商价格参考数据
- （可选）Redis，用于缓存

### 本地运行

```bash
go run .
```

服务默认启动在 `http://localhost:3300`。

### 构建

```bash
go build -o dmcheck .
./dmcheck
```

## 配置

### 配置文件

| 文件 | 说明 |
| ---- | ---- |
| `config/whois-servers.json` | TLD → WHOIS 服务器映射 |
| `config/default-tlds.json` | 展示给用户的默认 TLD 列表 |
| `config/registrar-prices.json` | 可选注册商链接模板和已配置的 TLD 价格参考；仅在 `REGISTRAR_PRICES_ENABLED=true` 时使用 |

### 注册商跳转和价格比价

dmcheck 可以作为纯域名可用性查询工具运行，不需要任何注册商数据。这是默认模式，只需要 Go 即可启动。在该模式下，`config/registrar-prices.json` 会被忽略，API 响应不会返回 `registration_options`，前端也不会展示注册商操作或价格比价。

设置 `REGISTRAR_PRICES_ENABLED=true` 后，会启用可选的注册商模块。启用后，可注册域名结果会包含注册商搜索/注册链接、可用的首年美元参考价，以及前端详情抽屉中的比价视图。

`config/registrar-prices.json` 里有两类相关但不同的数据：一类是面向用户展示的注册商跳转/搜索渠道，另一类是用于比价 UI 的自动价格行。某个注册商可以只作为跳转渠道存在，即使它暂时不进入自动价格比价。

`config/registrar-prices.json` 的 2026-11-06 快照启用了 6 个注册商渠道，共覆盖 1,183 个后缀，其中 497 个是多段后缀。

| 注册商 | 用户可见渠道 | 自动价格行数 | 更新方式 | 说明 |
| ------ | ------------ | ------------ | -------- | ---- |
| Cloudflare Registrar | 注册控制台跳转 + 比价 | 418 | 官方公开价格页 | 包含官方公布的首年促销价。 |
| Porkbun | 注册/搜索跳转 + 比价 | 638 | 官方公开价格页 | 用于提供较广的 TLD 价格覆盖。 |
| Namecheap | 注册/搜索跳转 | 0 | 仅跳转 | 公开价格页阻止脚本刷新，官方价格 API 需要账号凭证。 |
| Spaceship | 注册/搜索跳转 | 0 | 仅跳转 | `https://www.spaceship.com/domains/` 确实有公开价格页，并通过“See more”交互展示更多行；但无人值守更新脚本用 Node、curl、headless Chrome 访问时都会进入 Cloudflare verification。官方 API 也需要 key/secret 凭证，所以在没有稳定非交互数据源前保持为仅跳转。 |
| Dynadot | 注册/搜索跳转 + 比价 | 816 | 官方公开价格页 | 用于提供较广的 TLD 价格覆盖，也包含较多多段后缀。 |
| OVHcloud | 注册/搜索跳转 + 比价 | 900 | 国际站美元价格页 | 包含官方公布的首年促销价。 |

NameSilo 和 GoDaddy 已经过评估，但当前配置中还没有启用为渠道。只有当我们拿到稳定的无人值守公开数据源，或明确要做带凭证的集成时，才会加入。

### 更新注册商价格参考

有需要时手动刷新价格表。先在仓库根目录试跑，检查价格来源和覆盖数量。

```bash
node scripts/update-registrar-prices.mjs --dry-run
```

- 去掉 `--dry-run` 再运行，即可写入 `config/registrar-prices.json`。可用 `--date=YYYY-MM-DD` 指定价格表日期。
- 脚本会抓取 Cloudflare、Porkbun、Dynadot 和 OVHcloud 的官方美元价格。每次刷新时，Cloudflare 和 OVHcloud 的价格行会根据同时有注册价和续费价的报价重新生成。
- 所有来源达到最低行数才会写入价格表。Cloudflare 至少 300 行，Porkbun 至少 100 行，Dynadot 至少 300 行，OVHcloud 至少 600 行。提交生成的文件前，请检查脚本打印的覆盖数量。

如果某个来源持续失败，就先不要把它放进自动价格源，直到它重新提供稳定的公开数据。

获取 Namecheap、NameSilo、Spaceship 和 GoDaddy 的价格仍需要账号或 API 凭证、浏览器交互，或可供脚本访问的数据源。

### 环境变量

所有运行时环境变量都在 `config.go` 中统一读取，并保存到全局 `AppConfig`。其他模块应从 `AppConfig` 读取配置，不要直接调用 `os.Getenv`。

使用 systemd 部署时，建议把覆盖项集中放在服务器侧文件 `/opt/dmcheck/dmcheck.env` 里。仓库提供的 `deploy/dmcheck.service` 会通过 `EnvironmentFile` 加载它。这个文件不会提交到仓库，也不会被 GitHub Actions 自动部署；请在服务器上创建一次，或把本地私有副本安全复制过去。

| 变量 | 默认值 | 说明 |
| ---- | ------ | ---- |
| `PORT` | `3300` | HTTP 服务端口 |
| `REDIS_ADDR` | `localhost:6379` | Redis 地址；设为空可禁用 Redis |
| `RATE_LIMIT` | `2` | 每个 IP 每秒允许的请求数 |
| `RATE_BURST` | `5` | 限流器突发容量 |
| `AVAILABLE_CACHE_TTL` | `0` | 可注册域名结果缓存时间；`0` 表示禁用可注册结果缓存 |
| `REGISTERED_CACHE_TTL` | `2160h` | 已注册/保留域名的最大缓存时间；到期前会刷新已注册域名 |
| `CACHE_TTL` | （空） | `AVAILABLE_CACHE_TTL` 的旧版别名 |
| `REGISTRAR_PRICES_ENABLED` | `false` | 从 `config/registrar-prices.json` 启用注册商跳转和价格比价 |
| `GA_ID` | （空） | Google Analytics Measurement ID；留空表示禁用 |
| `SITE_URL` | `https://dmcheck.app` | 用于渲染 SEO metadata 的 canonical 站点地址 |
| `APP_VERSION` | 构建信息 | 可选固定版本号，展示在 UI 中；留空时使用构建/git metadata |

## 项目结构

```text
├── main.go              # 入口、路由和中间件
├── whois.go             # WHOIS/RDAP 查询逻辑
├── handlers.go          # HTTP handlers（搜索、WHOIS API）
├── ratelimit.go         # 基于 IP 的限流器
├── config.go            # 配置和环境变量加载
├── config/
│   ├── whois-servers.json
│   ├── default-tlds.json
│   └── registrar-prices.json
├── scripts/
│   └── update-registrar-prices.mjs
├── static/
│   ├── index.html       # 主页面
│   ├── app.js           # 前端逻辑 + i18n
│   ├── style.css
│   ├── lang/            # 翻译文件
│   │   ├── en.json
│   │   ├── zh.json
│   │   ├── ja.json
│   │   ├── ko.json
│   │   └── es.json
│   ├── tos.html
│   ├── privacy.html
│   └── legal.css
└── deploy/              # systemd、环境变量文件和 nginx 配置
```

## 部署

### 1. VPS 前置要求

- Ubuntu 20.04+，并已安装 Nginx
- 域名 DNS A 记录指向 VPS IP
- （可选）Redis，用于缓存

### 2. 首次服务器初始化

```bash
# 创建应用目录和服务器侧环境变量文件
sudo mkdir -p /opt/dmcheck
sudo chown deployer:deployer /opt/dmcheck
sudo install -m 0644 deploy/dmcheck.env.example /opt/dmcheck/dmcheck.env
sudo chown deployer:deployer /opt/dmcheck/dmcheck.env

# 本地构建并上传，或交给 GitHub Actions
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -ldflags="-s -w" -o dmcheck .
scp dmcheck your-user@your-vps:/opt/dmcheck/

# 安装 systemd 服务
sudo cp deploy/dmcheck.service /etc/systemd/system/dmcheck.service
sudo systemctl daemon-reload
sudo systemctl enable dmcheck
sudo systemctl start dmcheck
```

### 3. Nginx + HTTPS

```bash
# 复制 HTTP-only 配置并启用
sudo cp deploy/dmcheck.nginx /etc/nginx/sites-available/dmcheck
sudo ln -s /etc/nginx/sites-available/dmcheck /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

# 签发证书，certbot 会自动向 Nginx 写入 SSL 配置
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d dmcheck.app
```

Certbot 会修改 Nginx 配置，添加 SSL 监听、HTTP→HTTPS 跳转，并配置自动续期。

### 4. GitHub Actions 自动部署

`.github/workflows/deploy.yml` 会在每次推送到 `publish` 分支时自动构建并部署。

在 GitHub 仓库中添加以下 secrets（Settings → Secrets → Actions）：

| Secret | Value |
| ------ | ----- |
| `VPS_HOST` | 你的 VPS IP 或主机名 |
| `VPS_PORT` | SSH 端口；如果不是 22 才需要改 |
| `VPS_USER` | `deployer` |
| `VPS_SSH_KEY` | SSH 私钥 |

流程：`git push origin publish` → GitHub Actions 构建 `linux/amd64` 二进制 → `scp` 到 VPS → `systemctl restart dmcheck`。该 workflow 只部署二进制，不会上传或覆盖 `/opt/dmcheck/dmcheck.env`。

### 5. VPS 环境变量

编辑 systemd 加载的环境变量文件。这是服务器侧持久文件，不是提交到仓库的文件：

```bash
sudo nano /opt/dmcheck/dmcheck.env
```

```env
RATE_LIMIT=5
RATE_BURST=10
REGISTERED_CACHE_TTL=2160h
REGISTRAR_PRICES_ENABLED=true
GA_ID=G-XXXXXXXXXX
SITE_URL=https://dmcheck.app
# 留空时使用构建/git 生成的版本号。
APP_VERSION=
```

然后执行：

```bash
sudo systemctl daemon-reload
sudo systemctl restart dmcheck
```

## 致谢

- [IANA](https://data.iana.org/rdap/dns.json) — RDAP bootstrap 数据
- [rdap.org](https://rdap.org) — RDAP 查询 fallback
- [screenshot.domains](https://screenshot.domains) — 网站截图
- [favicon.im](https://favicon.im) — 网站 favicon
- 注册价格参考来自 [Cloudflare](https://pricing.registrar.cloudflare.com/)、[Porkbun](https://porkbun.com/products/domains/)、[Dynadot](https://www.dynadot.com/domain/prices) 和 [OVHcloud](https://www.ovhcloud.com/en/domains/tld/)

## 贡献

关于添加翻译、WHOIS 服务器和提交 pull request 的说明，请查看 [CONTRIBUTING.md](CONTRIBUTING.md)。

## License

[AGPL-3.0](LICENSE)
