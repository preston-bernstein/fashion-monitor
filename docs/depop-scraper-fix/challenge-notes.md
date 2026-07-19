# Spec Challenge Notes

## Agents run
- Requirements Auditor (haiku): 9 issues found, 9 accepted
- Scope & Dependency Auditor (sonnet): 6 issues found, 5 accepted
- Design Devil's Advocate (sonnet): 5 issues found, 5 accepted
- Implementation Realist (sonnet): 9 issues found, 9 accepted
- Steps & Sequencing Critic (sonnet): 8 issues found, 8 accepted
- Data Model Critic (sonnet): 6 issues found, 6 accepted
- Security/Threat Auditor (haiku): 4 issues found, 2 accepted

## Changes made
- **Re-sequenced live verification to Step 1 (was Step 14 of 15).** The original plan built a fixture, normalizer, scraper cascade, and DOM extractor on top of a single already-deleted investigation script's findings, then scheduled the only step that could correct a wrong guess dead last — directly contradicting the plan's own stated risk. All downstream steps now explicitly depend on Step 1's real findings.
- **Simplified the primary HTTP tier and stopped over-trusting the Vestiaire precedent.** Vestiaire's own live-env.ts marks its ScrapFly key as *required in practice*, not a rare fallback — so citing it as proof a complex cookie/UUID-header tier-1 would "mostly succeed" was backwards. The cookie-harvest/header engineering is now a separate, explicitly conditional step (8b) built only if Step 1's evidence justifies it; ScrapFly is now the realistic primary bypass, matching what actually happens for Vestiaire.
- **Stopped unconditional deletion of the RSC-shaped normalizer/parser/tests.** `normalizeDepopRscProduct` maps a real, previously-observed Depop schema that plausibly still describes the same backend. Requirements, plan, and steps all flipped this from "delete unless proven still valid" to "keep as documented legacy unless Step 1 proves it's genuinely unreachable" — a running decision point threaded consistently through Steps 3, 4, 7, and 10.
- **Tightened Cloudflare-challenge detection to a header-anchored signal.** Body-substring matching alone (e.g. "Forbidden") could false-positive on an ordinary non-Cloudflare 403 and misroute traffic into the shared, budget-limited ScrapFly quota. Detection now requires `server: cloudflare` + `cf-ray` as the primary condition; body text is corroborating only.
- **Clarified retry scope.** "3-attempt/backoff wraps the whole cascade" was genuinely ambiguous and could have 3x'd paid ScrapFly calls and browser launches per query. Now explicit: retry applies only to the primary HTTP tier; ScrapFly and Playwright fallback are one-shot escalations.
- **Fixed concrete blast-radius gaps**: preserved the `export { parseDepopProducts }` re-export scraper.ts depends on, added retirement of the dead `PlatformDepopRscSuccess` log event (conditional on the same RSC decision point), added the `pnpm build`-before-live-verify step (scripts/verify-scrapers.ts imports from dist/, not src/), fixed missing step dependencies (Step 9 now correctly depends on Step 4 for the symbols it imports), added `depop-fallback.test.ts` to Step 10's file list, and routed the headless-browser fingerprint leak fix through the existing `PLAYWRIGHT_STEALTH_DRIVER` gate instead of inventing a parallel fix.
- **Added silent-failure guards to the normalizer contract.** New requirements force a thrown/flagged error on a missing product id or unparseable price, rather than silently defaulting to `"undefined"` or `0` — both were previously indistinguishable from real (broken) data.
- **Added secrets-hygiene requirement.** ScrapFly error bodies and harvested Cloudflare cookies (`__cf_bm`/`_cfuvid`) must never be logged verbatim.

## Critiques rejected
- Security Auditor: "error message reveals fallback strategy to an attacker" — rejected as low-value for a single-user personal tool with no external attacker model.
- Security Auditor: "add dependency CVE monitoring for scrapfly-sdk/impit" — rejected as out of scope for this fix; general dependency hygiene is a separate, repo-wide concern, not specific to the Depop cascade.

## Open questions requiring human input
- Step 1's live-verification pass has not yet actually been run under this rewritten spec — its findings (real endpoint behavior, real JSON/DOM shape, whether Step 8b's cookie/header tier is worth building at all) are the load-bearing fact this entire spec now depends on, and won't be resolved until `/new-story` executes Step 1 for real.
- Whether Step 8b (cookie-harvest + generated UUID headers) gets built at all is now explicitly conditional on Step 1's findings — this is a real architectural fork, not just an implementation detail, and the resulting shape of `scraper.ts` will differ meaningfully depending on which branch Step 1's evidence supports.
