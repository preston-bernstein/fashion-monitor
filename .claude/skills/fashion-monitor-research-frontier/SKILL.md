---
name: fashion-monitor-research-frontier
description: Open problems where fashion-monitor could advance beyond common practice — personal-aesthetic LLM scoring evaluation, query-generation intelligence, vision-escalation policy, and reproducible anti-bot posture measurement. Each entry states why current practice falls short, this repo's specific asset, the first three concrete steps IN THIS REPO, a falsifiable "you have a result when…" milestone, and what would falsify the idea's value. Load when choosing ambitious/next-horizon work or evaluating whether a research claim about this project is defensible. Everything here is OPEN/CANDIDATE — nothing is proven. Do NOT load for day-to-day work (debugging/validation/campaign skills) or for how to run experiments (fashion-monitor-research-methodology).
---

# Research Frontier (fashion-monitor)

Status labels as of 2026-07-02. Every behavior change these imply routes through fashion-monitor-change-control; every claim needs the fashion-monitor-research-methodology evidence bar. External claims about results follow fashion-monitor-docs-and-positioning (nothing below is claimable yet).

## F1 — Evaluating personal-aesthetic LLM scoring (open)

**Why common practice falls short:** resale alerting tools use keyword/brand filters (no aesthetic generalization) or embedding similarity (no explainable hard-no reasoning, poor at "intentional not costume-y"-style constraints). There is no standard eval for *one person's taste* applied by small local models.

**This repo's asset:** a lineage-tracked labeled corpus — `feedback` rows joined to `alert_log` and `seen_listings.listing_snapshot`, each with `source_query_id` (which Monitor produced it) and `config_revisions` marking every prompt change (natural-experiment windows). A longitudinal single-user taste dataset with the exact prompt that scored each item is genuinely rare. **Honest caveat:** feedback ingestion is severed as of 2026-07-02 — the corpus is frozen until fashion-monitor-alerting-feedback-campaign restores it, and current volume is small (check: `sqlite3 -readonly data/fashion_monitor.db "SELECT COUNT(*) FROM feedback;"`).

**First three steps in this repo:**
1. Offline eval harness: a script that replays `seen_listings.listing_snapshot` rows through `buildSystemPrompt` + a chosen provider with a **frozen** Taste revision (from `config_revisions.snapshot_json`), comparing verdicts to feedback labels. The `mock` provider pattern (`packages/core/src/llm/mock.ts`) shows how to slot a provider in tests.
2. Metrics: precision/recall of YES vs positive-feedback, with N and confidence intervals; per-Monitor breakdown via `source_query_id`.
3. Model matrix: run the harness across `ollama_text_model` variants (and claude) — same prompts, same items.

**You have a result when:** measured precision on held-out feedback beats a keyword baseline (the Monitor's own `query_text` terms as filter) by a stated margin with N ≥ ~100 labeled items. **Falsified if:** the keyword baseline matches LLM scoring within noise — then the LLM layer's value claim (spec/01's premise) needs rework, which is itself a publishable-grade negative for this setup.

## F2 — Query-generation intelligence (open; spec/07 "Phase 2" names it)

**Why common practice falls short:** saved-search products treat queries as static user input; nobody closes the loop from per-platform result quality back to query wording.

**Asset:** `scrape_query_runs` per-platform per-run stats + `v_query_scorecard` (yes_rate, alert_rate, feedback linkage) + the Query Override mechanism (per-platform replacement queries) already in the data model — the actuation surface exists.

**First three steps:** (1) define "underperforming" numerically from existing columns (e.g. yes_rate < X over N runs with listings_new > Y) and implement the spec/07 Phase 2 `needs_revision` auto-suggest as a report, not an action; (2) generate candidate Query Overrides via the existing LLM provider from the Monitor's intent + top-scoring listing titles; (3) A/B within the data model: run override vs primary as sibling scrape_queries on the same Monitor and compare scorecards.

**You have a result when:** a generated override beats its primary query's yes_rate on the same platform over ≥10 runs. **Falsified if:** generated overrides can't beat hand-written queries — keep the scorecard, drop the generator.

## F3 — Vision-escalation policy (open; needs instrumentation first)

**Why common practice falls short:** vision-LLM cost policies ("send everything" or "send nothing") ignore that vision only matters where text is ambiguous; ADR-008's MAYBE-only escalation is already smarter than default practice but its effectiveness is **unmeasured**.

**Asset:** the two-pass structure with a clean interception point (`scorer.ts` replaces the text verdict with the vision verdict in memory). **Gap verified 2026-07-02:** the pre-vision verdict is NOT persisted — only the final score reaches `seen_listings`. No flip-rate analysis is possible until that changes.

**First three steps:** (1) persist the transition (log event with text-verdict + vision-verdict, or a column/snapshot field — schema change via migration + change control); (2) after ~2 weeks of runs, measure flip rate (MAYBE→YES vs MAYBE→NO vs stayed) and per-flip cost; (3) correlate flips with feedback labels once ingestion is restored — did vision flips improve precision?

**You have a result when:** you can state "vision changes X% of MAYBE verdicts and those changes agree with user feedback Y% of the time," and adjust escalation (e.g. skip vision for price bands where flips never alert) with predicted numbers. **Falsified if:** flip rate ≈ 0 or flips are uncorrelated with feedback — then vision is cost without signal here; ADR-008 gets revised with data.

## F4 — Reproducible anti-bot posture measurement (open; gated by docs/playwright-stealth-pilot.md)

**Why common practice falls short:** scraper stealth changes are usually validated by anecdote ("it works today"). The stealth pilot doc itself demands regression checks before any driver swap.

**Asset:** `scripts/verify-scrapers.ts` (live per-platform checks), DOM fixtures for parse regression, `integration_events` as a longitudinal outcome record per platform, and a pending, explicitly-scoped pilot (rebrowser/Patchright vs legacy `playwright-extra`+stealth — which must NOT be removed until the pilot passes live smoke).

**First three steps:** (1) extend verify-scrapers with status-code + screenshot capture per platform per driver, as the pilot doc prescribes; (2) run the matrix (legacy vs rebrowser) on a schedule for a week, recording outcomes into integration_events with a driver tag; (3) publish pass-rate per platform per driver from `v_integration_daily`. Respect scrape-discipline: low volume, spread out (assumption A2).

**You have a result when:** driver decisions are made from a pass-rate table, and the stealth-pilot gate ("passes live smoke on Depop/Poshmark") is a query, not a judgment call. **Falsified if:** pass rates are indistinguishable — then the CDP-leak concern is not yet material for these platforms and the legacy stack stays (also a useful result).

## When NOT to use this skill

- Executing today's priorities → **fashion-monitor-alerting-feedback-campaign**, then **fashion-monitor-multi-profile-campaign**
- Experiment design/evidence bar → **fashion-monitor-research-methodology**
- What may be claimed publicly → **fashion-monitor-docs-and-positioning**

## Provenance and maintenance

- Feedback corpus size/frozenness: `sqlite3 -readonly data/fashion_monitor.db "SELECT COUNT(*), MAX(recorded_at) FROM feedback;"`
- F3 gap still real (no pre-vision verdict stored): `grep -n "vision" packages/core/src/pipeline/scorer.ts packages/core/src/storage/repos/seen-listings.ts` (in-memory replacement only = gap persists)
- spec/07 Phase 2 still unbuilt: `grep -n "Phase 2" spec/07-search-intelligence.md`
- Stealth pilot still pending: `grep -n "Do not remove" docs/playwright-stealth-pilot.md`
- Query Override surface: `grep -n "query_overrides" spec/07-search-intelligence.md packages/core/src/storage/migrations/012_search_groups.sql`
