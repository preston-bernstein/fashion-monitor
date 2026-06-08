# 06 — Architecture Decision Records

## ADR-001: TypeScript over Python/Ruby/Go

**Decision:** TypeScript (Node.js 20+)

**Context:** Original spec chose Python for ecosystem reasons. Revised after confirming the developer writes TypeScript daily and wants something they'll actually maintain.

**Why TypeScript:**
- Developer's primary language — faster to write, easier to debug, will actually maintain it
- Playwright is Node-first — Python Playwright is the port, not the other way around
- Anthropic and Ollama SDKs are first-class TypeScript (`@anthropic-ai/sdk`, `ollama` npm package)
- `Promise.all()` for concurrent scraping is cleaner than `asyncio.gather()`
- `better-sqlite3` is synchronous C bindings — fast and simple, no async complexity for DB ops
- TypeScript's type system catches normalization bugs at compile time (Python type hints are unenforced at runtime)
- Same language for scraper + future web UI — no context switching, shared types

**Why not Python:** Ecosystem advantage is real but not decisive when the developer doesn't write it daily. A tool in a language you know deeply is more reliable than one in a language you're fighting.

**Why not Go/Rust:** No meaningful performance gain — bottleneck is network I/O and Ollama inference, not runtime. Scraping ecosystem is immature in both.

**Tradeoff:** `cloudscraper` (Python) has no direct npm equivalent — see Depop platform spec for mitigation.

---

## ADR-002: SQLite over Postgres/Redis

**Decision:** SQLite

**Context:** Need deduplication storage and alert log. Could use Postgres (what GrailSearch uses) or Redis.

**Why SQLite:**
- Zero setup, zero maintenance, zero cost
- Single file, portable
- More than sufficient for personal use volume (<10,000 listings ever seen)
- No server process needed

**Tradeoff:** Can't scale to multi-user or multi-process. Acceptable — this is personal use.

---

## ADR-003: Provider abstraction — Ollama primary, Claude for vision where needed (REVISED)

**Decision:** `LLMProvider` abstraction with three implementations: `OllamaProvider`, `ClaudeProvider`, `HybridProvider`. Default config: `hybrid` — Ollama for text, Claude API for vision on MAYBE items only.

**Context:** User has always-on multimedia machine with Ollama. GPU VRAM unknown. Wants local-first but pragmatic — cloud is acceptable where it makes architectural sense.

**Why hybrid is the right default:**
- Text classification (pass 1): 7B Ollama model is genuinely sufficient. Free, private, fast.
- Vision scoring (pass 2): only fires on MAYBE items (~3-8/run at steady state). Claude API here costs <$1/month and delivers higher quality than most local vision models below 12GB VRAM.
- If GPU has ≥12 GB VRAM: switch to `ollama` provider entirely, zero cloud cost.
- If GPU has no VRAM or is CPU-only: switch to `claude` provider, ~$2-5/month.

**Why a provider abstraction (not just an if/else):**
- Swappable via config.yaml — no code changes to switch providers
- Makes the codebase interesting to show on GitHub — demonstrates real design thinking
- Testable in isolation — mock either provider in tests
- Future-proof — new providers (local Gemma, Mistral, etc.) added without refactoring

**Fallback if Ollama is down:** Mark listings `pending_score`, score on next successful connection. Never automatically fall back to cloud during a run — that would produce inconsistent costs and behavior.

---

## ADR-004: Telegram over email/SMS

**Decision:** Telegram

**Context:** Need push alerts with images. Options: email, SMS (Twilio), Telegram, Discord, Slack.

**Why Telegram:**
- Inline images in notification — critical for clothing decisions
- Free (no Twilio cost)
- Instant push on mobile
- Simple Bot API

**Why not Discord:** Works fine but Telegram is more natural for personal notifications.
**Why not email:** No push, images as attachments not inline, slower.
**Why not SMS:** No images, costs money per message.

---

## ADR-005: Synology NAS as execution host (REVISED)

**Decision:** Docker container on Synology NAS. GitHub Actions not used.

**Context:** User has always-on Synology NAS with Container Manager. Previously spec used GitHub Actions.

**Why Synology:**
- More reliably always-on than any Mac or multimedia machine (designed for 24/7)
- Container Manager = Docker — full Python + Playwright environment
- SQLite DB on NAS local volume = persistent, backed up, no network FS
- Zero cloud dependency — runs entirely on owned hardware
- No GHA minute counting, no free tier limits, no cold starts
- Synology Task Scheduler can trigger Docker containers on cron schedule

**Prerequisites:**
- `uname -m` on NAS must return `x86_64` (ARM NAS cannot run Playwright Chromium)
- DSM 7.x with Container Manager installed
- Sufficient RAM (4 GB minimum, 8 GB comfortable for Playwright)

**Why not GitHub Actions:**
- Costs GHA minutes (exceeds free tier at 60-min schedule on private repo)
- Ephemeral environment — no persistent Playwright session, no local SQLite
- Data leaves your network on every run
- Slower cold start (Chromium download each run without caching)

**Why not multimedia machine as primary:**
- NAS is more stable for scheduling (no GPU workload contention, no reboots for Windows updates)
- Multimedia machine handles Ollama — clean separation of concerns

---

## ADR-006: Vinted deprioritized for v1

**Decision:** Vinted disabled in v1

**Context:** Vinted has the most complex anti-bot protection (Datadome, TLS fingerprinting, residential proxies for commercial use). However, a `vinted-scraper` PyPI package exists that handles this for personal low-volume use.

**Why deprioritize:**
- Vinted inventory skews European — less relevant for US buyer
- `vinted-scraper` is Python-only; no maintained TypeScript equivalent
- Datadome protection is aggressive and may require residential proxy
- Other 5 platforms cover the use case adequately for v1

**Re-enable when:** v1 is stable and eBay/Grailed/Vestiaire/Depop/Poshmark are working. Vinted integration is a one-config-flag change.

---

## ADR-007: Aesthetic prompt in config, not code

**Decision:** Aesthetic description lives in `config.yaml`, not hardcoded in Python

**Context:** The LLM scoring prompt is the core "intelligence" of the system and will need tuning as preferences evolve.

**Why config:**
- Edit without touching code
- Can version-control changes to the aesthetic separately
- User can modify it without understanding the codebase
- Natural place for other tunable parameters (price ceiling, size filters)

---

## ADR-011: Notification delivery — Telegram with ntfy.sh as v2 option

**Decision:** Telegram Bot API for v1. ntfy.sh + web UI documented as v2 path.

**Context:** Multiple notification approaches evaluated. Key constraint: push notification is non-negotiable (listings sell within hours). Active dashboard-checking won't work in practice.

**Why Telegram for v1:**
- Zero hosting required — just HTTP POST to `api.telegram.org`
- Native inline keyboard buttons (✅/❌) enable the feedback loop without a server
- Inline image delivery — critical for clothing decisions
- Free, instant push on iOS/Android
- One bot serves multiple profiles via separate chat IDs

**Why ntfy.sh + web UI is compelling for v2:**
- Self-hosted on Synology — no data leaves the house
- No third-party account required for family members
- Web UI on Synology gives browsable alert history with full images
- ntfy app is free and open source
- Tradeoff: requires building a web UI (significant extra code) and exposing Synology externally via Tailscale or Cloudflare tunnel

**Why not email:** Push unreliable (Promotions tab, delays). Feedback buttons require hosted webhook.
**Why not SMS:** No inline images. Costs money (Twilio). Feedback loop requires hosted webhook.

---

## ADR-008: Include image URLs in LLM scoring (REVISED)

**Decision:** Pass image URLs to Claude for all listings that have one. Text-only scoring for listings without images.

**Context:** Original spec deferred image scoring as optional. This was wrong for a fashion tool.

**Why images are required:**
- Resale listing text quality is poor — "great condition black jacket" describes nothing useful
- Texture, color accuracy, construction quality, and fit are visual — cannot be inferred from text
- Text-only scoring is 40-50% of available signal; with images it's 80-90%
- Claude vision via URL adds negligible latency and minimal cost (~same token count as text)

**Why not download and base64 encode:**
- Image URLs from eBay, Grailed, Depop are stable during a listing's life
- Passing URL is simpler and Claude fetches directly
- Some platforms (Vestiaire) may have auth-gated images — fallback to text-only for those

**Implementation:**
```python
# In the batch prompt, include image_url per listing if available
{
    "listing_id": "grailed:12345",
    "title": "...",
    "image_url": "https://...",   # Claude fetches this
    ...
}
```

**Cost impact:** Vision input is billed at same token rate — an image costs roughly 1,000-2,000 tokens equivalent. At 15 listings/batch with images, adds ~15,000-30,000 tokens/batch. At $1.00/M, that's $0.015-0.030/batch vs $0.002 text-only. Significant multiplier — use images for MAYBE items only, or cap at top-5 listings per batch ranked by text score.

**Pragmatic approach:** Two-pass scoring.
1. Pass 1: text-only, fast, cheap. Score all new listings.
2. Pass 2: image scoring only for MAYBE items from pass 1. Resolves ambiguity.

This keeps costs low while using images where they actually matter.

---

## ADR-010: Public GitHub repo — portfolio showcase

**Decision:** Repo is public. GitHub Actions used for CI/tests only, not for running the scraper.

**Why public:**
- Portfolio value — shows real architecture: multi-platform scraping, LLM provider abstraction, feedback learning loop, local/cloud hybrid
- GitHub Actions CI badge and passing tests signal code quality to prospective employers/clients
- Allows others to fork and adapt (legitimate open source contribution)

**What makes this interesting to show:**
- `LLMProvider` protocol with swappable implementations — clean interface design
- Two-pass scoring pipeline (text → image escalation)
- Feedback loop with few-shot injection — shows understanding of prompt engineering
- Multi-platform async scraping with graceful degradation per platform
- Local-first architecture with cloud fallback — pragmatic engineering judgment

**What to keep out of the public repo:**
- `.env` (never committed — .gitignore)
- `config.yaml` with personal details — provide `config.example.yaml` instead
- `data/` directory (SQLite DB — .gitignore)
- Poshmark profile directory

**GitHub Actions CI (not scraper execution):**
```yaml
# .github/workflows/ci.yml — runs on push/PR only
- lint (ESLint + Prettier)
- type check (tsc --noEmit)
- unit tests (Vitest) with mocked providers and scrapers
- no secrets needed for CI — providers are mocked
```

This shows CI discipline without exposing any real data or credentials. The scraper itself runs on Synology via Docker — never on GitHub's runners.

---

## ADR-009: Feedback loop via Telegram replies

**Decision:** User can reply to alert messages with ✅ or ❌ to signal preference. Feedback is stored and injected into future LLM prompts as few-shot examples.

**Why:**
- Static prompt never improves — same mistakes repeated forever
- Revealed preferences (what you actually click through on / buy) are more accurate than stated preferences
- Few-shot examples in system prompt are the cheapest way to teach an LLM without fine-tuning
- No ML infrastructure required

**How it works:**
1. User receives alert for a listing
2. Replies ✅ (liked, worth seeing more like this) or ❌ (wrong, don't surface similar)
3. Feedback stored in `feedback` table with listing attributes
4. Next run: last 10-15 positive and 10-15 negative examples injected into system prompt
5. LLM uses these as implicit scoring rubric — "items like these are YES, items like these are NO"

**What this requires:**
- Telegram bot webhook or polling to receive replies
- `feedback` table in SQLite
- System prompt builder that reads recent feedback and formats examples
- New schema: see 03-data-model.md

**Learning rate:** Meaningful signal after ~20-30 feedback events. Saturates around 50-100 — rotate to most recent 30 examples after that.
