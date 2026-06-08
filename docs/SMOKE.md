# Manual smoke checklist

Run after deploy or major scraper/LLM changes. Requires real credentials in `config.yaml` and `.env`.

## Prerequisites

- [ ] `config.yaml` copied from `config.example.yaml` and filled in
- [ ] `.env` has Telegram token, platform keys, optional `SCRAPFLY_API_KEY`
- [ ] Ollama reachable at configured host (default `http://host.docker.internal:11434`)
- [ ] SQLite path writable (`data/fashion_monitor.db` or configured path)

## Unit / integration (local)

```bash
npm ci
npm run typecheck
npm test
npm run test:coverage
npm run test:e2e
```

## Live scraper verification (the big five)

Each platform needs different setup. Run:

```bash
cp .env.example .env   # fill in what you have
node node_modules/playwright/cli.js install chromium   # required for Depop fallback + Poshmark
npm run verify:scrapers
```

| Platform | Required env | Optional | Notes |
|----------|-------------|----------|-------|
| **eBay** | `EBAY_CLIENT_ID`, `EBAY_CLIENT_SECRET` | — | [eBay Developer Program](https://developer.ebay.com/) OAuth app |
| **Grailed** | `GRAILED_APP_ID`, `GRAILED_API_KEY` | — | Algolia keys from Grailed web session (see spec) |
| **Depop** | — | — | impit HTTP first; Playwright intercept if blocked. **No keys.** |
| **Vestiaire** | `SCRAPFLY_API_KEY` | — | Cloudflare blocks bare fetch |
| **Poshmark** | — | — | Playwright stealth + profile dir. May need logged-in profile for tiles |

`npm run test:live` runs the same checks via Vitest (`@live` tag).

GitHub Actions **Live smoke** workflow: set secrets `EBAY_CLIENT_ID`, `EBAY_CLIENT_SECRET`, `GRAILED_APP_ID`, `GRAILED_API_KEY`, `SCRAPFLY_API_KEY`.

## Live scraper smoke (optional, needs network + creds)

```bash
export EBAY_CLIENT_ID=...
export EBAY_CLIENT_SECRET=...
export GRAILED_APP_ID=...
export GRAILED_API_KEY=...
export SCRAPFLY_API_KEY=...   # vestiaire
npm run verify:scrapers
# or
npm run test:live
```

## Single pipeline run

```bash
npm run dev:run -- --config config.yaml
```

Verify:

- [ ] Log shows `platform.scrape.success` for enabled platforms (or expected failures logged, not crash)
- [ ] `listingsFound` > 0 when platforms healthy
- [ ] LLM health check passes (`pipeline.scorer.batch.start` in logs)
- [ ] New listings get scores YES / MAYBE / NO (not stuck PENDING unless LLM down)
- [ ] Telegram receives alert(s) in configured mode (`immediate` or `digest`)
- [ ] `runs` table has a finished row; `seen_listings` updated

## LLM unavailable path

Stop Ollama (or point config at bad URL), run once:

- [ ] Listings marked `PENDING` in `seen_listings`
- [ ] No Telegram alerts for unscored listings
- [ ] Restart Ollama, run again — backlog scored and alerts sent

## Feedback bot

```bash
npm run dev:feedback -- --config config.yaml
```

- [ ] Tap **Good find** / **Not for me** on a Telegram alert
- [ ] Bot logs `feedback-bot.recorded`
- [ ] Row in `feedback` table with title, price, score from `alert_log`

## Docker (Synology)

```bash
docker compose build
docker compose up -d scraper feedback-bot
docker compose logs -f scraper
```

- [ ] Containers stay up after first run
- [ ] Cron/scheduler triggers scraper on expected interval
- [ ] Poshmark profile volume persists under `data/poshmark-profile`

## Mutation testing (optional, slow)

```bash
npm run test:mutation
```

Review Stryker report; investigate surviving mutants in `pipeline/` and `listing-snapshot.ts`.
