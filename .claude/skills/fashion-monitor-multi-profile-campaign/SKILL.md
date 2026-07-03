---
name: fashion-monitor-multi-profile-campaign
description: Executable, decision-gated campaign to implement multi-profile execution in fashion-monitor — the serial per-profile pipeline tick (ADR-0005), the profile-isolation audit, and the max_monitors_per_profile cap, i.e. Phase 1 of docs/plans/self-service-onboarding.md. Load when asked to implement multi-tenancy, invites groundwork, per-profile pipeline runs, or the isolation audit. Runs AFTER the alerting/feedback migration settles (fashion-monitor-alerting-feedback-campaign) — the working tree must be clean first. Do NOT load for single-profile pipeline issues (fashion-monitor-debugging-playbook) or the invite/Connection features themselves (blocked behind this).
---

# Campaign: Multi-profile serial pipeline + isolation audit

Verified state 2026-07-02. docs/adr/0005 is **accepted but written in aspirational present tense** — "Each scheduled tick now lists active profiles" is NOT what the code does. Ground truth:

- `apps/cli/src/run.ts` runs exactly ONE profile: `loadProfileConfig(db, fileConfig.profile_id, ...)` — a second tenant would never run. (This matches ADR-0005's problem statement, not its solution.)
- `ProfilesRepo` (`packages/core/src/storage/repos/users.ts`) has only `ensure()` and `exists()` — **no list method**.
- `profiles` table (migration 008) has `id, name, created_at` — **no status/active column**; "active profiles" is not yet representable.
- `runs` table (migration 001) and `RunsRepo` have **no profile_id** — per-profile run stats are impossible today (`grep -c profile_id packages/core/src/storage/repos/runs.ts` → 0).
- `max_monitors_per_profile` appears ONLY in docs (`grep -rn max_monitors packages/ apps/` → nothing).
- Prerequisite plan: docs/plans/self-service-onboarding.md Phase 1 "blocks everything".

**Hard rules:** all schema changes are new numbered migrations (never edit applied ones — the runner re-executes every file each boot, so migrations must also be idempotent/re-runnable; see fashion-monitor-change-control). Serial execution only (fenced below). No commits without owner sign-off.

## Phase 0 — Preconditions and baseline

```bash
git status --porcelain          # MUST be clean or contain only your feature branch work.
                                # If the Telegram→ntfy diff is still uncommitted → STOP,
                                # run fashion-monitor-alerting-feedback-campaign first.
pnpm test                       # record the regression floor
sqlite3 -readonly data/fashion_monitor.db "SELECT id, name FROM profiles;"   # expect: default|default
grep -n "loadProfileConfig" apps/cli/src/run.ts                              # expect single-profile call
```

If `profiles` already has >1 row or run.ts already loops profiles → someone implemented part of this; diff reality against each phase's gate before writing anything.

## Phase 1 — Serial multi-profile tick (ADR-0005)

Design obligations (from the ADR — these are theory commitments, not suggestions):
- One scheduled tick → list profiles → run the EXISTING single-profile pipeline per profile, **serially** (single GPU; parallel = contention, fenced).
- Per-profile `runs` and `integration_events` rows.
- PENDING replay stays per-profile (seen_listings already keyed `(platform, id, profile_id)`).

Steps:
1. **Migration N+1** (next free number in `packages/core/src/storage/migrations/`): add `profile_id TEXT NOT NULL DEFAULT 'default'` to `runs` (SQLite: `ALTER TABLE ... ADD COLUMN` is re-runnable only with a guard — follow the existing migrations' `IF NOT EXISTS` discipline; for ADD COLUMN use a rebuild or a defensive check consistent with how `db.ts` executes migrations — read it first). Update `v_run_summary` (003's view) via `DROP VIEW IF EXISTS` + `CREATE VIEW` in the NEW migration, adding profile_id.
2. `RunsRepo`: scope inserts/queries by profile_id (constructor param like the other repos).
3. `ProfilesRepo.list(): {id,name}[]` — decide "active" semantics with the owner: simplest v1 = all profiles are active (no schema); if a status column is wanted, that's part of migration N+1. Label the choice in the PR/ADR notes.
4. `run.ts`: seed → `for (const p of profiles.list())` → `loadProfileConfig(db, p.id, {fallback: fileConfig, ...})` → `runPipeline` — sequential `await`, one profile's failure logged (`pipeline.run.failed`) but not aborting the loop (per-profile fault isolation; verify orchestrator error behavior first).
5. Keep `--platforms` filter behavior unchanged across all profiles.

**Gate:** with two profiles seeded in a scratch DB (`INSERT INTO profiles VALUES ('p2','p2',datetime('now'))` on a COPY of the dev DB, never the NAS one) and `llm.provider: mock`:
```bash
node apps/cli/dist/run.js --config config.yaml
sqlite3 -readonly <scratch.db> "SELECT profile_id, COUNT(*) FROM runs WHERE started_at > '<tick-start>' GROUP BY profile_id;"
```
Expect exactly 2 rows (default, p2), 1 run each. If you see 1 row → the loop didn't iterate (check list()); if rows share timestamps overlapping → you parallelized by accident (must be serial); if p2 run has 0 listings vs default's N → expected when p2 has no Monitors (its config falls back — decide and document whether profiles without Monitors are skipped; skipping is reasonable, log it).

## Phase 2 — Isolation audit (the plan calls this "a correctness gate, not a nicety")

Do this BEFORE any real second tenant exists. Produce an audit table in the PR description; every row needs a verdict.

```bash
for f in packages/core/src/storage/repos/*.ts; do echo "== $f"; grep -n "profile_id\|profileId" "$f" | head -3; done
```

2026-07-02 reference counts (re-run, don't trust): scoped repos (constructor takes profileId, WHERE clauses filter): search-groups(36), seen-listings(20), users/profiles(17), search-group-images(17), profile-secrets(14), profile-settings(13), scrape-queries(13), listing-images(11), audit-log(9), config-revisions(9), integration-health(9), alert-log(5), feedback(5). **Zero-scoped: runs.ts (fixed in Phase 1).** sessions.ts(4) is user-scoped by design (sessions belong to users, not profiles) — verify, don't assume.

Checklist per repo: every SELECT/UPDATE/DELETE on profile-owned data filters `profile_id = ?`; no query interpolates a profile id from anywhere but the repo's constructor. Then the API layer: `packages/api/src/web/context.ts` — capability checks resolve through the requesting user's membership for THAT profile (read the code; multi-profile users must not act on profiles they lack a membership for). Any unscoped query on profile-owned data = **blocking finding**, fix before proceeding.

**Gate:** audit table complete; a cross-profile leak test added (e.g. repo test: rows written as p1 invisible via p2-scoped repo). `pnpm --filter @fm/core test` green.

## Phase 3 — max_monitors_per_profile cap

Enforce at Monitor-create in `@fm/api` (per plan §Phase 1.3), default 25. Read the existing monitors POST route first and mirror its error convention (read, don't guess, the error shape the SPA expects). Config axis: add per fashion-monitor-config-and-flags checklist (system key or constant — plan says default 25; a constant with a TODO-free comment is acceptable v1; document choice).

**Gate:** API test — 25 creates succeed, #26 returns the documented error status; MCP `add_monitor` path enforces the same cap (check `services/mcp-server/src/tools/add-monitor.ts` — if it writes via the same repo, add the check at the repo/service layer so both interfaces share it).

## Phase 4 — Validation and promotion

1. `pnpm test` — no regressions vs floor; new tests: serial loop, leak test, cap test.
2. Two-profile end-to-end on scratch DB (Phase 1 gate re-run) + `funnel.sh` shows per-profile rows once the view includes profile_id.
3. Docs through change control: mark ADR-0005 implemented (status note, dated), update self-service-onboarding.md Phase 1 checkboxes, CONTEXT.md untouched unless vocabulary changed.
4. Owner commits.

**"You are done when":** one tick on a two-profile DB yields two serial runs rows with correct profile_id, the isolation audit table has no open blocking findings, Monitor #26 is rejected on both API and MCP paths, and ADR-0005's present tense is finally true.

## Fenced wrong paths

| Path | Why fenced |
|---|---|
| Parallel profile execution | Single shared GPU — contention, and per-profile stats interleave (ADR-0005 explicitly rejected) |
| Per-profile schedules | Deferred by ADR-0005; single global cadence |
| Building invites/Connections/health pages first | Plan: Phase 1 "blocks everything" |
| Per-profile billing/quotas beyond the cap | Out of scope (plan non-goals) |
| Editing migration 001/003 to add profile_id | Applied migrations are immutable; new migration only |

## When NOT to use this skill

- Alert/feedback migration → **fashion-monitor-alerting-feedback-campaign** (prerequisite)
- Pipeline architecture questions → **fashion-monitor-architecture-contract**
- What evidence counts → **fashion-monitor-validation-and-qa**

## Provenance and maintenance

- Still single-profile? `grep -n "loadProfileConfig" apps/cli/src/run.ts`
- runs still unscoped? `grep -c profile_id packages/core/src/storage/repos/runs.ts` (0 = unscoped)
- Cap still unimplemented? `grep -rn max_monitors packages/ apps/ services/`
- ProfilesRepo methods: `grep -n -A2 "class ProfilesRepo" packages/core/src/storage/repos/users.ts`
- Plan/ADR text: `cat docs/adr/0005-multi-profile-serial-pipeline.md docs/plans/self-service-onboarding.md`
