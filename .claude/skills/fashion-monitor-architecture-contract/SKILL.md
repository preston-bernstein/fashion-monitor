---
name: fashion-monitor-architecture-contract
description: Load-bearing architecture of fashion-monitor — the monorepo dependency contract, pipeline stage order, hard invariants (profile_id scoping, DB-over-config authority, PENDING replay, alertability, RBAC, secrets, telemetry tiers), the WHY behind TypeScript/SQLite/Synology/serial-multi-profile/GPU-broker decisions, and the known-weak points as of 2026-07-02. Load this BEFORE designing a change, adding a package, touching the pipeline, the schema, or anything cross-cutting — it tells you which walls are load-bearing. Do NOT load for gate/approval process (use fashion-monitor-change-control), config mechanics (fashion-monitor-config-and-flags), or executing the in-flight migrations (the *-campaign skills).
---

# Fashion Monitor — Architecture Contract

What must stay true about this system and why. Every claim below was verified against the repo on 2026-07-02. Vocabulary follows `CONTEXT.md` (canonical terms: Monitor, Taste, Profile, Role, Score, Secret, Connection, Pipeline, Feedback).

## 1. Monorepo dependency contract

pnpm workspaces + Turborepo, Node >= 24 (`engines`), `packageManager: pnpm@9.x`.

| Package | Name | Depends on (workspace) | Role |
|---|---|---|---|
| `packages/shared` | `@fm/shared` | — (zod only) | Zod schemas, DTOs, RBAC roles/capabilities |
| `packages/core` | `@fm/core` | `@fm/shared` | pipeline, platforms, storage + 14 migrations, llm, alerts, analytics |
| `packages/api` | `@fm/api` | `@fm/core`, `@fm/shared` | Fastify JSON API, serves built SPA |
| `apps/web` | `@fm/web` | `@fm/shared` ONLY | React SPA (Vite/React 19/Tailwind 4) |
| `apps/cli` | `@fm/cli` | `@fm/api`, `@fm/core` | `run`, `feedback-bot`, `report`, `dashboard` entrypoints |
| `services/mcp-server` | `@fm/mcp-server` | `@fm/core`, `@fm/shared` | MCP SSE server (4 tools) |

**The rule that matters:** `@fm/web` imports `@fm/shared` only. At runtime the SPA talks to the API over HTTP. **Why:** request/response contracts are Zod schemas in `@fm/shared`, consumed by both API (validation) and SPA (types + client-side parse). There is no second, hand-mirrored set of DTOs to drift. Adding a `@fm/core` import to the web app would drag better-sqlite3/Playwright into a browser bundle and break the contract — never do it.

**Turbo build order** (`turbo.json`): `build` has `dependsOn: ["^build"]` (topological), plus one explicit edge — `@fm/api#build` also `dependsOn: ["@fm/web#build"]`. The api build script is `tsc && node scripts/copy-web.mjs`, which copies `apps/web/dist` into `packages/api/dist/public` so the API serves the SPA from its own dist. If `apps/web/dist` is missing, `copy-web.mjs` warns and exits 0 (backend-only build is legal). `@fm/core`'s build also copies its SQL migrations into dist (`scripts/copy-migrations.mjs`) — migrations ship inside the built package.

## 2. Pipeline stage order (as implemented)

`packages/core/src/pipeline/orchestrator.ts`, function `runPipeline(ctx: RunContext)`. Exact call sequence:

1. **Housekeeping**: `seenRepo.pruneOlderThan(90)`, `runsRepo.pruneOlderThan(30)`, `integrationHealthRepo.pruneOlderThan(30)`; `searchGroupsRepo.syncFromConfig(...)`; `runsRepo.start(...)`; `configRevisionsRepo.maybeSnapshot(...)`.
2. **Scrape**: `scrapeAll(scrapers, queriesByPlatform, runId)` — all platform scrapers concurrently via `Promise.all`; per-platform failure becomes an error string, not a run abort. Then `recordScrapeOutcomes(...)` → `integration_events`.
3. **Dedupe**: `dedupePipeline(listings, seenRepo)` — drops already-seen `(platform, id, profile_id)` rows and in-run cross-query duplicates.
4. **Prefilter**: `prefilterListings(deduped, config)` — free (no LLM) rejections; rejected listings are `seenRepo.markSeen(listing, "NO", ...)` so they never come back.
5. **LLM health gate**: `recordTimedHealthCheck(..., provider.healthCheck(), ...)`. If unhealthy: every passed listing gets `seenRepo.markPending(...)`, query stats + run row are still recorded, and the run returns early. No scoring, no alerts.
6. **PENDING replay + score**: `seenRepo.fetchPendingListings()` backlog is merged with this run's listings via `mergeListings(pendingBacklog, passed)`, then `scoreListings(toScore, config, provider, feedbackRepo)` — two-pass (text batch, then vision for MAYBE-with-image; see the llm-scoring-reference skill). Scores persisted via `seenRepo.recordScore(...)`.
7. **Alert**: `filterAlertable(scoreResult.scored)` (YES + MAYBE), `createNtfyAlerter(config.alert)`, then per `config.alert.mode` either `alerter.sendDigest(...)` + `recordAlertsSent(...)` or per-listing `alerter.sendAlert(...)` + `recordAlertSent(...)`. Each delivery outcome → `recordAlertDelivery(...)` (`integration_events`). Optional `sendEmptyRunNotice()` when `notify_empty` and nothing alertable.
8. **Bookkeeping**: `scrapeQueriesRepo.recordQueryRuns(runId, queryTracker.toArray())` (per-query stats via `QueryRunTracker`), `runsRepo.finish(...)`. On throw: `recordPipelineFailure(...)`, query stats still flushed, `runsRepo.finish(...)` with the error, rethrow.

Design intent behind the order: everything cheap and deterministic (dedupe, prefilter) runs before the expensive, unreliable dependency (LLM); the LLM being down degrades to "scored later," never to "listing lost" or "unscored alert."

## 3. Invariants — do not break these

| # | Invariant | Enforced where | Why |
|---|---|---|---|
| I1 | Every profile-owned row is scoped by `profile_id`. Repos take `(db, profileId)` in their constructors. Exception: `runs` is currently global (no `profile_id` column — see W4). | migrations 001/004/006/008/009/010; repo constructors in `orchestrator.ts` | Multi-Profile isolation (ADR-0003/0005) is scoping, not separate DBs. A query missing the `profile_id` predicate is a cross-tenant leak. |
| I2 | After bootstrap, the DB is authoritative over `config.yaml` (ADR-007, spec/06-decisions.md). `config.yaml` seeds `profile_settings` on first run (`seedProfileFromConfig`, `packages/core/src/storage/seed.ts`); thereafter `loadProfileConfig(db, profileId, { fallback })` (`packages/core/src/core/profile-config.ts`) reads DB first. | `storage/seed.ts`; `core/profile-config.ts`; `apps/cli/src/run.ts` | Taste is editable via web UI/MCP without redeploys; `config_revisions` gives the audit trail. Editing `config.yaml` and expecting a live behavior change is the classic footgun. |
| I3 | Never alert an unscored listing. `PENDING` is a pipeline-internal Score state, never user-visible; PENDING listings replay on the next healthy run (`fetchPendingListings` → `mergeListings`). | orchestrator steps 5–6 | LLM-down must degrade gracefully with zero paid-API fallback (spec/02: never auto-fallback to paid API). |
| I4 | Alertable = YES + MAYBE, and post-vision MAYBE still alerts (ADR-008). `filterAlertable` in `packages/core/src/pipeline/scorer.ts` filters `score === "YES" || score === "MAYBE"`. | `scorer.ts` | MAYBE signals lower confidence, not disqualification; suppressing MAYBE silently changes recall against the >60%-interesting success bar. |
| I5 | RBAC is enforced server-side per route via `requireCapability(ctx, cap)` (`packages/api/src/web/context.ts`); the SPA hiding controls from `/api/me` is cosmetic only. Role → capability map lives in `packages/api/src/web/rbac.ts` (`ROLE_CAPABILITIES`); role/capability vocab in `packages/shared/src/rbac.ts` (5 roles, 11 capabilities). | `context.ts`, `app.ts` preHandler | The comment in `context.ts` says it plainly: "The server is the source of truth." Never treat SPA visibility as a security boundary. Forbidden mutating requests are audited (`auth.forbidden`). |
| I6 | Secrets live encrypted (XChaCha20-Poly1305, `@noble/ciphers`) in `profile_secrets`; the only secret in `.env` is the root encryption key (docs/adr/0002). | `packages/core/src/lib/secrets-crypto.ts`, migration 010 | Per-profile secret isolation through the web UI; plaintext never persists; `.env` doesn't grow per profile. Never add a per-profile credential to `.env`. |
| I7 | Three telemetry tiers, never conflated: `audit_log` = who changed what (security); `config_revisions` = config snapshots per run (reproducibility); `integration_events` = external-dependency health (ops). | migrations 010/009/006; docs/web-app.md | Each answers a different question with different retention and RBAC exposure (`integration_events` is stripped for users without `secrets:read`). Writing ops noise into `audit_log` destroys its value. |
| I8 | Migrations are append-only numbered SQL files in `packages/core/src/storage/migrations/` (001–014 as of 2026-07-02), applied in sorted order by `migrate()` in `storage/db.ts`. Never edit a shipped migration; add a new number. | `storage/db.ts` | `migrate()` runs every file every boot (files must be idempotent — `IF NOT EXISTS` etc.); non-idempotent column adds go through the `COLUMN_PATCHES` table in `db.ts`. The one schema reversal (monitors → `search_groups`, migrations 012/013) was done this way, not by rewriting history. |
| I9 | Interface hierarchy: MCP server > web app > CLI (docs/adr/0001). MCP is the primary interface (conversational Monitor/Taste management); web is a strong secondary (multi-user, analytics, audit); CLI is pipeline execution + debug only. | ADR-0001 | New user-facing capability should land in MCP/web, not as a CLI flag. |

## 4. Why the big decisions went the way they did

- **TypeScript / Node >= 24** — developer's primary language; Playwright is Node-first; Zod contracts shared end-to-end (spec/02 tech-stack table). Backend is NodeNext ESM, SPA is bundler-mode.
- **SQLite (better-sqlite3, WAL, foreign_keys ON)** — single-writer personal-scale workload on a NAS local volume; synchronous C bindings; zero setup. Explicit rule: DB on NAS **local** disk, never over NFS/SMB (spec/02). `openDatabase()` in `storage/db.ts` sets the pragmas.
- **Synology NAS deploy** — always-on, already owned, no cloud spend; Docker images built on the dev machine and shipped via `docker save | ssh ... docker load` (Makefile) because the NAS shouldn't build. Scheduling via Synology Task Scheduler.
- **Serial multi-profile pipeline (docs/adr/0005, accepted)** — one tick iterates active Profiles serially, not in parallel, because inference is one GPU: parallel profiles just contend; serial keeps per-profile `runs`/`integration_events` clean and bounds load. `max_monitors_per_profile` cap (default 25) bounds spend at Monitor-create time. **Not yet implemented** — see W4.
- **GPU broker direction (docs/adr/0006, accepted with an honest gap)** — inference should go through the shared `ollama-resource-broker` (separate repo) that queues/prioritizes/yields when the GPU is otherwise busy. The ADR itself states the known gap: the deployed broker wraps CLI batch jobs and cgroup-throttles Ollama; it does **not** front Ollama's HTTP API, which is how this code actually calls it. So today the code calls `llm.ollama_host` from config directly, and `PENDING` replay (I3) absorbs LLM-unavailable. Do not claim the broker path works today; do not build duplicate backpressure in this repo — the ADR's point is that PENDING already is the backpressure.
- **ntfy over Telegram (in-flight, uncommitted)** — orchestrator imports `createNtfyAlerter` from `packages/core/src/alerts/ntfy.ts`; `telegram.ts` is deleted in the working tree. Rationale is self-hosting/no-third-party, but see W1/W2: the migration is half-done and it severed the Feedback loop.

## 5. Known weak points (as of 2026-07-02 — plainly)

| # | Weak point | Evidence |
|---|---|---|
| W1 | **Feedback loop severed. No ingestion path exists at all.** `apps/cli/src/feedback-bot.ts` is a stub that logs "Feedback bot is disabled. Use the dashboard to record feedback." — but no dashboard feedback endpoint exists (`grep -rni feedback packages/api/src` returns nothing). The prompt diet (last 15 pos/15 neg Feedback rows) can no longer receive new rows. Hardest live problem (assumption A1, coordinator-approved). | stub file; grep; `FeedbackRepo` still read by `scoreListings` |
| W2 | **Telegram→ntfy migration half-done and undocumented.** Working tree (uncommitted): `alerts/telegram.ts` deleted, `alerts/ntfy.ts` untracked, orchestrator + `config.example.yaml` on ntfy. But ADR-011 (spec/06-decisions.md) still says "ntfy.sh is not used," CONTEXT.md and README.md still say Telegram, Makefile still echoes `TELEGRAM_*` env hints. Committed state and working-tree state disagree. Fix path: fashion-monitor-alerting-feedback-campaign. | `git status`; ADR-011 text; Makefile lines 27–28 |
| W3 | **CI is broken as written.** `.github/workflows/ci.yml` and `live-smoke.yml` use `node-version: "20"` + `cache: npm` + `npm ci` against a pnpm@9 workspace with `engines` Node >= 24 and no npm lockfile committed — `npm ci` cannot resolve. Local truth is `pnpm install` / `pnpm test`. | workflow files lines 17–20 / 14–17 |
| W4 | **Multi-profile runner accepted but not implemented.** Verified in code: `apps/cli/src/run.ts` loads one config and calls `runPipeline` exactly once for `fileConfig.profile_id`; there is no loop over active Profiles. Also `runs` has no `profile_id` column (migration 001; orchestrator constructs `new RunsRepo(ctx.db)` without a profileId, unlike every other repo), so per-profile run history isn't separable yet. ADR-0005 is direction, not state. Fix path: fashion-monitor-multi-profile-campaign. | `run.ts`; `001_init.sql`; orchestrator line constructing `RunsRepo` |
| W5 | **Broker doesn't front HTTP inference.** Per ADR-0006's own "Known gap" — code calls Ollama directly at `llm.ollama_host`; contention with other GPU consumers is handled only by cgroup throttle + PENDING replay. | ADR-0006 text |
| W6 | **Spec drafts are partially stale.** spec/02-architecture.md says the API is Hono (it's Fastify — `packages/api/package.json`), lists a `packages/platforms/` that doesn't exist (platforms live in `packages/core/src/platforms/`), says Node 20+ (engines require >= 24), and diagrams Telegram alerts + an always-on Telegram feedback bot (see W1/W2). Trust code and `docs/adr/*` over `spec/*` on conflict; CONTEXT.md governs vocabulary. | spec/02 vs package.json/repo layout |

Assumed — confirm with owner (labeled per brief): personal config/data never enter this public repo; prefer fixtures over live scrapes during development; never commit/push without the owner's say-so.

## 6. When NOT to use this skill

- **Deciding whether a change is allowed / needs an ADR or gate** → `fashion-monitor-change-control` (canonical for gating; this skill only tells you which walls are load-bearing).
- **Config axes, defaults, precedence mechanics, adding a flag** → `fashion-monitor-config-and-flags`.
- **Actually executing the fixes for W1/W2** → `fashion-monitor-alerting-feedback-campaign`; for W4 → `fashion-monitor-multi-profile-campaign`.
- Symptom-driven debugging → `fashion-monitor-debugging-playbook`. Build/env setup → `fashion-monitor-build-and-env`.

## Provenance and maintenance

All facts verified against the repo at `/Users/prestonbernstein/dev/fashion-monitor` on 2026-07-02 (mid-migration working tree). Re-verify before trusting any volatile claim:

- Dependency contract: `grep -A4 '"dependencies"' packages/*/package.json apps/*/package.json` — confirm `apps/web` still lists only `@fm/shared` among workspace deps.
- Turbo edge + SPA copy: `cat turbo.json` (look for `@fm/api#build` → `@fm/web#build`) and `cat packages/api/scripts/copy-web.mjs`.
- Pipeline stage order + function names: read `packages/core/src/pipeline/orchestrator.ts` (`runPipeline`).
- Alertability: `grep -n filterAlertable packages/core/src/pipeline/scorer.ts`.
- Migration count / append-only list: `ls packages/core/src/storage/migrations/`.
- RBAC server-side truth: `grep -n requireCapability packages/api/src/web/context.ts packages/api/src/web/routes/*.ts`.
- W1 still true? `grep -rni feedback packages/api/src | head` (any hit means a dashboard feedback endpoint may now exist — re-read before repeating W1).
- W2 still true? `git -C . status --short | grep -E 'telegram|ntfy'` and `grep -n "ntfy" spec/06-decisions.md CONTEXT.md README.md`.
- W3 still true? `grep -n "npm ci\|node-version" .github/workflows/*.yml`.
- W4 still true? `grep -n "runPipeline\|profile" apps/cli/src/run.ts` and `grep -n profile_id packages/core/src/storage/migrations/001_init.sql` (runs table).
- W5: re-read `docs/adr/0006-inference-via-shared-gpu-broker.md` "Known gap" paragraph.
