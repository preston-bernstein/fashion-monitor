# 01 — Overview

This document covers what Fashion Monitor is for, the problem it solves, who it's built for, and what it deliberately leaves out.

## Problem

Resale sites — eBay, Grailed, Vestiaire, and others — carry plenty of good, reasonably priced designer clothing. Finding the right pieces is the hard part. Three things get in the way:
- You often don't know which brands or designers to search for in advance.
- Checking multiple platforms by hand takes repeated manual effort.
- Fast-selling listings disappear before you see them.

Saved searches on individual platforms only help if you already know the exact words to search for. They match keywords, not aesthetic. They can't tell that an item fits your style unless you spelled that style out as a search term.

## Goal

Fashion Monitor is a personal monitoring tool. It:
1. Continuously watches 6 resale platforms for men's XXL clothing.
2. Scores each result with an LLM against a defined aesthetic. This surfaces unknown brands and new discoveries, not just items matching known keywords.
3. Sends alerts only for high-confidence matches, to keep the signal-to-noise ratio high.
4. Exposes an **MCP server** as the primary way to use it. Add Monitors (a Monitor is a saved search that watches one or more platforms), check results, and tune Taste (Taste is the aesthetic profile — the prompt, rules, and preferences the LLM scores against) — all in conversation with Claude or another LLM client. See `docs/adr/0001-mcp-as-primary-interface.md`.

## User Context

- Male, YOUR_HEIGHT, ~YOUR_WEIGHT lbs
- Size: XXL tops, chest ~YOUR_CHEST_SIZE", pants waist 40-42, belly ~44" at widest, dress shirt ~18 neck / 34-35 sleeve
- Wide flat feet, thin orthotics (shoes separately tracked)
- Location: YOUR_CITY, YOUR_STATE — hot, humid climate; fabric breathability is a real constraint
- Office environment, programmer, smart casual acceptable
- Aesthetic: **dark academic / textured naturalist** — think professor who listens to post-punk
- References: Nick Cave (dark poet aesthetic), Brian Jonestown Massacre (worn, textured), Beastie Boys late 90s (relaxed, confident)
- Core vibe: natural textures, quality fabric, intentional not costume-y. Tweed, twill, corduroy, slub cotton, dark linen, Italian fabrics. No graphics, no embroidery gimmicks, no tropical prints
- Climate preference: lightweight natural fabrics year-round (dark linen, cotton twill, slub cotton); heavy wool/tweed acceptable fall/winter only
- Known liked brands: John Varvatos, Dale of Norway, Allen Edmonds, Brunello Cucinelli, Helmut Lang, Engineered Garments, Carhartt WIP, Theory, Boglioli, Universal Works
- Open to unknown brands that match the vibe — this is a key reason for LLM scoring over keyword lists

## Success Criteria

- Alerts arrive within 1-2 hours of a matching item being listed
- False positive rate low enough that alerts are worth opening (target: >60% of alerts are genuinely interesting)
- No duplicate alerts for the same listing
- Works unattended — runs on a schedule, no manual intervention needed
- Easy to tune the aesthetic prompt (Taste) from an LLM conversation via MCP or through the web UI

## Non-Goals

- Not a purchasing tool — no auto-buy, no cart management
- Not a price history tracker — though seen price can be stored
- Not real-time — hourly polling acceptable
- Not covering shoes yet — footwear is a separate future consideration
- Not covering Vinted initially if complexity is too high — deprioritized

## Interface Hierarchy

Fashion Monitor has three interfaces. This priority order reflects the intended workflow:

1. **MCP server** — primary. Manages Monitors and Taste conversationally inside an active LLM session (Claude Desktop or similar). Adding a new Monitor, adjusting the aesthetic prompt, and checking recent alerts all happen in conversation. See `docs/adr/0001-mcp-as-primary-interface.md`.
2. **Web app** — strong secondary. Handles configuration, analytics, multi-user management, and audit log review — cases where a conversational interface doesn't fit.
3. **CLI** — pipeline execution and local debugging only. Not a user-facing interface.

## Multi-User Support

Multi-user and multi-profile support are already **implemented**, not planned for later. Here's the identity model:

- **Profile** — owns a Taste, a set of Monitors, and an alert destination (Telegram chat). All DB rows are scoped via `profile_id`. A Profile can exist without a web User (CLI-only use).
- **User** — an authenticated account that can log into the web app. Holds a Role on one or more Profiles.
- **Role** — 5 roles: Owner, Admin, Curator, Operator, Viewer. RBAC enforces each role's capabilities at the API layer. See `packages/shared/src/rbac.ts`.

Each Profile gets its own:
- Scoped DB rows (via `profile_id`)
- Scoped feedback loop (feedback per profile, not shared)
- Scoped Telegram destination
- Independent scoring — LLM prompt rebuilt per profile

Profile-level Taste and system settings are stored in the `profile_settings` table (key/JSON rows). Per-profile credentials (Telegram tokens, API keys) are stored encrypted in `profile_secrets` — see `docs/adr/0002-secrets-encrypted-in-db.md`.

## Decisions

These questions are already resolved. Each line links to the ADR that gives the reasoning; see `06-decisions.md` for the full set.

- [x] Alert delivery: **Telegram** (ADR-004)
- [x] Execution: **Synology Docker** + Task Scheduler; GitHub Actions **CI only** (ADR-005, ADR-010)
- [x] Vinted: **deprioritized** — EU inventory, maintenance burden (ADR-006)
- [x] Price ceiling: **per-category in config** (see 03-data-model.md)
- [x] History retention: **90 days** for seen_listings, 30 days for runs (see 03-data-model.md)
- [x] Primary interface: **MCP server** (docs/adr/0001)
- [x] Secrets: **encrypted in DB** via XChaCha20-Poly1305 (docs/adr/0002)
