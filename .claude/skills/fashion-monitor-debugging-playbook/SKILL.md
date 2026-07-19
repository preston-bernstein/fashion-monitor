---
name: fashion-monitor-debugging-playbook
description: Symptom-to-triage runbook for fashion-monitor pipeline failures. Load when alerts stop arriving, listings are stuck PENDING, a platform scraper fails (eBay/Grailed/Vestiaire/Depop/Poshmark), runs show zero listings, SQLite errors appear, CI is red, or the Docker deploy on the desktop host misbehaves. Teaches the funnel query, log events, and discriminating experiments to isolate scrape vs prefilter vs scoring vs alert-dispatch failures. NOT for measurement how-tos (use fashion-monitor-diagnostics-and-tooling), past-incident history (fashion-monitor-failure-archaeology), or executing fixes to the ntfy/feedback migration (fashion-monitor-alerting-feedback-campaign).
---

# Fashion Monitor debugging playbook

Runbook for diagnosing pipeline failures. Vocabulary per `CONTEXT.md` (a "Monitor" is a saved search that fans out per platform; its SQLite table is named `search_groups` after migrations 012/013 — the table name is not the canonical term). All paths relative to repo root. Facts date-stamped 2026-07-02; the working tree is mid Telegram-to-ntfy migration — see traps below.

## The funnel (learn this first)

One pipeline run (`packages/core/src/pipeline/orchestrator.ts` `runPipeline`) flows:

```
scrape (all enabled platforms, parallel)
  → dedupe (seen_listings)
    → prefilter (hard rules; rejects marked score='NO')
      → LLM health check  ── unhealthy? → everything marked PENDING, run ends
        → score (PENDING backlog + new listings; two-pass text→vision)
          → alert dispatch (YES + MAYBE; ntfy; immediate or digest)
```

Every stage leaves evidence. Triage = find the stage where the count drops to zero.

### Step 1 — funnel query (`runs` table)

```bash
sqlite3 data/fashion_monitor.db "SELECT id, started_at, finished_at, listings_found, listings_new, scored_yes, scored_maybe, scored_no, alerts_sent, error FROM runs ORDER BY id DESC LIMIT 10;"
```

Read it left to right:

| Column pattern | Meaning |
|---|---|
| `listings_found = 0` | Scrape stage failed or queries returned nothing → check `integration_events` + platform log events |
| `found > 0, listings_new = 0` | Everything already in `seen_listings` (normal on frequent runs) |
| `new > 0` but `yes+maybe+no ≈ 0` | Prefilter rejected them, or LLM was down (listings went PENDING — scored counts stay 0) |
| `yes+maybe > 0, alerts_sent = 0` | Alert dispatch failing → ntfy config / delivery |
| `finished_at IS NULL` | Run crashed or is still going; check `error` on nearby rows and `pipeline.run.failed` logs |
| `error` non-null | Joined scrape errors and/or pipeline exception text |

Note: prefilter rejects are NOT a `runs` column. They appear as `pipeline.prefilter.rejected` log events (with `reason`) and as `seen_listings` rows scored `NO`. Scored counts can exceed `listings_new` because the PENDING backlog is replayed into scoring.

### Step 2 — integration events (external-dependency health)

```bash
sqlite3 data/fashion_monitor.db "SELECT integration, operation, status, error, recorded_at FROM integration_events ORDER BY id DESC LIMIT 30;"
sqlite3 data/fashion_monitor.db "SELECT * FROM v_integration_recent_failures LIMIT 25;"
sqlite3 data/fashion_monitor.db "SELECT * FROM v_integration_uptime_7d;"
```

Integrations recorded (`packages/core/src/pipeline/integration-events.ts`): `scraper:<platform>` (status `ok`/`degraded`/`fail`), `scraper:<platform>:<queryId>` (per-query fails), `llm:<provider>` (`health_check`), `alerts:telegram` (yes, still that string — see Trap 1), `pipeline:run` (unhandled exceptions).

### Step 3 — structured logs

Pino JSON on stdout; event ids in `packages/core/src/lib/log-events.ts`, documented in `docs/logging-and-audit.md`. Key events: `pipeline.run.start/complete/failed`, `pipeline.prefilter.rejected`, `pipeline.llm.unavailable`, `pipeline.pending.backlog`, `pipeline.scorer.batch.start`, `pipeline.scorer.vision.start`, `platform.scrape.success/failed`, `platform.query.failed`, `alerts.send.failed/error`. Correlate one run with its `runId` field. `LOG_LEVEL=debug` reveals per-query results.

## Symptom → cause → check → fix

### "No alerts arriving"

Work the funnel top-down; do not start at ntfy.

| Likely cause | Discriminating check | Fix |
|---|---|---|
| Scrape failure | `listings_found = 0` + `scraper:*` fail rows in `integration_events` | Per-platform table below |
| Nothing new | `listings_new = 0` | Not a bug; wait or add queries |
| Prefilter eating everything | `pipeline.prefilter.rejected` events with `reason`; `seen_listings` NO rows spiking | Review `hard_no` / price ceilings in effective config (see Trap 5 — DB may override `config.yaml`) |
| LLM down → PENDING | `pipeline.llm.unavailable` event; `llm:*` `health_check` fail; scored counts 0 | See "Stuck PENDING" |
| All scored NO | `scored_no` high, `yes+maybe = 0` | Taste/prompt issue, not delivery. Check feedback prompt diet (llm-scoring-reference skill) |
| Digest mode confusion | `config.yaml` / effective config `alert.mode` | `digest` sends ONE message per run with all matches; `immediate` sends one per listing. Only YES+MAYBE alert (`filterAlertable`) |
| Alert delivery failing | `yes+maybe > 0, alerts_sent = 0`; `alerts.send.failed` (HTTP status) or `alerts.send.error` (exception) in logs; `alerts:telegram` fail rows in `integration_events` | Check ntfy below |
| Expecting empty-run notices | `alert.notify_empty` defaults `false` | Set `notify_empty: true` to get a low-priority "no matches" message per run |

**ntfy delivery check** (as of 2026-07-02, in-flight migration): alerter is `packages/core/src/alerts/ntfy.ts` (`createNtfyAlerter`), config fields `alert.ntfy_url`, `alert.ntfy_topic` (default `fashion-monitor`), optional `alert.ntfy_token` (Bearer auth). Endpoint is `POST {ntfy_url}/{ntfy_topic}`. Test delivery directly:

```bash
curl -d "test from debugging" "$NTFY_URL/$NTFY_TOPIC"   # add -H "Authorization: Bearer $NTFY_TOKEN" if auth enabled
```

Compose ships an `ntfy` service (host port `${NTFY_PORT:-8282}`); default `config.example.yaml` points at `http://ntfy` (compose-internal DNS — unreachable from the host; from the host use the published port). If you find `TELEGRAM_*` env vars or Telegram docs, you are looking at the pre-migration state — the committed history had `alerts/telegram.ts` (now deleted, uncommitted); `docs/SMOKE.md`, `CONTEXT.md`, `.env.example`, and Makefile `sync` hints still say Telegram. Trust the code, not those docs, until the migration commit lands.

### Listings stuck PENDING

`PENDING` is an internal replay state, not an error. When the pre-scoring LLM health check fails, the orchestrator marks all passed listings `PENDING` with a serialized `listing_snapshot` and finishes the run; the NEXT healthy run fetches the backlog (`fetchPendingListings`), merges it with new listings, and scores everything. **Do NOT panic-clear PENDING rows** — deleting them loses the listings; they self-heal.

| Check | Command |
|---|---|
| Backlog size | `sqlite3 data/fashion_monitor.db "SELECT COUNT(*) FROM seen_listings WHERE score='PENDING';"` |
| Health-check history | `sqlite3 data/fashion_monitor.db "SELECT integration, status, error, duration_ms, recorded_at FROM integration_events WHERE operation='health_check' ORDER BY id DESC LIMIT 10;"` |
| Ollama reachable | `curl -s "$OLLAMA_HOST/api/tags"` using the host from effective config `llm.ollama_host` (health check = Ollama `list()` call) |
| Backlog replayed | `pipeline.pending.backlog` log event with `count` on the next run |

If PENDING persists across runs: `llm.ollama_host` is wrong/unreachable from wherever the pipeline runs (containers cannot see `localhost` — see Docker section), the model isn't pulled, or Ollama is down. ADR-0006 says inference should route via a shared GPU broker, but as of 2026-07-02 the code calls `llm.ollama_host` directly — do not assume a broker sits in between.

### Per-platform scrape failures

Access methods per ADR-0004 and `spec/platforms/*.md`. Errors below are the exact thrown strings.

| Platform | Mechanism | Failure signature | Check / fix |
|---|---|---|---|
| eBay | Official Browse API, OAuth client-credentials | `EBAY_CLIENT_ID and EBAY_CLIENT_SECRET required`; `eBay OAuth failed: <status>` + `platform.ebay.oauth.failed` event | Set both env vars in `.env`; 401 means bad/expired creds — regenerate at the eBay Developer Program |
| Grailed | Public Algolia keys | `GRAILED_APP_ID and GRAILED_API_KEY required`; credential validation failure at first search (success logs `platform.grailed.credentials.valid`) | Keys rotate. Re-extract from a Grailed web session per `spec/platforms/grailed.md` (regex the page for `applicationId`/`apiKey`), update `.env` |
| Vestiaire | `__NEXT_DATA__` scrape; Scrapfly on 403/429 | `SCRAPFLY_API_KEY required for Cloudflare bypass`; `platform.vestiaire.fetch.blocked` warn (status 403/429, fallback scrapfly); `Vestiaire HTTP <status>` | Set `SCRAPFLY_API_KEY`; blocked events are normal-ish (Cloudflare), hard fail means Scrapfly quota/key problem. 308 = listing removed (expected, per-item) |
| Depop | impit HTTP first, Playwright fallback | `platform.depop.http.failed` warn then fallback; success logs `platform.depop.rsc.success`. No keys needed | If fallback also empty: is Chromium installed? `pnpm exec playwright install chromium` (Dockerfile does `--with-deps chromium`). Fallback polls page 15×2s then returns `[]` — empty, not error |
| Poshmark | Playwright stealth + persistent profile | Timeout waiting for `a[data-et-prop-location="listing_tile"]` (30s selector timeout) → `platform.scrape.failed` | Profile dir = config `scraper.poshmark_profile_path` (default `data/poshmark-profile`), must persist across runs (Docker volume). Per `docs/SMOKE.md` may need a logged-in profile for tiles. Stealth stack is fenced "do not remove" (`docs/playwright-stealth-pilot.md`) |
| Vinted | Disabled | `Vinted disabled in v1` | Expected; deferred |

### Empty results vs errors — read `ScrapeOutcome` correctly

`packages/core/src/platforms/scrape-utils.ts`: a platform outcome is `ok: false` only when **every** query failed AND zero listings came back. Partial query failures → `ok: true` overall but `scraper:<platform>` recorded as `degraded` in `integration_events`, with per-query `scraper:<platform>:<queryId>` fail rows. A query returning zero listings without throwing is `ok: true` with `count: 0` — an empty result, not an error. Platform failures never crash the run: they land in `stats.errors` and `platform.scrape.failed` warn logs, and the run completes with whatever platforms succeeded (verified in `orchestrator.ts` `scrapeAll`). So: run `error` column non-null + `listings_found > 0` = partial degradation, not an outage.

### SQLite issues

| Symptom | Cause | Fix |
|---|---|---|
| Fresh/empty DB where data expected | Wrong `database.path` (default `data/fashion_monitor.db`, relative to cwd) | Run CLI from repo root, or pass absolute path. In Docker the path comes from `/data/config.yaml` and `./data` is the mounted volume |
| `SQLITE_BUSY` / database is locked | Two writers (e.g. pipeline + dashboard) in rare long transactions; better-sqlite3 is synchronous, DB opens in WAL mode (`storage/db.ts`) | WAL makes this rare; do not run two pipeline processes against one DB file. Close stray `sqlite3` shells holding write locks |
| Migration error at startup | Migrations run automatically on every `openDatabase` (sorted `*.sql` in `packages/core/src/storage/migrations/`, plus idempotent column patches) | Read the failing SQL file name in the error. Never hand-edit schema; the migrate step self-heals known legacy shapes (002, 012) |
| Stale `-wal`/`-shm` files after crash | WAL sidecar files | Normal; SQLite recovers on next open. Do not delete them while a process is attached |

### CI red

Known broken as written (verified 2026-07-02): `.github/workflows/ci.yml` and `live-smoke.yml` use `actions/setup-node` with `node-version: "20"`, `cache: npm`, and `npm ci` — but the repo is a pnpm@9.15 workspace (`packageManager` in root `package.json`), requires Node >= 24 (`engines`), and gitignores npm lockfiles, so `npm ci` cannot resolve. `docs/SMOKE.md` repeats the `npm` commands. **Local truth:** `pnpm install`, `pnpm test`, `pnpm run typecheck`, etc. Do not burn time "debugging" a red CI run that died in dependency install — it is this. Fixing the workflow is a real task (pnpm/action-setup + Node 24 + pnpm cache) but goes through change control (see fashion-monitor-change-control), not a drive-by.

### Docker deploy (desktop host, since the 2026-07-19 NAS→desktop migration)

| Symptom | Check | Fix |
|---|---|---|
| Image won't run on deploy host (`exec format error`) | Image arch | Build via `make build` (buildx `--platform linux/amd64`); a plain `docker build` on Apple Silicon produces arm64 |
| Container can't reach Ollama | `docker compose exec scraper node -e "fetch(process.argv[1]+'/api/tags').then(r=>console.log(r.status)).catch(e=>console.log(e.message))" "$OLLAMA_HOST"` | Never point at raw `:11434` — always go through the ollama-resource-broker (`llm.ollama_host` must be the broker's LAN address, port 11435 for interactive use), per the global Ollama-broker convention. `localhost`/`127.0.0.1` inside the container points at the container itself, not the host, even though the deploy host now co-locates with the broker |
| Config/DB missing in container | Compose mounts `./data:/data`; command is `--config /data/config.yaml` | `config.yaml` and DB live under the deploy host's data dir (Makefile `DEPLOY_PATH`), NOT baked into the image. `make sync` ships compose+config; it never ships `.env` or `data/` |
| Poshmark works locally, fails on deploy host | Profile volume | `data/poshmark-profile` must be on the persistent volume; a fresh container with an empty profile loses the logged-in state |
| feedback-bot container "does nothing" | Its logs say `Feedback bot is disabled` | Expected — see Trap 2 |

## Discriminating experiments

Run these to bisect, cheapest first:

1. **Isolate scraping from scoring:** set `llm.provider: mock` in config (factory supports `mock | ollama | claude | hybrid`, `packages/core/src/llm/factory.ts`). Mock always passes health check, so if listings now flow to scores, the problem is the LLM leg; if `listings_found` is still 0, it is scraping.
2. **Single-platform run:** `pnpm run dev:run -- --config config.yaml --platforms grailed` — the `--platforms` flag (comma-separated) is real, parsed in `apps/cli/src/args.ts` and filtered against enabled platforms in `packages/core/src/platforms/registry.ts`. Compose uses it for the dedicated `poshmark` service.
3. **Live scraper verification:** `pnpm run verify:scrapers` (`scripts/verify-scrapers.ts`) — loads `.env`, reports per-platform ready/skipped/ok/failed, exits non-zero on hard failure. **Warning: real network traffic against all five platforms.** Per assumption A2 (assumed — confirm with owner): rate-limit discipline, prefer fixtures during development, run this sparingly and never in a loop.
4. **LLM-unavailable path (from `docs/SMOKE.md`, mentally s/npm/pnpm/):** point `llm.ollama_host` at a dead URL, run once, confirm PENDING rows + no alerts; restore, run again, confirm backlog scored + alerted. Proves replay semantics end to end.
5. **Direct ntfy POST** (curl above) to split "pipeline never dispatched" from "ntfy unreachable".

## Traps that cost time

1. **`integration_events` still says `alerts:telegram`.** The ntfy migration swapped the alerter but `recordAlertDelivery` in `pipeline/integration-events.ts` (line ~147) hardcodes `integration: "alerts:telegram"` with fallback error text "telegram send returned false". Querying for `alerts:ntfy` finds nothing and you will conclude alerts were never attempted. As of 2026-07-02, filter on `alerts:telegram`.
2. **The feedback loop is severed, not broken.** `apps/cli/src/feedback-bot.ts` is a stub that logs "disabled" and exits its useful life; the Telegram reply-button ingestion was removed and no web-dashboard feedback endpoint exists yet (grep of `packages/api/src` for feedback: empty). Zero new `feedback` rows is the current expected state, not a regression to debug. Restoration = fashion-monitor-alerting-feedback-campaign.
3. **`docs/SMOKE.md` is pre-migration.** It says `npm ci`/`npm run` (wrong package manager) and "Telegram receives alerts" (wrong alerter). Its *checklists* are still the best smoke structure — translate commands to pnpm and Telegram to ntfy as you go.
4. **Do not clear PENDING.** Deleting PENDING rows deletes the `listing_snapshot` that the replay depends on; those listings will only come back if the platform still returns them and dedupe re-admits them. PENDING + healthy Ollama on the next run = self-healing.
5. **`config.yaml` may not be the effective config.** After first boot the DB (`profile_settings`, `config_revisions`) is authoritative (ADR-007); `apps/cli/src/run.ts` loads via `loadProfileConfig(db, ...)` with the file only as fallback. If an edited `config.yaml` "isn't taking effect", inspect `config_revisions` (snapshots per run) for what the pipeline actually used.
6. **"Monitor" ≠ a `monitors` table.** Migrations 012/013 renamed the concept into `search_groups` (the repo's one schema reversal). Queries against `monitors` fail; the canonical CONTEXT.md term remains "Monitor".
7. **Ollama parse failures masquerade as MAYBE.** `OllamaProvider.scoreBatch` catches JSON/schema errors and returns every listing as MAYBE with reason `Parse error: ...` (`packages/core/src/llm/ollama.ts`). A sudden wall of MAYBE alerts quoting "Parse error" means the text model is emitting bad JSON (wrong model, truncation), not that your Taste got looser.
8. **Grailed keys silently expire.** They are scraped public Algolia keys; `spec/platforms/grailed.md`: "Keys may rotate. If search stops working, re-extract." The scraper validates once per process (`platform.grailed.credentials.valid`), so a long-lived deployment can outlive its keys.

## When NOT to use this skill

- **fashion-monitor-diagnostics-and-tooling** — you want measurement how-tos: log/LogQL recipes, scorecard views, shipped analysis scripts (this playbook only uses them to triage).
- **fashion-monitor-failure-archaeology** — you want the history: past investigations, reverts, dead ends, migration chronicles.
- **fashion-monitor-alerting-feedback-campaign** / **fashion-monitor-multi-profile-campaign** — you want to *fix* the ntfy/feedback migration or build multi-profile, not diagnose a symptom.
- **fashion-monitor-run-and-operate** — nothing is broken; you just need to run or deploy it.
- **fashion-monitor-config-and-flags** — you need the full config axis reference rather than a fault path.

## Provenance and maintenance

Grounded by reading the files below on 2026-07-02, mid Telegram→ntfy migration (uncommitted working tree). Re-verify before trusting:

- Funnel columns: `grep -n "UPDATE runs" packages/core/src/storage/repos/runs.ts`
- Pipeline stage order + PENDING semantics: read `packages/core/src/pipeline/orchestrator.ts` (health check → `markPending` → `fetchPendingListings` merge)
- `alerts:telegram` label still hardcoded: `grep -n "alerts:telegram" packages/core/src/pipeline/integration-events.ts`
- ntfy config fields: `grep -n -A6 "AlertConfigSchema" packages/core/src/core/config.ts`
- Alerter in use: `grep -n "createNtfyAlerter" packages/core/src/pipeline/orchestrator.ts`
- feedback-bot still a stub: `cat apps/cli/src/feedback-bot.ts`; API still lacks feedback routes: `grep -rni feedback packages/api/src`
- `--platforms` flag: `grep -n "platforms" apps/cli/src/args.ts`
- Platform env vars/errors: `grep -rn "process.env" packages/core/src/platforms/`
- CI still npm/node-20: `grep -n "node-version\|npm ci" .github/workflows/ci.yml`
- Event ids: `cat packages/core/src/lib/log-events.ts` (keep in sync with `docs/logging-and-audit.md`)
- Views exist: `sqlite3 data/fashion_monitor.db ".tables" | tr ' ' '\n' | grep v_integration`
- Migration list: `ls packages/core/src/storage/migrations/`
