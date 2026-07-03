---
name: fashion-monitor-alerting-feedback-campaign
description: Executable, decision-gated campaign to finish fashion-monitor's hardest live problem — the uncommitted Telegram→ntfy alert migration and the fully severed feedback-ingestion loop (no bot, no API endpoint, prompt diet starving). Load when asked to work on alerts, ntfy, Telegram remnants, the feedback loop, or "finish the migration". Follow phases in order; every gate has expected observations. Do NOT load for day-to-day alert debugging (fashion-monitor-debugging-playbook), scoring theory (llm-scoring-reference), or the multi-profile work (fashion-monitor-multi-profile-campaign — run that AFTER this settles).
---

# Campaign: Finish the ntfy migration and restore the feedback loop

State as of 2026-07-02 (re-verify in Phase 0 — this WILL drift). The learning loop (alert → user feedback → few-shot prompt injection → better scoring) is the product's core differentiator (ADR-009, spec/06-decisions.md) and is currently severed. Success is measured, never eyeballed.

**Hard rules:** never commit, revert, or partially clean up the in-flight diff without an explicit owner decision (Phase 1). All behavior changes route through fashion-monitor-change-control. Assumption A1 (this is the top-priority problem) is owner-endorsed via coordinator, 2026-07-02.

## Phase 0 — Baseline snapshot (read-only; record everything)

```bash
git status --porcelain            # expect: 11 modified + 1 deleted (alerts/telegram.ts) = 12 changed files,
                                  # untracked: alerts/ntfy.ts, docs/adr/0003-0006, docs/plans/self-service-onboarding.md
git diff --stat                   # expect ≈ 77 insertions / 241 deletions across 12 files
grep -rni feedback packages/api/src | wc -l    # expect 0  → loop severed
head -12 apps/cli/src/feedback-bot.ts          # expect disabled stub, "Use the dashboard to record feedback."
.claude/skills/fashion-monitor-diagnostics-and-tooling/scripts/feedback-diet.sh   # expect empty/old rows only
pnpm test                         # record pass/fail per package — this is your regression floor
```

- If `git status` is clean → the migration was committed or reverted since 2026-07-02. STOP, read `git log --oneline -5`, and re-scope: Phases 2–3 may be done; Phase 4 (feedback) is still needed unless `grep -rni feedback packages/api/src` now hits.
- If `pnpm test` fails → record failures; they are pre-existing context, not yours to hide. Anything you touch must not add failures.

## Phase 1 — Owner decision gate (cannot be skipped or assumed)

Present the owner this exact decision set:
1. **Commit direction ntfy** (recommended default — code, compose, and config.example already point there) — proceed to Phases 2–5.
2. **Keep Telegram** — the diff must be reverted deliberately by the owner; this campaign then re-scopes to "restore feedback via Telegram bot" (the old bot code is recoverable: `git show HEAD:apps/cli/src/feedback-bot.ts`, `git show HEAD:packages/core/src/alerts/telegram.ts`).
3. **Hybrid** (ntfy alerts + separate feedback path) — proceed, Phase 4 menu decides the path.

Gate: a recorded owner decision. If you cannot reach the owner, stop here — everything below assumes direction 1 or 3.

## Phase 2 — Complete and verify the ntfy alert path

The working-tree alerter (`packages/core/src/alerts/ntfy.ts`) is functionally complete for delivery: `NtfyAlerter` implements `AlertClient` (`sendAlert`/`sendDigest`/`sendEmptyRunNotice`), posts to `{ntfy_url}/{ntfy_topic}` with `X-Title`/`X-Priority`/`X-Tags`/`X-Click`, optional `Authorization: Bearer {ntfy_token}`. Compose has an `ntfy` service (host port `${NTFY_PORT:-8282}`). Known gaps to close:

| # | Gap | Fix | Gate |
|---|---|---|---|
| 2.1 | **No tests for ntfy.ts** (telegram tests were deleted with telegram.ts) | Port the alerter test pattern: mock `fetchWithTimeout`, assert endpoint/headers/body for YES vs MAYBE, digest, empty-run, token header, non-ok → `alerts.send.failed` | `pnpm --filter @fm/core test` green with new tests listed |
| 2.2 | `.env.example` lacks `NTFY_TOKEN`, still lists `TELEGRAM_*` | add/remove accordingly | `grep -c NTFY .env.example` ≥ 1; TELEGRAM gone |
| 2.3 | Makefile first-deploy hints echo `TELEGRAM_*` | update to ntfy vars | `grep -n TELEGRAM Makefile` → no hits |
| 2.4 | End-to-end delivery unproven | `docker compose up -d ntfy`, subscribe (`curl -s http://localhost:8282/fashion-monitor/json &`), run pipeline with `llm.provider: mock` and one cheap Monitor | subscriber prints an alert JSON with your `X-Title`; log shows no `alerts.send.*` errors |
| 2.5 | **`integration_events` still labels alert deliveries `alerts:telegram`** — `recordAlertDelivery` in `packages/core/src/pipeline/integration-events.ts` hardcodes `integration: "alerts:telegram"` and the fallback error text says "telegram send returned false" (see debugging-playbook Trap 1) | rename to `alerts:ntfy` + update error text; decide with owner whether historical `alerts:telegram` rows are left as-is (recommended: leave; they are history) | `grep -n "alerts:telegram" packages/core/src/pipeline/integration-events.ts` → no hits; uptime views show the new label on fresh runs |

If 2.4 shows `alerts.send.failed` with status 401/403 → ntfy auth enabled but token missing (check `NTFY_TOKEN` resolution order in `profile-config.ts`). Connection refused → ntfy service not up or `alert.ntfy_url` points at the wrong host (inside compose it's `http://ntfy`, not localhost).

## Phase 3 — Documentation reconciliation (through change control)

The record still contradicts the code. Fix ALL of these, none silently:

| Doc | Stale claim | Action |
|---|---|---|
| `spec/06-decisions.md` ADR-011 | "ntfy.sh is not used" | Write superseding `docs/adr/0007-*.md` documenting the reversal honestly (why Telegram out: dependency on bot API + phone-number-bound bot, self-hosted push preferred; why ntfy in). Add a pointer line in spec/06 like the existing docs/adr cross-references. Do NOT edit ADR-011's original text — supersede it. |
| `CONTEXT.md` | Profile "alert destination (Telegram chat)", Feedback "Telegram replies", header "alerts the owner via Telegram" | Update entries to ntfy + the Phase 4 feedback mechanism; keep Avoid-lists |
| `docs/SMOKE.md` | Telegram checklist items + npm commands | Rewrite alert items for ntfy; pnpm-correct the commands |
| `README.md` | "alert via Telegram" | Update |
| `.env.example` / `Makefile` | covered in Phase 2 | — |

Gate: `grep -rn -i telegram README.md CONTEXT.md docs/ spec/ Makefile .env.example` → remaining hits are ONLY historical records (failure-archaeology skill, superseded ADR text, spec/06 ADR-004/011 originals). List each surviving hit and justify it.

## Phase 4 — Restore feedback ingestion (ranked menu)

**Recommended: Option 1, optionally +3 later.**

| Rank | Option | Theory obligations | Why / why not |
|---|---|---|---|
| 1 | **Web-dashboard feedback**: `POST /api/feedback` + 👍/👎 on alert-history UI | New `feedback:write` capability in `packages/shared/src/rbac.ts`; CSRF (`x-csrf-token`); audit action `feedback.record`; row must carry `profile_id` + `source_query_id` + listing attrs copied from `alert_log` (mirror what the old bot stored: title, brand, price, platform, listing_id); RBAC per membership | Matches the stub's own stated intent ("Use the dashboard to record feedback"), the built API patterns (docs/web-app.md), and serves non-LLM users. Friction: user must open the dashboard — mitigate: alert `X-Click` already lands on the listing; consider a dashboard deep-link in digest |
| 2 | **ntfy action buttons** → API webhook | ntfy `X-Actions` HTTP actions are fire-and-forget with fixed headers — you must mint a per-alert signed token endpoint (auth without cookies), plus HTTPS exposure of the API to the phone network | One-tap from the notification (best UX), but a real auth/exposure design problem. Defer until Option 1 works; treat as enhancement ADR |
| 3 | **MCP `record_feedback` tool** | New tool in `services/mcp-server/src/tools/`; same row obligations; profile scoping from MCP context | Cheap, fits MCP-primary (docs/adr/0001), but only serves the Owner in an LLM session |
| — | **FENCED: resurrect the Telegram bot as-is** | — | Contradicts the owner-chosen migration direction (unless Phase 1 chose direction 2). The polling bot + chat-id plumbing is exactly what was being deleted |

Implementation gates for Option 1:
1. Unit: route rejects missing capability (403), missing CSRF (403), records row (assert repo call). `pnpm --filter @fm/api test` green.
2. Lineage: after one UI/curl feedback on a seeded alert —
   `sqlite3 -readonly data/fashion_monitor.db "SELECT profile_id, signal, source_query_id, title FROM feedback ORDER BY recorded_at DESC LIMIT 1;"` → row with non-null `source_query_id` matching the alert's Monitor.
3. Prompt pickup: `feedback-diet.sh` shows the row; a unit test on `buildSystemPrompt` asserts the "Your actual preferences" section appears when rows exist (see `packages/core/src/llm/prompt-builder.ts`).
4. Audit: `sqlite3 -readonly data/fashion_monitor.db "SELECT action FROM audit_log ORDER BY id DESC LIMIT 3;"` includes `feedback.record`.

## Phase 5 — Validation and promotion

1. `pnpm test` — no regressions vs Phase 0 floor; new tests enumerated.
2. Full mock-provider pipeline run: alert delivered (Phase 2.4 harness) AND feedback recorded via the new path AND next run's prompt contains the example (log the built prompt in a test, not production).
3. Measurement restart: `scorecard.sh` — `feedback_positive`/`feedback_negative`/`feedback_ratio` columns begin accruing. This re-arms the >60% alert-precision measurement (spec/01).
4. Docs gate from Phase 3 re-run.
5. Owner reviews and commits (no AI attribution — `.cursor/rules/no-agent-attribution.mdc`; owner authorship only).

**"You are done when":** a fresh clone can follow run-and-operate, receive an ntfy alert, record feedback in the dashboard, and see that feedback in the next run's prompt diet — with every step above green and zero unexplained `telegram` references outside historical records.

## When NOT to use this skill

- Alerts failing in an already-migrated system → **fashion-monitor-debugging-playbook**
- What feedback does to scoring → **llm-scoring-reference**
- Multi-profile work → **fashion-monitor-multi-profile-campaign** (blocked behind this one while the working tree is dirty)

## Provenance and maintenance

- Live state: `git status --porcelain && git diff --stat`
- Loop still severed: `grep -rni feedback packages/api/src | wc -l`
- ntfy alerter shape: `cat packages/core/src/alerts/ntfy.ts`
- Stub intent: `head -12 apps/cli/src/feedback-bot.ts`
- ADR-011 contradiction: `grep -n "ntfy" spec/06-decisions.md`
- Old bot recoverable: `git show HEAD:apps/cli/src/feedback-bot.ts | head -30`
