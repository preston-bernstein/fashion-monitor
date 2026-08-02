# Manual smoke checklist

Run this checklist after a deploy or after a major change to a scraper or the LLM (large language model — the AI system that scores listings). It needs real credentials in `config.yaml` and `.env`.

## Prerequisites

- [ ] `config.yaml` copied from `config.example.yaml` and filled in
- [ ] `.env` has `NTFY_TOKEN` (needed if ntfy — the push-notification service used for alerts — has auth enabled), platform keys, and optionally `SCRAPFLY_API_KEY`
- [ ] Ollama (the local LLM runtime this app talks to) reachable at the configured host (default `http://host.docker.internal:11434`)
- [ ] SQLite (the file-based database) path writable — `data/fashion_monitor.db` or whatever your config sets

## Unit / integration (local)

```bash
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm test
pnpm run test:coverage
pnpm run test:e2e
```

## Live scraper verification (the big five)

Fashion Monitor scrapes five marketplaces ("the big five"), and each needs different setup to verify live. Run:

```bash
cp .env.example .env   # fill in what you have
pnpm exec playwright install chromium   # required for Depop fallback + Poshmark
pnpm run verify:scrapers
```

| Platform | Required env | Optional | Notes |
|----------|-------------|----------|-------|
| **eBay** | `EBAY_CLIENT_ID`, `EBAY_CLIENT_SECRET` | — | [eBay Developer Program](https://developer.ebay.com/) OAuth app |
| **Grailed** | `GRAILED_APP_ID`, `GRAILED_API_KEY` | — | Algolia keys from Grailed web session (see spec) |
| **Depop** | — | — | impit HTTP first; Playwright intercept if blocked. **No keys.** |
| **Vestiaire** | `SCRAPFLY_API_KEY` | — | Cloudflare blocks bare fetch |
| **Poshmark** | — | — | Playwright stealth + profile dir. May need logged-in profile for tiles |

A few of the tools named above: impit is the HTTP client library the Depop scraper tries first. Playwright is a browser-automation library — it drives a real headless browser — used as Depop's fallback and for Poshmark. Algolia is the search-index service Grailed's own web app uses, which is why the Grailed scraper needs Algolia keys.

`pnpm run test:live` runs the same checks through Vitest (a test runner), tagged `@live`.

GitHub Actions **Live smoke** workflow: set secrets `EBAY_CLIENT_ID`, `EBAY_CLIENT_SECRET`, `GRAILED_APP_ID`, `GRAILED_API_KEY`, `SCRAPFLY_API_KEY`.

## Live scraper smoke (optional, needs network + creds)

```bash
export EBAY_CLIENT_ID=...
export EBAY_CLIENT_SECRET=...
export GRAILED_APP_ID=...
export GRAILED_API_KEY=...
export SCRAPFLY_API_KEY=...   # vestiaire
pnpm run verify:scrapers
# or
pnpm run test:live
```

## Single pipeline run

```bash
pnpm run dev:run -- --config config.yaml
```

Verify:

- [ ] Log shows `platform.scrape.success` for enabled platforms (or expected failures logged, not crash)
- [ ] `listingsFound` > 0 when platforms healthy
- [ ] LLM health check passes (`pipeline.scorer.batch.start` in logs)
- [ ] New listings get scores YES / MAYBE / NO (not stuck PENDING unless LLM down)
- [ ] ntfy topic receives alert(s) in configured mode (`immediate` or `digest`)
- [ ] `runs` table has a finished row; `seen_listings` updated

## LLM unavailable path

Stop Ollama (or point config at a bad URL), run once:

- [ ] Listings marked `PENDING` in `seen_listings`
- [ ] No ntfy alerts for unscored listings
- [ ] Restart Ollama, run again — backlog scored and alerts sent

## Dashboard feedback

```bash
pnpm run dev:dashboard -- --config config.yaml
```

- [ ] Click **Good find** (👍) / **Not for me** (👎) on an alert in the dashboard's Recent alerts table
- [ ] `POST /api/feedback` returns 201
- [ ] Row in `feedback` table with title, brand, price, `source_query_id` copied from `alert_log`
- [ ] `audit_log` has a `feedback.record` entry

## Docker (Synology)

Synology NAS boxes (network-attached storage devices) run Docker Compose too, so this is also how you'd smoke-test the deploy target.

```bash
docker compose build
docker compose up -d scraper dashboard proxy
docker compose logs -f scraper
```

- [ ] Containers stay up after first run
- [ ] Cron/scheduler triggers scraper on expected interval
- [ ] Poshmark profile volume persists under `data/poshmark-profile`

## Mutation testing (optional, slow)

Stryker is a mutation-testing tool: it makes small deliberate changes ("mutants") to the code and checks whether any test fails. A mutant that survives means a gap in test coverage.

```bash
pnpm run test:mutation
```

Review the Stryker report and investigate surviving mutants in `pipeline/` and `listing-snapshot.ts`.
