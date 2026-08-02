# 02 — Architecture

This document describes how Fashion Monitor is built: the pipeline stages, the tech stack, where code and data live, and which machine runs each part.

## System Overview

The diagram below shows the full pipeline: two schedulers kick off scraping, results flow through deduplication and a free pre-filter, then two-pass LLM scoring, and matches go out as Telegram alerts. Two more services run alongside the pipeline: an always-on feedback bot, and the web app that handles configuration and analytics.

```
┌──────────────────────────────────────────────────────────┐
│   Scheduler A: main run — every 60 min                   │
│   Scheduler B: poshmark — every 3h                       │
│   (Synology Task Scheduler, --platforms flag)            │
└──────────────┬───────────────────────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────────────────────┐
│   Scraper Layer — concurrent via Promise.all()           │
│   eBay │ Grailed │ Vestiaire ← fetch, parallel           │
│   Depop ← impit HTTP first, Playwright fallback          │
│   Poshmark ← Playwright, 3h only                         │
└──────────────┬───────────────────────────────────────────┘
               │ raw listings
               ▼
┌──────────────────────────────────────────────────────────┐
│   Deduplication Layer                                    │
│   check (platform, id) against seen_listings             │
│   also deduplicate cross-query results in-memory         │
│   drop seen listings OR listings with existing score     │
└──────────────┬───────────────────────────────────────────┘
               │ truly new, unscored listings only
               ▼
┌──────────────────────────────────────────────────────────┐
│   Pre-Filter Layer (free — no LLM tokens)                │
│   keyword blocklist, price ceiling, obvious rejections   │
│   target: eliminate 25-40% before LLM                   │
└──────────────┬───────────────────────────────────────────┘
               │ filtered new listings
               ▼
┌──────────────────────────────────────────────────────────┐
│   LLM Scoring Layer — two-pass                           │
│   Pass 1: text batch (Ollama), all new listings          │
│     YES → alert │ NO → discard │ MAYBE → pass 2          │
│   Pass 2: vision (configurable backend), MAYBE only      │
│     image scoring resolves ambiguous items               │
│     post-vision MAYBE still alerts (lower confidence)   │
└──────────────┬───────────────────────────────────────────┘
               │ YES and MAYBE only
               ▼
┌──────────────────────────────────────────────────────────┐
│   Alert Layer — Telegram                                 │
│   one message per match, image + verdict + link          │
│   scoring dimensions (aesthetic/quality/value) exposed   │
└──────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────┐
│   Feedback Bot — always-on (separate Docker service)     │
│   polls Telegram for ✅/❌ callbacks → feedback table    │
└──────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────┐
│   Web App + API (apps/web + apps/api)                    │
│   configuration, analytics, Monitor/Taste management,    │
│   multi-user management, audit log — secondary interface │
└──────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────┐
│   MCP Server (planned — spec/08-mcp-interactive.md)      │
│   primary interface for conversational LLM clients       │
│   on-demand search, Monitor management, Taste tuning     │
└──────────────────────────────────────────────────────────┘
```

## Monorepo Structure

Fashion Monitor is a monorepo (one repository holding several related packages) laid out like this:

```
fashion-monitor/
  apps/
    cli/          -- pipeline runner, local debug commands
    web/          -- React/Vite web app (secondary interface)
    api/          -- Hono API server backing the web app
  packages/
    core/         -- pipeline engine, scrapers, LLM scoring, storage
    shared/       -- RBAC, Zod schemas, shared types
    platforms/    -- platform scraper implementations
  spec/           -- this directory
  docs/
    adr/          -- architecture decision records
  config.yaml     -- system-level config (LLM, platforms, scraper)
  .env            -- encryption key only; credentials in profile_secrets
  docker-compose.yml
```

## Tech Stack

The table below lists each layer's technology choice, and why it was chosen.

| Layer | Choice | Reason |
|-------|--------|--------|
| Language | TypeScript (Node.js 20+) | Developer's primary language; type safety; Playwright is Node-first |
| Build | `tsx` for dev, `tsc` for prod | Zero-config TS execution; compiled output for Docker |
| Monorepo | pnpm workspaces + Turborepo | Shared packages, parallel builds |
| Scheduling | Synology Task Scheduler or Docker cron | Always-on, no cloud needed |
| Concurrency | `Promise.all()` / `Promise.allSettled()` | Parallel platform scraping; native to Node.js |
| HTTP | native `fetch` (Node 20+) + `impit` for Depop | Lightweight; impit for TLS fingerprint bypass |
| HTML parsing | `cheerio` | jQuery-like API, familiar, well-maintained |
| Browser | Playwright (Node-first, same as Python) | Poshmark + Depop Cloudflare fallback |
| Storage | `better-sqlite3` on NAS local volume | Synchronous C bindings, fast, zero setup — never over NFS/SMB |
| LLM | Provider abstraction — Ollama / Claude / Hybrid | Swap via config, no code change |
| LLM text | Ollama `qwen2.5:7b` on multimedia machine (LAN) | Free, private, sufficient for text classification |
| LLM vision | Ollama vision model OR Claude API for MAYBE items | Depends on GPU VRAM — see 04-llm-scoring.md |
| Alerts | Telegram Bot API | Only external dependency — outbound only |
| Config | `config.yaml` (system) + `profile_settings` table (per-profile) | System config editable without code; profile Taste in DB |
| Secrets | `profile_secrets` table, XChaCha20-Poly1305 encrypted | Per-profile isolation; only encryption key in `.env` |
| Web framework | Hono (API) + React/Vite (web app) | Lightweight, TypeScript-native |
| Auth | Server-side sessions (`sessions` table) + password hash | Simple, no OAuth dependency |
| RBAC | 5 roles, 11 capabilities (`packages/shared/src/rbac.ts`) | Owner → Admin → Curator / Operator → Viewer |
| Lint/format | ESLint + Prettier | Standard TS toolchain |
| Type check | `tsc --noEmit` | Catches normalization bugs at compile time |
| Tests | Vitest | Fast, native ESM support, good TS integration |

## Data Flow Detail

Here is what happens in each of the four pipeline phases shown in the diagram above.

### 1. Scrape Phase
Each platform scraper runs independently. It returns a normalized `Listing` object:
```typescript
interface Listing {
  id: string;           // platform-specific unique ID
  platform: string;     // "ebay" | "grailed" | "vestiaire" | "depop" | "poshmark"
  title: string;
  description: string;
  price: number;
  currency: string;
  size: string;
  brand: string | null;
  url: string;
  imageUrl: string | null;
  listedAt: Date | null;
  condition: string | null;
  raw: Record<string, unknown>;  // original API response for debugging
  sourceQueryId?: string;        // which scrape_query produced this listing
}
```

### 2. Deduplicate Phase
This phase checks whether a listing has already been seen, so it doesn't alert twice for the same item.
- Composite key: `{platform}:{id}` — the platform name plus that platform's own listing ID
- The SQLite `seen_listings` table stores every key seen so far, with a timestamp
- Only listings not already recorded in `seen_listings` continue to the next phase

### 3. Score Phase
- **Pass 1** (text, all new): Ollama (the LAN-hosted LLM server) batch-scores every new listing as YES, MAYBE, or NO.
- **Pass 2** (vision, MAYBE only): a configurable backend — Ollama's vision model, or Claude — re-scores MAYBE items that have an `image_url`.
- A MAYBE item with no `image_url` stays MAYBE, and still triggers an alert.
- A MAYBE that goes through Pass 2 still alerts afterward. The vision pass can only lower confidence, not disqualify the item.
- PENDING is a pipeline-internal state, never surfaced to users. It originally covered only the case where the LLM was unreachable at scrape time. As of 2026-07-19 it also serves as the standard hand-off between the separate scrape-only and score-only process invocations (see below).

### 4. Alert Phase
- One Telegram message per YES/MAYBE listing.
- Digest mode is optional: it bundles all matches from a run into one message instead.
- Each alert includes: image, title, brand, price, platform, the LLM's reason, scoring dimensions (aesthetic/quality/value), and a link.

**Process-level split (2026-07-19):** phases 1-2 (scrape+dedupe+prefilter) and phases 3-4
(score+alert) now run as two separate CLI entrypoints/containers — `apps/cli/src/scrape.ts`
(`runScrapePhase`) and `apps/cli/src/score.ts` (`runScorePhase`) — rather than one combined
`run.ts` invocation, so the scrape half can run inside a network-isolated VPN tunnel without
also needing LAN access to the Ollama broker for scoring. `run.ts`/`runPipeline` still exists
unchanged, combining both halves in one process, for local dev and non-split deployments.

## Execution Environment

Fashion Monitor runs across two machines: a desktop host that runs the Docker containers and stores the database, and a separate multimedia machine that runs the Ollama LLM server, reachable from the desktop over the LAN (local network).

### Where things run

```
Desktop deploy host (always-on-when-powered, x86_64 required — verify with: uname -m)
├── Docker: pipeline (cron) + feedback-bot (always-on) + api + web
│   ├── Node.js 24, TypeScript (compiled), Playwright/Chromium, impit, cheerio
│   ├── better-sqlite3: needs build deps in Docker — use node:24-bookworm base image
│   ├── Scheduled via cron or a systemd timer on the deploy host (`docker compose run --rm scraper`/`poshmark`)
│   └── Reads/writes SQLite on the deploy host's local volume mount
└── $(DEPLOY_PATH)  (Makefile; local disk, not a network mount)
    ├── data/fashion_monitor.db (SQLite — local disk only, NEVER over NFS)
    ├── config.yaml
    └── .env

Multimedia Machine (always-on, has GPU)
└── Ollama daemon (already running)
    ├── qwen2.5:7b           — text scoring (pass 1)
    └── llama3.2-vision:11b  — image scoring (pass 2)  [MODEL TBD ON VRAM]
    Endpoint: http://<multimedia-ip>:11434/v1/  (LAN, <1ms latency)
```

The deployment moved off a Synology NAS (`/volume1/docker/fashion-monitor/`) to this desktop deploy host on 2026-07-19. This matches the rest of the home lab's NAS→desktop rebalancing, which moved arr-stack, financial-pipeline, and media-stack the same way. The real deploy host address is not in this public repo — see the untracked local `CLAUDE.md`, or `DEPLOY_HOST`/`DEPLOY_PATH` in the `Makefile`.

### Pre-flight checks (run before building)

```bash
# On Synology — must be x86_64 for Playwright Docker
uname -m  # expect: x86_64

# On multimedia machine — determines Ollama model selection
nvidia-smi  # NVIDIA
rocm-smi    # AMD
# Note total VRAM — see 04-llm-scoring.md for model selection table

# Verify Ollama is reachable from NAS (run inside scraper container)
curl http://<multimedia-ip>:11434/
```

### Ollama fallback when multimedia machine is down

Every run starts with an Ollama health check. If Ollama is unreachable:
- Scrape and deduplicate as normal
- Mark new listings with `score = 'PENDING'` in DB (see 03-data-model.md)
- Skip LLM scoring and alerting for this run
- On the next run where Ollama is reachable: score all `PENDING` listings first

Fashion Monitor never automatically falls back to a paid API when Ollama is down. Claude and hybrid providers are opt-in via config only.

### GitHub Actions — CI only

The scraper never runs inside GitHub Actions (GHA — GitHub's built-in CI/CD service; CI means continuous integration, automated checks run on every push). The CI workflow runs lint, `tsc --noEmit`, and Vitest on push/PR (ADR-010).

## Key Constraints

- Rate limiting: add delays between requests per platform (see platform specs)
- Query volume: 1-3 queries per platform per run depending on platform (eBay: 2-3, Grailed: 2, others: 1) — see each platform spec
- Cross-query deduplication: listings appearing in multiple queries within a run are deduplicated in-memory before the database write, to prevent double-scoring
- No residential proxies needed at this volume
- Default config uses Ollama only ($0). Optional Claude/hybrid via config — see 04-llm-scoring.md
