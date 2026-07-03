---
name: fashion-monitor-config-and-flags
description: Every configuration axis of fashion-monitor — config.yaml keys, .env variables, DB-backed profile_settings, their authority order, defaults, and traps (including keys that are silently ignored). Load when adding/changing/reading any config value, when a setting "doesn't take effect", when adding a new config axis end-to-end, or when wiring secrets. Do NOT load for what the LLM knobs mean semantically (llm-scoring-reference), environment/build setup (fashion-monitor-build-and-env), or whether a config change is allowed (fashion-monitor-change-control).
---

# Fashion Monitor — Config and Flags

All facts verified against the working tree on 2026-07-02. The alert config is part of an **in-flight, uncommitted Telegram→ntfy migration** — the shapes below are the working-tree (new) state; `git status` will tell you if that migration has since been committed or reverted.

## The three config layers and who wins

| Layer | File/store | Role | Authoritative for |
|---|---|---|---|
| 1. `config.yaml` | repo root (gitignored; copy from `config.example.yaml`) | Bootstrap + infra | `database.path`, `alert.ntfy_url`, `alert.ntfy_topic`, fallback for everything else |
| 2. DB `profile_settings` | SQLite, per `profile_id`, key/JSON rows | Authoritative after first boot (ADR-007, spec/06-decisions.md) | Taste keys + system keys (list below) |
| 3. `.env` / process env | repo root (gitignored) | Secrets + web-app knobs | credentials, `NTFY_TOKEN`, `SESSION_SECRET`, `SECRETS_KEY`, admin bootstrap |

Resolution logic lives in `packages/core/src/core/profile-config.ts` (`loadProfileConfig`): each Taste/system key = `profile_settings` value if present, else `config.yaml` fallback. Monitors: DB Monitors (`scrape_queries` rows via `SearchGroupsRepo`) win **if any exist**; else the `searches:` block from yaml (the "Default Searches" of CONTEXT.md — bootstrap only, target end state is zero).

Persisted keys (from `profile-config.ts`):
- `TASTE_SETTING_KEYS`: `measurements`, `aesthetic_prompt`, `hard_no`, `positive_signals`, `price_ceiling`
- `SYSTEM_SETTING_KEYS`: `platforms`, `llm`, `alert_options`, `scraper`

Seeding (`packages/core/src/storage/seed.ts`, `seedProfileFromConfig`): idempotent — writes `profile_settings` from `config.yaml` **only when the profile's store is empty**, and Monitors only when no groups exist.

### THE trap: editing config.yaml after first boot does (mostly) nothing

Once `profile_settings` is seeded, yaml edits to Taste/platforms/llm/alert-mode are ignored — edit via web UI (`PUT /api/taste`, `PUT /api/system`) or MCP instead. Exceptions that ARE still read from yaml on every load: `alert.ntfy_url`, `alert.ntfy_topic`, `database.path`, and `searches` (only while no DB Monitors exist). Env substitution: any yaml string may contain `${VAR}`; a referenced-but-unset env var **throws** `Missing environment variable: VAR` at startup (`substituteEnvVars` in `config.ts`).

## config.yaml axis table

Schema of record: `packages/core/src/core/config.ts` (`ConfigSchema`) + `packages/shared/src/schemas/config.ts` (Llm/Measurements/PriceCeiling sub-schemas).

| Key | Type / allowed | Default | Notes |
|---|---|---|---|
| `profile_id` | string | `"default"` | scopes every DB row |
| `measurements.*` | all optional: height, weight_lbs, chest_in, waist_in, pants_size, dress_shirt_neck, dress_shirt_sleeve, typical_size | — | injected into scoring prompt |
| `aesthetic_prompt` | string, required, min 1 | — | the Taste core |
| `hard_no` | string[] | `[]` | hard rejection rules |
| `positive_signals.strong` / `.weak` | string[] | `[]` | |
| `price_ceiling.{tops,pants,outerwear}` | number, optional | — | see trap below |
| `price_ceiling.default` | number, **required** | — | |
| `platforms.{ebay,grailed,vestiaire,vinted,depop,poshmark}` | boolean each (partial record) | — | Vinted stays `false` (ADR-006) |
| `searches.<platform>[]` | `{id, q, groupId?, enabled=true, status=active\|needs_revision\|paused, note?}` | — | Default Searches, bootstrap only |
| `llm.provider` | `ollama\|claude\|hybrid\|mock` | `ollama` | |
| `llm.batch_size` | int 1–30 | `15` | text-pass batch |
| `llm.ollama_host` | URL, optional | — | direct Ollama today; broker is future direction (docs/adr/0006) |
| `llm.ollama_text_model` | string | `qwen2.5:7b` | |
| `llm.ollama_vision_model` | string, optional | — | needed for vision pass on ollama backend |
| `llm.claude_model` | string | `claude-haiku-4-5` | needs `ANTHROPIC_API_KEY` |
| `llm.vision_backend` | `ollama\|claude` | `ollama` | used when provider is `hybrid` |
| `alert.ntfy_url` | string, required | — (example: `http://ntfy`) | in-flight migration shape |
| `alert.ntfy_topic` | string | `fashion-monitor` | |
| `alert.ntfy_token` | string, optional | — | prefer env/secret store, see below |
| `alert.mode` | `immediate\|digest` | `immediate` | |
| `alert.notify_empty` | boolean | `false` | |
| `database.path` | string | `data/fashion_monitor.db` | |
| `scraper.poshmark_profile_path` | string | `data/poshmark-profile` | |

### Trap: silently-ignored price_ceiling keys

`config.example.yaml` sets `price_ceiling.boots: 450` and `accessories: 200`, but `PriceCeilingSchema` only knows `tops/pants/outerwear/default` — Zod strips unknown keys. `classifyPriceCategory` (`packages/core/src/pipeline/category.ts`) maps titles to only `outerwear|pants|tops`; a $400 boot classifies as "tops" and gets prefiltered out under a $300 tops ceiling even though you "configured" boots at $450. Fixing requires extending both the schema and the category mapper (gated change — new tests + example update; see fashion-monitor-change-control).

## .env inventory

From `.env.example` (names only — never commit values):

| Var | Consumer |
|---|---|
| `LOG_LEVEL` | Pino (`debug\|info\|warn\|error`) |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | **stale** — Telegram alerter deleted in the in-flight migration; kept in example pending doc reconciliation |
| `EBAY_CLIENT_ID`, `EBAY_CLIENT_SECRET` | eBay OAuth |
| `GRAILED_APP_ID`, `GRAILED_API_KEY` | Grailed Algolia |
| `ANTHROPIC_API_KEY` | claude/hybrid provider |
| `SCRAPFLY_API_KEY` | Vestiaire fallback |
| `GRAFANA_ADMIN_PASSWORD` | compose Grafana |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | first-boot owner bootstrap (idempotent; app refuses to start internet-exposed with no admin) |
| `SESSION_SECRET` | cookie signing (>=16 chars; ephemeral if unset — sessions drop on restart) |
| `SECRETS_KEY` | 64-hex-char key for encrypted `profile_secrets` (docs/adr/0002); required for Secrets editor |
| `COOKIE_SECURE`, `WEB_DOMAIN` | HTTPS/proxy settings |
| `NTFY_TOKEN` | **read by `profile-config.ts` but MISSING from `.env.example`** (in-flight migration gap) |
| `MCP_PORT` | MCP server (default 3102, `services/mcp-server/src/index.ts`) — also not in `.env.example`; set via compose or shell env |

Secret resolution order for the ntfy token (`resolveSecret` in profile-config.ts): env `NTFY_TOKEN` → encrypted `profile_secrets` key `ntfy_token` → `config.yaml alert.ntfy_token`.

## How to add a config axis (checklist)

1. Decide the layer: per-profile & user-editable → DB-backed system/Taste key; infra/secret → yaml/env only (see the comment atop `profile-config.ts`: secrets and db path are intentionally NOT in profile_settings).
2. Add to the Zod schema: shared sub-schemas in `packages/shared/src/schemas/config.ts` if the web app needs it; otherwise `packages/core/src/core/config.ts`.
3. Add to `config.example.yaml` with a comment (never to a committed personal config).
4. If DB-backed: add the key to `TASTE_SETTING_KEYS`/`SYSTEM_SETTING_KEYS`, wire it in `loadProfileConfig` raw object + `seedProfileFromConfig`.
5. If web-editable: extend `TasteInputSchema`/`SystemInputSchema` (shared), the API route, and the SPA form. Config changes snapshot into `config_revisions` automatically — verify a revision row appears after an edit.
6. Tests: schema parse/default test + a `loadProfileConfig` precedence test (DB wins over fallback).
7. Gate check: a new axis that changes user-visible behavior is a class-(d) change (ADR) per fashion-monitor-change-control; a plain knob is class (b).
8. Update this skill's axis table.

## When NOT to use this skill

- Meaning/tuning of LLM knobs → **llm-scoring-reference**
- Fresh environment or build failures → **fashion-monitor-build-and-env**
- Whether the change needs a gate/ADR → **fashion-monitor-change-control**
- Finishing the alert/feedback migration → **fashion-monitor-alerting-feedback-campaign**

## Provenance and maintenance

Verified 2026-07-02 against the uncommitted working tree.

- Re-derive axis table: `cat packages/core/src/core/config.ts packages/shared/src/schemas/config.ts`
- Setting keys still current: `grep -n "SETTING_KEYS" packages/core/src/core/profile-config.ts`
- Seed still idempotent-when-empty: `grep -n "isEmpty\|listGroups" packages/core/src/storage/seed.ts`
- price_ceiling trap still real: `grep -n "boots\|accessories" config.example.yaml packages/shared/src/schemas/config.ts packages/core/src/pipeline/category.ts` (trap holds while yaml has keys the schema lacks)
- NTFY_TOKEN still absent from example: `grep -c NTFY .env.example` (0 = gap persists)
- Alert schema shape (migration status): `git status --short packages/core/src/alerts/ && grep -n "ntfy" packages/core/src/core/config.ts`
