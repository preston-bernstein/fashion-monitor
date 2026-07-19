# Spec Challenge Notes

## Agents run
- Requirements Auditor (haiku): 9 issues found, 8 accepted
- Scope & Dependency Auditor (sonnet): 8 issues found, 7 accepted
- Design Devil's Advocate (sonnet): 9 issues found, 7 accepted (2 rejected)
- Implementation Realist (sonnet): 10 issues found, 9 accepted
- Steps & Sequencing Critic (sonnet): 10 issues found, 10 accepted
- Data Model Critic (sonnet): 4 issues found, 4 accepted
- Security/Threat Auditor (haiku): 5 issues found, 4 accepted (1 rejected, no real gap)

## Changes made
- **Fixed a correctness bug corroborated by two independent agents**: `persistentContexts` was keyed by `profilePath` alone, so a second call with the same path but a different driver would silently return the wrong driver's cached browser context. Now keyed by composite `${driver}:${profilePath}`.
- **Fixed a real risk of reproducing the exact bug this feature exists to prevent**: Depop's HTTP-first (impit) path can succeed without ever launching a browser, but the matrix would have still labeled that row with the configured driver — the same "mislabeled fallback" problem the pilot doc's own Problem Statement names as the reason this feature exists. Depop rows now record an explicit "not applicable" sentinel when no browser launched.
- **Caught a missing build step before it caused a confusing false-positive**: `scripts/verify-scrapers.ts` imports from `packages/core/dist/`, not `src/`, and `dist/` doesn't currently exist in this worktree. Unit tests mock modules and run against `src/` directly, so they'd pass while the actual verify-scrapers run silently exercised stale or absent compiled code. Added an explicit build step (`pnpm --filter @fm/core build`) between the browser.ts changes and the verify-scrapers step.
- **Simplified rather than complicated the design**: dropped a planned `Map<StealthDriver, Browser>` in favor of a single nullable field, since the matrix loop always closes between driver passes sequentially — the Map's coexistence capability had no actual caller. This also eliminated a related overwrite-leak risk the Data Model Critic flagged.
- **Corrected a factual error that would have sent an implementer chasing a nonexistent package**: requirements.md's Constraints section said `patchright-nodejs` (which 404s on npm) — corrected to `patchright`, the real package name plan.md had already discovered via `npm view`.
- Gated the new `patchright` import behind the resolved driver (dynamic `import()`, not static) so a broken/missing patchright binary install can only ever break the patchright path, never the default legacy path production already depends on.
- Added a step to grep-and-fix stale `rebrowser-patches` references across four skill/doc files this feature's own FR3 requires be updated but the original spec never actually touched.

## Critiques rejected
- Design Advocate's suggestion to thread explicit driver parameters through scraper factories now, ahead of any scheduled/concurrent matrix work — rejected as premature; it would violate the requirements doc's own "no API change to scraper factories" constraint and solves a concurrency problem explicitly marked out of scope (scheduled/cron matrix automation is already a named future work item).
- Design Advocate's suggestion to build a new production-vs-diagnostic allowlist/flag gating mechanism for `patchright` — rejected as over-engineering beyond this pilot's existing opt-in-by-design scope; documented as an accepted, deliberate operator choice instead.
- Security Auditor's VALIDATION finding on `resolveStealthDriver()` — the agent's own analysis confirmed no actual gap exists; kept as-is.
- Implementation Realist's implied fix of renaming `closePoshmarkContext()`/`closeAllStealthBrowsers()` for clarity — real observation (the names are misleading, they close every driver's resources, not anything poshmark-scoped) but a separate, broader refactor; noted as a known naming smell in Risk Areas instead of renamed here.

## Open questions requiring human input
- The "passes live smoke on Depop and Poshmark" gate for ever removing `playwright-extra` + stealth-plugin still has no numeric closing criterion (how many runs, what pass rate). This feature deliberately leaves that as a human judgment call for a future change — flagging so whoever picks up that decision later knows it was a deliberate deferral, not an oversight.
