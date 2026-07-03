---
name: fashion-monitor-research-methodology
description: The evidence bar and idea lifecycle for fashion-monitor, plus first-principles analysis recipes worked against this repo's real machinery (funnel decomposition, config-revision natural experiments, feedback-ratio precision, integration-health attribution). This skill also serves as the proof-and-analysis toolkit. Load when designing an experiment, evaluating whether a hypothesis is proven, changing scoring/prefilter/query behavior and needing before/after numbers, or adjudicating competing explanations for observed behavior. Do NOT load for the measurement plumbing itself (fashion-monitor-diagnostics-and-tooling), test mechanics (fashion-monitor-validation-and-qa), or picking a research problem (fashion-monitor-research-frontier).
---

# Research Methodology (fashion-monitor)

Written 2026-07-02. The bar below is what "we know why" means in this repo.

## The evidence bar

A mechanism is accepted only when:
1. **It explains ALL observations — including the negatives.** If your explanation for "no alerts" is "Grailed keys expired," it must also explain why eBay produced no alerts. If it doesn't, you have two problems or the wrong mechanism.
2. **It survives an assigned adversarial refutation pass.** Before acting, run this checklist explicitly (in writing, in the session):
   - What ELSE would this mechanism predict? Go check one such prediction.
   - Which observation is LEAST consistent with it? Steel-man the alternative.
   - What is the cheapest discriminating experiment? (In this repo, usually: `llm.provider: mock` to remove scoring from the equation; `--platforms <one>` to isolate a scraper; a `-readonly` SQL query to split the funnel.)
3. **It predicted numbers before the run.** Post-hoc stories about numbers you already saw are hypothesis generation, not evidence.

Worked example — "no alerts arriving": competing mechanisms are (a) scrape failure, (b) prefilter rejection, (c) scoring NO/PENDING, (d) dispatch failure. One funnel row discriminates all four: `listings_found=0` → (a); `found>0, new>0, yes+maybe+no=0` → (c) with `pipeline.llm.unavailable` in logs = PENDING; `scored_yes>0, alerts_sent=0` → (d), check `alerts.send.*` events; `found>0, new≈0` → dedupe/quiet market, not a failure at all — the negative observation that saves you an afternoon.

## Hypothesis template (fill BEFORE running)

> Change **X** will move metric **M** from **a** to **b** (±tolerance) because mechanism **Z**; measured by query/script **Q** over window **W**. If M lands outside tolerance, Z is wrong or incomplete — do not ship X on vibes.

Worked examples against real machinery:

1. **Prefilter tightening.** "Adding hard_no rule R will raise `prefilter_rejected` by ~N/run and cut LLM batch volume proportionally, with `scored_yes` unchanged (rule targets junk, not matches)." Measure: `v_search_group_scorecard.prefilter_rejected` and `scored_*` before/after. If `scored_yes` drops too → the rule bites real matches; retire or narrow it.
2. **Taste prompt edit.** "Rewording the aesthetic_prompt to demote sportswear will cut `yes_rate` on Monitor m1 from 0.4 to ≤0.25 within 5 runs, and feedback_negative on its alerts stops accruing." The **config_revisions table is the natural-experiment log**: every Taste/Monitor change writes a hashed, timestamped snapshot (`v_config_revision_timeline`), so before/after windows are exact — never guess when a prompt changed, query it.
3. **The project's own exemplar** (docs/adr/0004): login-based Connections ship dormant until an *anonymous-vs-logged-in lift measurement* proves value — the gate (measured lift) was defined before the feature. Reuse that pattern: define the promotion metric before building.

## Idea lifecycle (as practiced in this repo)

1. **Idea → grilling session.** Plans open with `Status: Planned. Output of a grilling session (date).` (see docs/plans/self-service-onboarding.md).
2. **Decisions → ADRs, vocabulary → CONTEXT.md.** The 2026-06-15 session produced ADRs 0003–0006 plus new CONTEXT.md terms in one pass.
3. **Implementation** behind tests, config axes, or dormant gates (fashion-monitor-change-control).
4. **Measurement** via scorecard views + config_revisions windows.
5. **Adopt or retire.** Adopted: ADR stands, plan checkboxes close. Revised: spec/06 ADRs carry explicit `(REVISED)` markers (ADR-003, 005, 008) — decisions get revisited with reasons, in writing. Retired/reversed: **documented supersession** — the honest current example is ADR-011 ("ntfy not used") being reversed by the in-flight migration WITHOUT a superseding ADR yet; that gap is itself the lesson: a reversal isn't done until the record says so (fashion-monitor-alerting-feedback-campaign Phase 3 closes it).

Where good ideas historically came from: grilling sessions (ADR clusters), incidents hardened into rules (lockfile purge → pnpm-only; spec drift → "sync spec to actual codebase" commit 9bda02c), and measurement gates borrowed from one feature to gate another (ADR-0004's lift test).

## Analysis recipes

| Recipe | When | How | Interpretation traps |
|---|---|---|---|
| Funnel decomposition | any "pipeline produced less than expected" | `scripts/funnel.sh` (diagnostics skill), then per-Monitor via `v_query_scorecard` | `listings_new` ≪ `listings_found` is dedupe working, not loss |
| Before/after around a config revision | any Taste/Monitor/prompt change | window boundaries from `v_config_revision_timeline`; compare `yes_rate`, `alert_rate`, `prefilter_rejected` across ≥5 runs each side | small N: 5 runs of a quiet Monitor ≈ noise; state N with the result |
| Per-platform health attribution | "is it us or them?" | `v_integration_uptime_7d` + `v_integration_recent_failures`; clustered same-platform failures with passing siblings = external | a platform DOM change looks like "us" (parse errors) — check fixtures (validation-and-qa) |
| Feedback-ratio precision estimate | judging alert quality vs the >60% target (spec/01) | `feedback_ratio` in `v_search_group_scorecard` | HEAVY bias caveats: only alerted items get feedback (survivorship), response is voluntary, and **as of 2026-07-02 ingestion is severed** — historical rows only until the alerting campaign restores it. Treat as lower-bound signal, not precision |

## When NOT to use this skill

- Getting the numbers themselves → **fashion-monitor-diagnostics-and-tooling**
- What counts as done for a code change → **fashion-monitor-validation-and-qa**
- Choosing which open problem to attack → **fashion-monitor-research-frontier**
- Whether the change is allowed at all → **fashion-monitor-change-control**

## Provenance and maintenance

- REVISED markers still present: `grep -n "REVISED" spec/06-decisions.md`
- Grilling-session lifecycle header: `head -4 docs/plans/self-service-onboarding.md`
- config_revisions still hash+timestamp: `grep -n -A6 "config_revisions" packages/core/src/storage/migrations/004_search_intelligence.sql`
- Scorecard columns used here: `grep -n "prefilter_rejected\|yes_rate\|feedback_ratio" packages/core/src/storage/migrations/013_unify_search_groups.sql`
- Feedback still severed (bias caveat current): `grep -rni feedback packages/api/src | wc -l`
