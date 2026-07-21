# Spec Challenge Notes

## Agents run
- Requirements Auditor (haiku): 14 issues found, 6 accepted
- Scope & Dependency Auditor (sonnet): 6 issues found, 3 accepted directly + 1 (Step 18/AC6 gating) resolved via the docker-compose scope correction
- Design Devil's Advocate (sonnet): 6 issues found, 4 accepted (1 resolved via scope correction, not a driver-flag reintroduction)
- Implementation Realist (sonnet): 5 numbered findings, 4 accepted (1 — capturePosture() losing driver introspection — rejected as by-design)
- Steps & Sequencing Critic (sonnet): 21 issues found, 17 accepted
- Data Model Critic (sonnet): 5 STATE findings (no real data model — redirected to the session.ts in-memory-cache critique per the fallback instruction), 3 accepted as code fixes, 2 accepted as documented risk
- Security/Threat Auditor (haiku): 8 issues found, 2 accepted (both low-cost hardening additions), 6 rejected as disproportionate to this system's actual threat model (loopback-only, single-operator, non-adversarial)

## Changes made

1. **Docker-compose scope correction (the most significant change).** The original plan had fashion-monitor's `docker-compose.yml` add a new `stealth-sidecar` service referencing a container image that doesn't exist yet in scraper-commons. Since `make deploy` runs `docker compose up -d` for the *whole* file, a missing image for one new service could have aborted the entire deploy — taking down dashboard, ntfy, grafana, and mcp-server along with it, none of which have anything to do with this migration. Corrected: docker-compose.yml now only gains a `STEALTH_SIDECAR_URL` env var; no service, no `depends_on`. Production desktop reachability of a real containerized sidecar is now explicitly documented as a cross-repo follow-up (home-infra ADR 0014/0015 / scraper-commons packaging), not something this feature claims to deliver. This feature's own "verified end-to-end" bar is now: local-process sidecar (`scripts/run_sidecar.py`, no Docker needed) against real Depop/Poshmark scrapers.

2. **`closePoshmarkContext()` signature gap fixed before it became a silent production leak.** Both the Scope Auditor and Implementation Realist independently found the same real bug: the plan had `closePoshmarkContext()` call `closePersistentContext(profilePath)`, but the function is called with zero arguments at both real CLI call sites (`scrape.ts`, `run.ts`), which have no access to a specific profile's path. The old code's `closeAllStealthBrowsers()` closed everything the process had opened, which matters because `forEachProfileSerially` can open multiple profiles' persistent contexts in one process run. Fixed: session.ts now exposes `closeAllPersistentContexts()` mirroring the old zero-arg behavior; `closePoshmarkContext()` keeps its existing signature and CLI call sites need zero changes.

3. **Retry-count TBD resolved and a hidden 422 bug caught before implementation.** FR7's "[retry count TBD]" is now concretely "exactly once, connect-errors only." Separately, cross-referencing the *real* scraper-commons source (not just its docs) found that the sidecar rejects any `timeout_ms > op_timeout_ms` (default 30000ms) with a 422 — the old code's 60,000ms goto timeouts would have 422'd on every single navigate call if ported naively. The client contract now caps the requested timeout below the sidecar's default instead.

4. **Two correctness fixes to the session cache**: (a) the `Map<profilePath, contextId>` now caches the in-flight `Promise`, not just the resolved ID, closing a check-then-act race where two concurrent calls could both fire a `createContext`; a new acceptance criterion tests this directly. (b) a cheap path-traversal guard on `profilePath`/`userDataDir` before it reaches the sidecar.

5. **Added a fixture-based regression test for the dropped cookie-consent-banner click** rather than shipping on the unverified assertion that dropping it is "harmless." The sidecar has no click primitive at all, ever — if the assumption is wrong, there's no way to add the capability back later, so it gets a real test before Step 18 deletes the fallback.

6. **Steps.md restructuring**: split 4 oversized steps (client.ts, both scraper rewrites, test rewrites) into platform/concern-scoped sub-steps; fixed 6 false dependency declarations (notably: extract.ts rewrites falsely depended on session.ts, which they never import); added 3 new steps (legacy-driver baseline capture for later comparison, the cookie-banner fixture test, and an explicit fail-fast-with-sidecar-stopped verification step); tightened Step 13's persistence check from a subjective "fewer logins/CAPTCHAs" to a concrete file-mtime check.

## Critiques rejected

- **AC2/cookie "contradiction"** (Requirements Auditor): flagged AC2 (Poshmark session-cookie persistence) as contradicting the plan's dropped Depop cookie-*consent-banner* click. These are different platforms and different meanings of "cookie" (auth session vs. GDPR banner UI) — not a real contradiction. Left AC2 as-is.
- **Backoff/retry for `capacity_exceeded`** (Design Devil's Advocate): a legitimate concern *once estate-scraper exists as a second sidecar consumer* — but it doesn't exist yet (unbuilt per its own rollout step). Adding speculative multi-tenant backoff logic now is over-engineering for a consumer that isn't real. Noted as a documented risk to revisit when estate-scraper lands, not implemented now.
- **SSRF/injection risk on `navigate()`'s URL or `baseUrl`** (Security Auditor): both are constructed internally from hardcoded marketplace domains, never from external/attacker input. Not a real risk in this system.
- **Context-ID prediction/injection, encrypting `data/poshmark-profile` at rest** (Security Auditor): disproportionate to this system's actual threat model (loopback-only sidecar, single-operator home-lab tool, non-adversarial network) or a pre-existing property of the system this migration doesn't change or worsen.
- **Keeping the legacy TS driver behind a flag as a production fallback** (Design Devil's Advocate, and implicitly several others): the user explicitly required no parallel-running period. The correct fix for "no working fallback until the sidecar is deployed" is the docker-compose scope correction (accept the fail-fast gap explicitly, matching FR12) — not reintroducing driver selection.
- **Verifying the sidecar is unreachable from the host/LAN** (Steps Critic, MISSING STEP): can't be meaningfully tested until the real containerized sidecar exists on the desktop — moot given the scope correction, noted as a future verification item once that infra lands.

## Open questions requiring human input

None that block proceeding. The one previously-open question (how to handle the missing scraper-commons container image without breaking deploy) was resolved via the scope correction above rather than needing a human decision — the resolution follows directly from the user's own prior instruction that home-infra owns deploy/attach wiring (ADR 0014/0015) and this feature should not take on that scope.
