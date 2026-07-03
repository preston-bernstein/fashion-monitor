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

**Superseded by `docs/adr/0007-ntfy-over-telegram-for-push-alerts.md` (2026-07-03) — push alerts now go through self-hosted ntfy.**

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

## ADR-007: Taste config in DB, not hardcoded

**Decision:** Taste (aesthetic_prompt, hard_no, positive_signals, price_ceiling, measurements) lives in the `profile_settings` DB table, editable via web UI (Curator role) and MCP server. `config.yaml` provides bootstrap defaults.

**Context:** The LLM scoring prompt is the core "intelligence" of the system and will need tuning as preferences evolve. Per-profile isolation also requires that Taste be stored per-profile in the DB, not in a flat file.

**Why DB-backed:**
- Editable via web UI without touching config files or redeploying
- Per-profile isolation — each profile's Taste is independent
- `config_revisions` table tracks every change with a hash + timestamp — full audit trail
- MCP server can write Taste directly from an LLM conversation
- `config.yaml` bootstrap defaults are loaded into `profile_settings` on first run, then the DB is authoritative

---

## ADR-011: Notification delivery — Telegram primary, web app for history review

**Superseded by `docs/adr/0007-ntfy-over-telegram-for-push-alerts.md` (2026-07-03) — "ntfy.sh is not used" below no longer holds; push alerts now go through self-hosted ntfy. The web-app-for-history-review reasoning still stands.**

**Decision:** Telegram Bot API for push alerts. Web app (`apps/web`) provides browsable alert history and analytics as a secondary review interface. ntfy.sh is not used.

**Context:** Multiple notification approaches evaluated. Key constraint: push notification is non-negotiable (listings sell within hours). Active dashboard-checking alone won't work in practice.

**Why Telegram for push:**
- Zero hosting required — just HTTP POST to `api.telegram.org`
- Native inline keyboard buttons (✅/❌) enable the feedback loop without a webhook server
- Inline image delivery — critical for clothing decisions
- Free, instant push on iOS/Android
- One bot serves multiple profiles via separate chat IDs

**Why web app for history review (built):**
- Browsable alert history with full images, filters, and scoring dimensions
- Accessible from any device on the network
- Multi-user management (invite family/friends, set Roles)
- Analytics: Monitor scorecard, feedback ratio, config timeline
- No third-party dependency — runs entirely on Synology

**Why not ntfy.sh:** Web app covers the self-hosted browsing use case. Adding ntfy alongside Telegram adds complexity without meaningful new capability.

**Why not email:** Push unreliable (Promotions tab, delays). Feedback buttons require hosted webhook.
**Why not SMS:** No inline images. Costs money (Twilio). Feedback loop requires hosted webhook.

---

## ADR-008: Two-pass scoring — images for MAYBE items only (REVISED)

**Decision:** Two-pass scoring. Pass 1: text-only (Ollama batch) for all new listings. Pass 2: vision scoring via configurable backend (Ollama or Claude) for MAYBE items with `image_url` only.

**Context:** Original spec deferred image scoring as optional. A later revision proposed images for all listings. The implemented approach is the pragmatic middle: text first, vision only where it matters (ambiguous MAYBE cases).

**Why two-pass over all-image scoring:**
- Vision tokens are 5-15× more expensive than text tokens — scoring all listings with images multiplies cost significantly
- Text classification (YES/NO) is reliable for clear matches and clear misses
- Images add the most value for ambiguous MAYBE items where text alone is insufficient
- At steady state, only 2-5 MAYBE items per run reach vision — cost impact is negligible

**Pass 2 behavior:**
- MAYBE items with `image_url` → vision re-score → YES or NO (or stays MAYBE on parse error)
- MAYBE items without `image_url` → stay MAYBE, alert with lower-confidence note
- Post-vision MAYBE still alerts — it signals ambiguity, not disqualification
- `filterAlertable` includes both YES and MAYBE regardless of whether vision ran

**Vision backend selection:**

| VRAM | Text (pass 1) | Vision (pass 2) | Config |
|------|--------------|-----------------|--------|
| < 6 GB | `qwen2.5:7b` Q4 | Claude API | `hybrid`, `vision_backend: claude` |
| 6–10 GB | `qwen2.5:7b` | `llava:7b` or Claude | `hybrid`, `vision_backend: ollama` |
| 12–16 GB | `qwen2.5:7b` | `llama3.2-vision:11b` | `ollama` |
| CPU only | too slow | too slow | `claude` |

See `packages/core/src/pipeline/scorer.ts` for the implementation. See `packages/core/src/llm/hybrid.ts` for `HybridProvider`.

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

---

## docs/adr/0001: MCP server is the primary interface

See `docs/adr/0001-mcp-as-primary-interface.md`. MCP manages Monitors and Taste conversationally. Web app is secondary. CLI is pipeline/debug only.

---

## docs/adr/0002: Secrets stored encrypted in DB

See `docs/adr/0002-secrets-encrypted-in-db.md`. Platform credentials and Telegram tokens are XChaCha20-Poly1305 encrypted in `profile_secrets`. Encryption key is the only secret in `.env`.

---

## docs/adr/0007: ntfy over Telegram for push alerts

See `docs/adr/0007-ntfy-over-telegram-for-push-alerts.md`. Supersedes ADR-004 and ADR-011 above — push alerts now go through a self-hosted ntfy instance instead of the Telegram Bot API.
