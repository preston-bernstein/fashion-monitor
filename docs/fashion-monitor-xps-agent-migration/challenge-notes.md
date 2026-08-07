# Spec Challenge Notes

## Agents run
- Requirements Auditor (haiku): 6 issues found, 6 accepted
- Scope & Dependency Auditor (sonnet): 8 issues found, 8 accepted
- Design Devil's Advocate (sonnet): 8 issues found, 6 accepted, 2 partially accepted (correcting an inaccurate precedent claim without changing the mechanism it was attached to)
- Implementation Realist (sonnet): 6 issues found, 6 accepted (one deferred as an acknowledged risk, not a fix — see below)
- Steps & Sequencing Critic (sonnet): 13 issues found, 13 accepted
- Data Model Critic (sonnet): 7 issues found, 7 accepted (largely superseded by switching the DB-copy mechanism entirely — see below)
- Security/Threat Auditor (haiku): 4 issues found, 4 accepted

## Changes made

- **Critical — a near-certain permission bug, confirmed live, not hypothetical.** `make sync`'s tar extraction runs as plain `agent` (no `sudo` anywhere in the Makefile) against a directory the plan had planned to make `750 fashionmonitor:fashionmonitor` — `agent` has zero access. Investigated live on desktop-agent via SSH: confirmed `agent` is not in the `fashionmonitor` group there either, and a live write test returned `Permission denied` — this is a pre-existing bug in the documented deploy flow, not something specific to xps-agent. Fixed with a concrete permission model: `agent` joins the `fashionmonitor` group, the top-level deploy directory is `2775` (setgid, group-writable), and `data/` (which `make sync` never touches) stays at the stricter `750`.
- **Replaced the DB-copy mechanism entirely.** The original design (`PRAGMA wal_checkpoint(TRUNCATE)` + three separate raw file copies + two checksum passes) is replaced with SQLite's own `.backup` command — one complete, consistent file in one step, which also tolerates a live writer per SQLite's documented behavior. Combined with a tmp-path-then-atomic-`mv` transfer, a scripted (not eyeballed) checksum gate that halts on mismatch, and `pipefail` around the transfer pipe, this closes a real risk the original design had: a dropped connection mid-copy could otherwise leave a silently truncated file sitting at the live production path.
- **Fixed a genuine requirements/plan contradiction.** AC2 literally required `make deploy` to complete successfully, while the plan's own Risk area #1 forbids ever running bare `make deploy` during this migration (it would start a real scrape as a side effect). AC2 now references the actual scoped bring-up command used.
- **Closed the landmine this migration would otherwise have perpetuated.** `scraper`/`poshmark`/`score` have no `profiles:` gate in `docker-compose.yml`, so any future bare `docker compose up -d`/`make deploy` — not just during this cutover — risks starting a real scrape as a side effect. Added `profiles: ["scrape"]` to all three, closing the gap for good rather than just working around it for this one migration window.
- **Fixed a real documentation-accuracy bug.** The plan claimed SKILL.md's existing "Not yet actually installed" line was about the scraper-health watchdog — it's actually about a different thing entirely (scraper/poshmark/score's own scrape-execution scheduling, which stays out of scope). An implementer following the original wording could have edited the wrong sentence and made it falsely read as if live scraping were now scheduled. Now correctly scoped as an addition, with a test asserting the original sentence survives unedited.
- **Added a safe DB write-probe.** Verification previously only read the DB; nothing confirmed the app's runtime UID could actually write to it. A permission break would have surfaced only after desktop-agent was decommissioned, past easy rollback.
- **Closed a watchdog gap.** Desktop-agent's scraper-health timer wasn't stopped before the DB copy (risking a write mid-copy), and nothing prevented decommissioning desktop's watchdog before xps-agent's replacement was confirmed active — both fixed with explicit step ordering.

## Critiques rejected / partially accepted

- **`.env` transfer mechanism** — Design Devil's Advocate correctly caught that the plan's claim of "matching home-infra's established secrets convention" was inaccurate (the real precedent, scraper-egress, has the operator retype credentials on the target host, never piping them host-to-host). Accepted the correction to the plan's wording, but rejected switching the actual mechanism: `.env` contains an `ENCRYPTION_KEY` that must be byte-exact (a typo would permanently break decryption of every existing per-profile secret), so an SSH pipe — encrypted in transit, never staged to disk — is the more correct choice here, not a worse one. The plan now says so honestly instead of claiming a precedent it doesn't match.
- **Buildx cross-platform build risk (Mac ARM → linux/amd64 emulated build)** — real, but not something a spec change fixes; noted as an acknowledged risk (budget extra time, verify buildx has emulation configured) rather than a blocking requirement.
- **ntfy/mcp-server/grafana clients pointed at the old desktop IP breaking silently post-cutover** — real blast radius, but this is a single-operator personal app; noted, not turned into a formal requirement.
- Most of Data Model Critic's individual fixes to the old checkpoint-based mechanism (atomic writes, pipefail, scripted gate, stderr capture) were still applied — but to the NEW `.backup`-based mechanism, since Design Devil's Advocate's case for replacing the whole approach was stronger and these safety properties apply regardless of which mechanism is used underneath.

## Open questions requiring human input

- **None that block starting implementation.** Everything found had a concrete resolution. The one thing worth Preston's explicit awareness before live steps run: this spec now adds `profiles: ["scrape"]` to `docker-compose.yml` (a small, real code change to a service definition, beyond pure host-cutover) — flagged above as a deliberate, justified scope addition, not scope creep, but it's the one place this spec touches app behavior rather than pure deploy-target/data relocation.
