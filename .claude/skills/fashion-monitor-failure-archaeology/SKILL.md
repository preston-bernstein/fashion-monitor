---
name: fashion-monitor-failure-archaeology
description: Chronicle of every major fashion-monitor investigation, revert, dead end, rejected direction, and in-flight migration — each as symptom → root cause → evidence → status. Load this BEFORE re-litigating a past decision (Python, Postgres, ntfy, GitHub Actions, Vinted, parallel pipelines), before touching anything alert/feedback-related (a Telegram→ntfy migration is mid-flight in the uncommitted working tree), or when a doc contradicts the code and you need to know which one drifted. Do NOT load for live incident triage (use fashion-monitor-debugging-playbook) or for the rules derived from these incidents (use fashion-monitor-change-control).
---

# Fashion Monitor — Failure Archaeology

History of what went wrong, what was reversed, what was rejected, and what is still mid-flight in this repo. Read it to avoid re-running a dead investigation or "fixing" something that is deliberately half-migrated. All facts verified against the repo as of **2026-07-02**. The repo has **9 commits** (initial commit 5a862c8, 2026-06-08) plus a **large uncommitted working tree** — much of the real history lives in docs (`spec/06-decisions.md` legacy ADRs, `docs/adr/000*`, `docs/plans/*`), not in git.

Vocabulary follows `CONTEXT.md` (canonical terms: Monitor, Taste, Profile, Feedback, Pipeline, Connection). Read that file first if any term is unfamiliar.

## How to re-derive this history yourself (read-only git only)

```bash
# from the repo root
git log --format='%h %ad %s' --date=short        # all 9 commits, dated
git log --oneline --stat                          # what each commit touched
git log --diff-filter=D --name-only --format='COMMIT %h %s'   # every deletion ever
git status                                        # the in-flight migration
git diff --stat                                   # size of the uncommitted change
```

Never run mutating git here (`add`, `commit`, `checkout`, `stash`, `restore`) — the uncommitted working tree IS the in-flight migration state (Incident 4). Destroying it destroys unrecoverable work.

## Commit timeline (all 9, verified 2026-07-02)

| Date | Commit | Subject | Archaeology relevance |
|---|---|---|---|
| 2026-06-08 | 5a862c8 | Initial commit: fashion resale monitoring monorepo | Brought in the stale-CI workflows (Incident 6) |
| 2026-06-08 | 14c6b26 | chore: tighten gitignore and stop tracking build artifacts | Incident 1 |
| 2026-06-08 | 8cd39fb | chore: ignore npm package-lock files in pnpm monorepo | Incident 1 |
| 2026-06-08 | 59cc536 | feat: add Loki log stack and harden structured logging | — |
| 2026-06-08 | 592e704 | feat: search groups, listing images, monitors UI | Incident 2 (schema reversal) |
| 2026-06-09 | 9bda02c | feat: MCP server + sync spec to actual codebase | Incident 3 (spec drift) |
| 2026-06-09 | f9b6277 | chore: add Makefile deploy flow + named images in compose | — |
| 2026-06-10 | f93de89 | feat: add techwear as secondary aesthetic to taste config | — |
| 2026-06-10 | 338a2b3 | fix: correct NAS path to /volume1/docker/fashion-monitor | Incident 5 |

---

## Incident 1 — Build artifacts and an npm lockfile committed, then purged

- **Date:** 2026-06-08. **Status: resolved.**
- **Symptom:** generated files tracked in a fresh repo — four `tsconfig.tsbuildinfo` files and a 5,855-line `apps/web/package-lock.json` in a pnpm workspace.
- **Root cause:** initial commit landed before `.gitignore` covered monorepo build output; an `npm install` run inside `apps/web` (instead of `pnpm` at the root) generated a stray npm lockfile.
- **Fix:** commit `14c6b26` removed `apps/cli|packages/api|packages/core|packages/shared tsconfig.tsbuildinfo` + `apps/web/package-lock.json` and rewrote `.gitignore` (+39 lines); commit `8cd39fb` added the durable guard `**/package-lock.json` (`.gitignore` line 46, comment: "pnpm is the package manager; use root pnpm-lock.yaml").
- **Evidence:** `git show --stat 14c6b26`; `git show 8cd39fb`; `git log --diff-filter=D --name-only` lists all five purged files.
- **Lesson:** the only lockfile of record is root `pnpm-lock.yaml`. If `git status` ever shows a `package-lock.json` or `*.tsbuildinfo`, someone ran the wrong tool — do not commit it.

## Incident 2 — "monitors" → `search_groups` schema unification (the one schema reversal)

- **Date:** 2026-06-08. **Status: resolved — but leaves a permanent naming trap.**
- **Symptom:** the Monitor concept was originally modeled per-platform in `scrape_queries`; multi-platform Monitors had no first-class row, and the web app had a `monitors` Zod schema that no longer matched the storage design.
- **Root cause:** one logical Monitor spans several platforms; the flat per-platform model could not express that grouping.
- **Fix (commit `592e704`, 58 files):**
  - `packages/core/src/storage/migrations/012_search_groups.sql` — creates `search_groups` ("logical multi-platform monitors with per-platform execution rows", its own header comment) and rebuilds scorecard views.
  - `packages/core/src/storage/migrations/013_unify_search_groups.sql` — backfills orphan `scrape_queries` rows (`group_id IS NULL`) into `search_groups` + per-platform execution rows keyed `id || '@' || platform`.
  - Deleted `packages/shared/src/schemas/monitors.ts`; added `search-groups.ts`; renamed `apps/web/.../monitor-schema.ts` → `search-group-schema.ts`.
- **The trap:** `CONTEXT.md` keeps **"Monitor"** as the canonical user-facing term; the table is `search_groups`; API routes/UI files still say `monitors` (`packages/api/src/web/routes/monitors.ts`, `apps/web/src/pages/monitors.tsx`). This is deliberate layering, not drift. Never "clean up" one layer to match the other without change-control.
- **Evidence:** `git show --stat 592e704`; migration file headers; `git log --diff-filter=D` shows `packages/shared/src/schemas/monitors.ts` as the only source deletion in repo history besides Incident 1's artifacts (the working tree adds `telegram.ts`, Incident 4).

## Incident 3 — Spec drift: spec rewritten to match code, but residue remains

- **Date:** 2026-06-09 (resync); residue confirmed 2026-07-02. **Status: open (residual drift).**
- **Symptom:** `spec/01..07` described a design the codebase had moved past.
- **Root cause:** specs were written pre-implementation and not maintained as code evolved (classic write-once spec rot).
- **Fix:** commit `9bda02c` "feat: MCP server + sync spec to actual codebase" — 24 files, ~1,860 insertions: rewrote `spec/01..07`, added `spec/08-mcp-interactive.md`, `CONTEXT.md`, `docs/adr/0001`, `docs/adr/0002`, and the MCP server itself.
- **Known residual drift in `spec/README.md` (verified 2026-07-02):**
  - "Code layout" section says "Implementation lives under `src/`" — false; implementation lives under `packages/*/src`, `apps/*/src`, `services/mcp-server/src`.
  - The spec index table omits `07-search-intelligence.md` and `08-mcp-interactive.md` even though both files exist.
  - The status table marks every spec "Draft" — not updated since the resync.
  - The intro lists Vinted among watched platforms; Vinted is deferred (ADR-006, see rejected-directions table).
- **Lesson:** when spec and code disagree, code + `CONTEXT.md` + `docs/adr/` win; `spec/*` is a design snapshot that has already needed one full resync. Fixing the README residue is a legitimate small task — route it through fashion-monitor-change-control and fashion-monitor-docs-and-positioning.

## Incident 4 — Telegram → ntfy migration, IN FLIGHT and internally inconsistent (the hardest live problem)

- **Date:** working tree, observed 2026-07-02. **Status: OPEN / in-flight.** Executable fix plan: **fashion-monitor-alerting-feedback-campaign** (sibling skill) — do not improvise a fix from here.
- **Symptom:** the entire alert channel is being swapped in one uncommitted change, and the Feedback ingestion loop (the system's learning mechanism) is severed with **no replacement path at all**.
- **What the uncommitted tree does (all verified via `git status` / `git diff`):**

| Change | Evidence |
|---|---|
| `packages/core/src/alerts/telegram.ts` DELETED (109 lines) | `git status` shows `D`; `git diff --stat` |
| `packages/core/src/alerts/ntfy.ts` added, UNTRACKED | `git status` shows `??`; file exists, exports `createNtfyAlerter` |
| Orchestrator rewired to ntfy | `packages/core/src/pipeline/orchestrator.ts` lines 8 and 191 import/call `createNtfyAlerter` |
| `config.example.yaml` alert block now `ntfy_url` / `ntfy_topic` / optional `ntfy_token` | lines 114–117 |
| `docker-compose.yml` adds a `binwiederhier/ntfy` service (+ volumes) and puts feedback-bot behind a compose profile `["feedback"]` | `git diff docker-compose.yml` |
| `apps/cli/src/feedback-bot.ts` gutted to a disabled stub (107 lines removed) | stub logs `status: "disabled"`, comment: "Feedback will be available via the web dashboard." |

- **The inconsistencies (each one is a real contradiction, not sloppiness on your part if you notice it):**
  1. **ADR-011** (`spec/06-decisions.md` line 146) still says "ntfy.sh is not used" and defends Telegram ("Why not ntfy.sh", line 164). The working tree reverses this decision **without an ADR update** — see the rejected-directions table below for the honest account.
  2. **ADR-009** (`spec/06-decisions.md` line 237, "Feedback loop via Telegram replies") describes the now-deleted mechanism.
  3. **`CONTEXT.md`** (modified in the same working tree!) still says alerts go "via Telegram" (line 3) and defines Feedback as "signals recorded from Telegram replies" (line 60).
  4. **`Makefile`** — the `sync` target (itself part of this uncommitted change) still echoes `TELEGRAM_BOT_TOKEN=` / `TELEGRAM_CHAT_ID=` as first-deploy .env hints (lines 27–28).
  5. **The learning loop is fully severed:** the stub promises dashboard feedback, but `grep -rni feedback packages/api/src` returns **nothing** — no dashboard feedback endpoint exists. ntfy has no Telegram-style inline reply loop wired either. As of 2026-07-02 there is **no Feedback ingestion path of any kind**; the "prompt diet" (Taste + recent Feedback few-shots, spec/07) can no longer receive new examples.
- **Root cause:** channel swap started at the transport layer (alerter + compose) before the interaction layer (feedback ingestion) and the docs of record (ADR-011, CONTEXT.md, Makefile hints) were reconciled.
- **Handling rules:** do not commit, revert, or "finish" pieces of this tree ad hoc; do not update ADR-011/CONTEXT.md in isolation (that just moves the contradiction). The campaign skill sequences the whole close-out.

## Incident 5 — NAS deploy path wrong, then fixed

- **Date:** 2026-06-10. **Status: resolved.**
- **Symptom:** deploys targeted a NAS directory that didn't match where data/config actually live on the NAS.
- **Fix:** commit `338a2b3` changed `NAS_PATH` in `Makefile` and the deploy tree in `spec/02-architecture.md` from `/volume1/fashion-monitor` to `/volume1/docker/fashion-monitor`.
- **Evidence:** `git show 338a2b3` (2 files, 2 lines).
- **Lesson:** `Makefile` `NAS_PATH` is the single source of truth for the NAS data path; if a doc disagrees with the Makefile, the Makefile has already won once.

## Incident 6 — CI workflows stale: npm/node-20 in a pnpm/node-24 repo (broken as written)

- **Date:** present since initial commit 5a862c8 (2026-06-08); still broken 2026-07-02. **Status: OPEN — known weak point. Do not fix without change-control.**
- **Symptom:** `.github/workflows/ci.yml` and `live-smoke.yml` both use `actions/setup-node` with `node-version: "20"`, `cache: npm`, and `npm ci`.
- **Why that cannot work (verified):**
  - `package.json` declares `"packageManager": "pnpm@9.15.0+..."` and `"engines": { "node": ">=24" }`.
  - `**/package-lock.json` is gitignored (Incident 1, commit 8cd39fb) — `npm ci` has no lockfile to resolve from.
- **Blast radius:** `docs/SMOKE.md` (lines 15–29) repeats `npm ci` / `npm run ...`. Local truth is `pnpm install`, `pnpm test`, `pnpm run test:e2e`, etc.
- **Root cause:** workflows and SMOKE.md were written against an earlier npm-based assumption and never updated when the repo standardized on pnpm + Node >= 24; nothing forced the issue because CI wasn't gating anything.
- **Constraint on any fix:** repo is public with "CI = lint+typecheck+unit with mocked providers" intent (ADR-010, `spec/06-decisions.md`); `live-smoke.yml` implies real network — check ADR-0004 platform tiers before ever enabling it. Route the fix through fashion-monitor-change-control.

---

## Rejected and deferred directions (do not re-propose without new evidence)

Each of these was investigated and decided. Re-opening one requires the "Re-open when" condition or new data, via fashion-monitor-change-control.

| Direction | Verdict | Where decided | Rationale (compressed) | Re-open when |
|---|---|---|---|---|
| Python implementation | REJECTED | ADR-001, `spec/06-decisions.md` | Original spec chose Python; reversed — owner writes TypeScript daily, Playwright is Node-first; ecosystem edge not decisive | Effectively never; a per-tool Python dependency is a platform-level question |
| Postgres / Redis as primary store | REJECTED (SQLite chosen) | ADR-002 `spec/06-decisions.md` + `docs/plans/database-choice-2026.md` | Zero-ops single file suffices at personal scale; the 2026 plan re-examined it and held: Redis "cache or job queue, not system of record"; Litestream/LiteFS named as the middle step | More than one writer process, or public-SaaS deployment (triggers table in the plan doc) |
| GitHub Actions as scraper runner | REJECTED (NAS host) | ADR-005 `spec/06-decisions.md` (marked REVISED — spec originally used Actions) | Always-on Synology NAS with Container Manager beats scheduled Actions; Actions kept for CI only (ADR-010) | NAS decommissioned |
| ntfy.sh for alerts | REJECTED in ADR-011… then direction REVERSED in the uncommitted working tree (2026-07-02) | ADR-011 `spec/06-decisions.md` lines 146–164 vs Incident 4 evidence | Honest account: ADR-011 said Telegram + web app cover the need and ntfy "adds complexity without meaningful new capability"; the working tree adopts ntfy anyway and the ADR has NOT been superseded on paper. Until the migration lands with an updated ADR, the docs of record contradict the code | Already re-opened — resolve via fashion-monitor-alerting-feedback-campaign |
| Vinted platform | DEFERRED (disabled in v1) | ADR-006 `spec/06-decisions.md` | Datadome anti-bot + EU-skewed inventory + Python-only `vinted-scraper`; other 5 platforms suffice | v1 stable and the other five platforms working; ADR calls it "a one-config-flag change" |
| Per-profile schedules | DEFERRED | `docs/adr/0005-multi-profile-serial-pipeline.md` (untracked, in-flight) | Single global cadence looping all profiles is simpler and sufficient until someone needs different cadences | A profile actually needs a different cadence |
| Parallel profile execution | REJECTED (serial per tick) | `docs/adr/0005-multi-profile-serial-pipeline.md` | Inference is Ollama on one GPU — parallel profiles just contend for the same device; serial keeps per-profile `runs`/`integration_events` clean and load bounded; `max_monitors_per_profile` cap (default 25) bounds spend | GPU broker (below) provides real arbitration and a measured bottleneck appears |
| Direct GPU-broker consumption today | GAP — accepted design, not yet usable | `docs/adr/0006-inference-via-shared-gpu-broker.md` (untracked, in-flight) | ADR-0006 accepts routing inference through the shared `ollama-resource-broker` (its own repo), but states the KNOWN GAP: deployed broker V3 wraps CLI batch jobs / cgroup throttling and does NOT front Ollama's HTTP API yet. Today code calls `llm.ollama_host` directly; the `PENDING` score-replay state absorbs LLM-unavailable | Broker ships HTTP fronting (subject of that repo's own design work). Do not claim the broker path works today |

Note the pattern in the ADR trail itself: `docs/adr/0003`–`0006` are **untracked files** (visible in `git status` as `??`) — the newest decisions are part of the same uncommitted in-flight state as Incident 4.

## When NOT to use this skill

- **Something is broken right now** and you need triage steps → **fashion-monitor-debugging-playbook**. This skill explains *why* the bodies are buried, not how to stop the bleeding.
- **You want the rules** these incidents produced (what needs an ADR, what is non-negotiable, gating) → **fashion-monitor-change-control**.
- **You are executing** the ntfy/feedback close-out → **fashion-monitor-alerting-feedback-campaign**; the multi-profile work → **fashion-monitor-multi-profile-campaign**.
- **You need current design invariants** (not their history) → **fashion-monitor-architecture-contract**.

## Provenance and maintenance

All claims verified 2026-07-02 against `/Users/prestonbernstein/dev/fashion-monitor`. Re-verify before trusting any dated fact:

- Commit list still 9 + these hashes: `git log --format='%h %ad %s' --date=short`
- Incident 1 purge contents: `git show --stat 14c6b26` and `git show 8cd39fb`
- Incident 2 migrations exist: `ls packages/core/src/storage/migrations/01[23]_*.sql`
- Incident 3 residue still present: `grep -n 'lives under' spec/README.md` and `grep -c '07-search\|08-mcp' spec/README.md` (0 hits in index = still stale)
- Incident 4 still in flight: `git status --porcelain | grep -E 'alerts/(telegram|ntfy)|feedback-bot'`
- Incident 4 feedback endpoint still missing: `grep -rni feedback packages/api/src | wc -l` (0 = still severed)
- Incident 4 doc contradictions: `grep -n 'ntfy.sh is not used' spec/06-decisions.md`; `grep -n 'Telegram' CONTEXT.md`; `grep -n 'TELEGRAM' Makefile`
- Incident 5 path: `grep -n NAS_PATH Makefile`
- Incident 6 still broken: `grep -n 'node-version\|npm ci' .github/workflows/*.yml` vs `grep -n 'packageManager\|"node"' package.json`
- ADR 0003–0006 still untracked: `git status --porcelain docs/adr/`

If any check disagrees with this file, the repo wins — update the affected entry (status flips resolved/open, dates, evidence) and keep the incident numbering stable.
