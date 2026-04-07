# Contributing to dmcheck

Thanks for your interest in contributing! Here's how you can help.

## Adding a Translation

1. Copy `static/lang/en.json` to `static/lang/<code>.json` (e.g. `fr.json`)
2. Translate all values (keep the keys unchanged)
3. Add the language code to the `SUPPORTED_LANGS` array in `static/app.js`
4. Add the language to the `supportedLangs` map in `main.go`
5. Add a `<option>` to the language switcher in `static/index.html`
6. Submit a pull request

## Adding a WHOIS Server

1. Edit `config/whois-servers.json` — add an entry mapping the TLD to its WHOIS server
2. Test with `go run .` and query a domain with that TLD
3. Submit a pull request

## Adding a Default TLD

1. Edit `config/default-tlds.json` — add the TLD to the array
2. Also update the `DEFAULT_TLDS` array in `static/app.js` to match
3. Submit a pull request

## Development Setup

```bash
# Run the server
go run .

# The server starts at http://localhost:3300
# Static files are embedded, so changes to static/ require a restart

# Optional: start Redis for caching
redis-server
```

## Pull Request Guidelines

- Keep PRs focused on a single change
- Test your changes locally before submitting
- For translations, ensure all keys from `en.json` are present
- For code changes, run `go build .` to verify compilation

