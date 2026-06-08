# 02 — Architecture

## System Overview

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
│   LLM Scoring Layer                                      │
│   batches of 15 (configurable), Promise.all() across     │
│   YES / MAYBE / NO with reason                           │
│   parse error → treat batch as MAYBE, retry next run     │
└──────────────┬───────────────────────────────────────────┘
               │ YES and MAYBE only
               ▼
┌──────────────────────────────────────────────────────────┐
│   Alert Layer — Telegram                                 │
│   one message per match, image + verdict + link          │
└──────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────┐
│   Feedback Bot — always-on (separate Docker service)     │
│   polls Telegram for ✅/❌ callbacks → feedback table    │
└──────────────────────────────────────────────────────────┘
```

## Tech Stack

| Layer | Choice | Reason |
|-------|--------|--------|
| Language | TypeScript (Node.js 20+) | Developer's primary language; type safety; Playwright is Node-first |
| Build | `tsx` for dev, `tsc` for prod | Zero-config TS execution; compiled output for Docker |
| Scheduling | Synology Task Scheduler or Docker cron | Always-on, no cloud needed |
| Concurrency | `Promise.all()` | Parallel platform scraping; native to Node.js |
| HTTP | native `fetch` (Node 20+) + `impit` for Depop | Lightweight; impit for TLS fingerprint bypass |
| HTML parsing | `cheerio` | jQuery-like API, familiar, well-maintained |
| Browser | Playwright (Node-first, same as Python) | Poshmark + Depop Cloudflare fallback |
| Storage | `better-sqlite3` on NAS local volume | Synchronous C bindings, fast, zero setup — never over NFS/SMB |
| LLM | Provider abstraction — Ollama / Claude / Hybrid | Swap via config.yaml, no code change |
| LLM text | Ollama `qwen2.5:7b` on multimedia machine (LAN) | Free, private, sufficient for text classification |
| LLM vision | Ollama vision model OR Claude API for MAYBE items | Depends on GPU VRAM — see 04-llm-scoring.md |
| Alerts | Telegram Bot API | Only external dependency — outbound only |
| Config | .env + config.yaml on NAS volume | Secrets local, aesthetic prompt editable without code change |
| Lint/format | ESLint + Prettier | Standard TS toolchain |
| Type check | `tsc --noEmit` | Catches normalization bugs at compile time |
| Tests | Vitest | Fast, native ESM support, good TS integration |

## Data Flow Detail

### 1. Scrape Phase
Each platform scraper runs independently and returns a normalized `Listing` object:
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
}
```

### 2. Deduplicate Phase
- Composite key: `{platform}:{id}`
- SQLite `seen_listings` table stores all seen keys + timestamp
- New listings only pass through

### 3. Score Phase
- Listings batched in groups of 15 (configurable via `llm.batch_size`) to reduce API calls
- Each listing scored YES / MAYBE / NO with a one-line reason
- MAYBE listings included in alerts but marked as such
- NO listings discarded (but logged)

### 4. Alert Phase
- One Telegram message per YES/MAYBE listing
- Digest mode optional: bundle all matches into one message per run
- Alert includes: image, title, brand, price, platform, LLM reason, link

## Execution Environment

### Where things run

```
Synology NAS (always-on, x86_64 required — verify with: uname -m)
├── Docker: scraper (cron) + feedback-bot (always-on)
│   ├── Node.js 20, TypeScript (compiled), Playwright/Chromium, impit, cheerio
│   ├── better-sqlite3: needs build deps in Docker — use node:lts-bookworm base image
│   │   (no prebuilt arm64 binaries — arm64 NAS will compile from source, needs
│   │    python3 + build-essential + libsqlite3-dev in Dockerfile)
│   ├── Scheduled via Synology Task Scheduler (built-in) or container cron
│   └── Reads/writes SQLite on NAS local volume mount
└── /volume1/fashion-monitor/
    ├── data/fashion_monitor.db (SQLite, NAS local disk — NEVER over NFS)
    ├── config.yaml
    └── .env

Multimedia Machine (always-on, has GPU)
└── Ollama daemon (already running)
    ├── qwen2.5:7b           — text scoring (pass 1)
    └── llama3.2-vision:11b  — image scoring (pass 2)  [MODEL TBD ON VRAM]
    Endpoint: http://<multimedia-ip>:11434/v1/  (LAN, <1ms latency)
```

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

Ollama health check on each run start. If unreachable:
- Scrape and deduplicate as normal
- Mark new listings with `score = 'PENDING'` in DB (see 03-data-model.md)
- Skip LLM scoring and alerting for this run
- On next run where Ollama is reachable: score all `PENDING` listings first

Never auto-fallback to a paid API when Ollama is down. Claude/hybrid providers are opt-in via `config.yaml` only.

### GitHub Actions — CI only

Scraper never runs on GHA. CI workflow runs lint, `tsc --noEmit`, and Vitest on push/PR (ADR-010).

## Key Constraints

- Rate limiting: add delays between requests per platform (see platform specs)
- Query volume: 1-3 queries per platform per run depending on platform (eBay: 2-3, Grailed: 2, others: 1) — see each platform spec
- Cross-query deduplication: listings appearing in multiple queries within a run deduplicated in-memory before DB write, to prevent double-scoring
- No residential proxies needed at this volume
- Default config uses Ollama only ($0). Optional Claude/hybrid via config — see 04-llm-scoring.md
