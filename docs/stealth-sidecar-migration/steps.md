# Steps: Stealth Sidecar Migration

## Prerequisites

1. scraper-commons repository must have the stealth sidecar implementation merged to main (completed as of 2026-07-21 per requirements.md).
2. A scraper-commons Dockerfile and container image for the sidecar must exist in the scraper-commons repo (does not yet exist). This is why Step 18 (docker-compose.yml and Dockerfile update) does NOT add a containerized `stealth-sidecar` service — see that step's note. Full AC6 end-to-end containerized-deploy verification is blocked until home-infra (ADR 0014/0015) or scraper-commons ships a reachable containerized sidecar; this feature's own verification instead uses a locally-run sidecar process (see Prerequisite 5).
3. Access to live Depop and Poshmark listings for end-to-end scraper verification (Steps 4, 13, 14, and 15).
4. Familiarity with the existing Depop and Poshmark scraper flows and their current use of `launchStealthEphemeralBrowser` (Depop) and `launchStealthPersistentContext` (Poshmark).
5. A locally-runnable sidecar process for verification: `python scripts/run_sidecar.py` in a scraper-commons checkout, run directly (no Docker required) — sufficient for this feature's own end-to-end verification even though it does not represent the real desktop-deployed network topology.

## Implementation steps

### Step 1: Create error types module
**What**: Add `packages/core/src/platforms/stealth-sidecar/errors.ts` with typed error classes for sidecar HTTP failures.
**Files**: `packages/core/src/platforms/stealth-sidecar/errors.ts` (create).
**Test**: `grep -r "SidecarError\|SidecarUnreachableError\|SidecarResponseError" packages/core/src --include="*.ts"` returns only `errors.ts` itself; confirm exports are importable from a test file.
**Depends on**: None.
**Parallelizable**: No — must precede all other stealth-sidecar modules.

### Step 2a: Create sidecar HTTP client core
**What**: Add `packages/core/src/platforms/stealth-sidecar/client.ts` implementing the low-level sidecar HTTP wrapper's core surface: `createContext`, `createPage`, `navigate`, `getContent`, `getScreenshot`, `checkHealth`. Resolve the sidecar base URL from the `STEALTH_SIDECAR_URL` env var (default `http://127.0.0.1:8000` per plan.md). Also edit `.env.example` to replace `PLAYWRIGHT_STEALTH_DRIVER=legacy` with `STEALTH_SIDECAR_URL=http://127.0.0.1:8000`, satisfying FR8 — this belongs in the same step as client.ts because client.ts is what actually reads that var.
**Files**: `packages/core/src/platforms/stealth-sidecar/client.ts` (create), `.env.example` (edit).
**Test**: Import client functions; verify they exist and accept expected params (contextId, pageId, URL, timeout). Confirm `STEALTH_SIDECAR_URL` entry exists in `.env.example` and matches the sidecar default. Unit tests in Step 10 will cover fetch mocking, retry behavior, error handling (added in Step 2b).
**Depends on**: Step 1 (errors.ts).
**Parallelizable**: No — blocks Step 2b (sequential, same file) and, transitively, Step 3.

### Step 2b: Add retry, timeout, and error-typing to sidecar client
**What**: Extend `client.ts` with: (1) exactly one retry, on connect-level errors only (per requirements FR7); (2) a request timeout capped below the sidecar's `op_timeout_ms` default — do not blindly forward the old 60,000ms goto timeout from the Patchright era; cap around 25,000ms (see plan.md's navigate contract note); (3) error mapping to `SidecarUnreachableError` / `SidecarResponseError` covering ALL real `error.type` values from plan.md's API contract table, including `invalid_url` and `invalid_timeout` (not just the subset originally listed).
**Files**: `packages/core/src/platforms/stealth-sidecar/client.ts` (edit, same file as Step 2a — sequential, not parallel with 2a).
**Test**: Import client functions; verify retry/timeout/error-mapping code paths exist for each documented `error.type` value. Full fetch-mocked behavior covered by Step 10.
**Depends on**: Step 2a.
**Parallelizable**: No — sequential with 2a, same file.

### Step 3: Create session wrapper module
**What**: Add `packages/core/src/platforms/stealth-sidecar/session.ts` with helpers: `withEphemeralPage(callback)` for Depop's per-run ephemeral contexts, `getOrCreatePersistentContext(profilePath)` / `closeAllPersistentContexts()` for Poshmark's cross-run profile persistence (module-level `Map<profilePath, contextId>` cache), and `pollContent(pageId, predicate, {timeoutMs, intervalMs})` for client-side polling until predicate is true or timeout.
**Files**: `packages/core/src/platforms/stealth-sidecar/session.ts` (create).
**Test**: Import session functions; verify signatures and that ephemeral/persistent context creation calls the client module. Full behavior covered by Step 11b/11c (platform tests).
**Depends on**: Step 2b (session.ts relies on the client's full contract, including error typing, being stable).
**Parallelizable**: No — blocks Step 7a and Step 8a (Steps 5–6 no longer depend on session.ts — see their corrected dependency notes below).

### Step 4: Capture baseline legacy-driver scrape output
**What**: Run the CURRENT (pre-migration) Depop and Poshmark scrapers against the same live query/URL used later in verification, and save their output (`Listing[]` JSON) to a scratch file for later comparison.
**Files**: None (read-only run of current code), or a temp output file path of your choice under a `tmp/` or similar gitignored location.
**Test**: Output file contains valid `Listing[]` JSON with at least one entry for each platform.
**Depends on**: None.
**Parallelizable**: Yes — can run anytime before the code is rewritten, since it exercises only the current unmodified code.

### Step 5: Rewrite Depop tile extraction to use cheerio
**What**: Replace `depopTileExtractScript()` in `packages/core/src/platforms/depop/extract.ts` with `extractDepopTilesFromHtml(html: string, baseUrl: string): DepopTileRaw[]` using cheerio (already a package dependency) to parse HTML and extract tile data. Add explicit `new URL(urlValue, baseUrl)` resolution for all extracted URLs/image attributes to ensure absolute URLs, replacing the browser's implicit URL resolution in the old `page.evaluate` flow.
**Files**: `packages/core/src/platforms/depop/extract.ts` (edit).
**Test**: Import `extractDepopTilesFromHtml`; verify it accepts HTML string and baseUrl, returns array of DepopTileRaw objects. Full behavior tested in Step 11b (platform tests).
**Depends on**: Step 1 (errors.ts only — extract.ts is pure HTML→data parsing with zero session/client imports; the original "Depends on: Step 3" was a false dependency that needlessly serialized the critical path).
**Parallelizable**: Yes — with Steps 2a, 2b, 3, and Step 6 (different files, no shared dependencies).

### Step 6: Rewrite Poshmark tile extraction to use cheerio
**What**: Replace `poshmarkTileExtractScript()` in `packages/core/src/platforms/poshmark/extract.ts` with `extractPoshmarkTilesFromHtml(html: string, baseUrl: string)` using cheerio. Add explicit URL resolution with `new URL(urlValue, baseUrl)` for all extracted attributes.
**Files**: `packages/core/src/platforms/poshmark/extract.ts` (edit).
**Test**: Import `extractPoshmarkTilesFromHtml`; verify it accepts HTML and baseUrl, returns array of Poshmark tiles. Full behavior tested in Step 11c.
**Depends on**: Step 1 (errors.ts only — same false-dependency correction as Step 5).
**Parallelizable**: Yes — with Steps 2a, 2b, 3, and Step 5.

### Step 7a: Wire Depop scraper to sidecar calls
**What**: In `packages/core/src/platforms/depop/playwright-fallback.ts` (`scrapeDepopViaPlaywright` function): (1) call `checkSidecarHealth()` at entry (FR12), (2) wrap scrape logic in `withEphemeralPage()` callback, (3) call `navigate()` to the target URL, (4) poll content up to 3x with `pollContent()` using a "tiles found" predicate (same 4s/2s/2s cadence as the current retry loop), (5) call `extractDepopTilesFromHtml()` on the returned HTML, (6) return normalized tile data.
**Files**: `packages/core/src/platforms/depop/playwright-fallback.ts` (edit).
**Test**: Import `scrapeDepopViaPlaywright`; confirm the new sidecar calls are wired with the expected signature (takes URL, returns DepopTile[]). Full behavior in Step 13 (live verification).
**Depends on**: Step 3 (session.ts — `withEphemeralPage`/`navigate`/`pollContent`), Step 5 (`extractDepopTilesFromHtml`).
**Parallelizable**: Yes — with Step 8a (different files; both depend on Step 3 but not on each other).

### Step 7b: Remove legacy Depop imports and drop cookie-banner click
**What**: Remove the old `launchStealthEphemeralBrowser` import and all Patchright-specific calls from `playwright-fallback.ts`. Drop the cookie-consent-banner click code (no click primitive exists in the sidecar API).
**Files**: `packages/core/src/platforms/depop/playwright-fallback.ts` (edit, same file as Step 7a — sequential).
**Test**: Confirm the file no longer imports `browser.ts` or Patchright. Full behavior in Step 13 (live verification).
**Depends on**: Step 7a (same file, sequential).
**Parallelizable**: No — sequential with 7a, same file.
**Rollback-relevant note**: This step drops functionality (the banner click) that has no fixture-based regression test yet. That test is Step 12 below, and it must run before this step (7b) is considered verified — not merely before the final deletion step (Step 19) at the very end of the migration. Don't treat "we'll add the regression test sometime before Step 19" as sufficient; the gate belongs here.

### Step 8a: Rewrite Poshmark context lifecycle
**What**: In `packages/core/src/platforms/poshmark/scraper.ts`, rewrite `getPoshmarkContext` to use `getOrCreatePersistentContext(profilePath)` (returning `contextId: string`, not a BrowserContext), and rewrite `closePoshmarkContext()` to call the new `closeAllPersistentContexts()` helper from `session.ts`. Per plan.md's corrected design, do NOT thread a `profilePath` through CLI call sites — `apps/cli/src/scrape.ts` and `apps/cli/src/run.ts` need NO changes to their existing `closePoshmarkContext()` call sites.
**Files**: `packages/core/src/platforms/poshmark/scraper.ts` (edit).
**Test**: Import functions; verify `getPoshmarkContext` signature now returns `contextId: string`; confirm `closePoshmarkContext()` calls `closeAllPersistentContexts()` internally with no new required arguments.
**Depends on**: Step 3 (session.ts — `getOrCreatePersistentContext`/`closeAllPersistentContexts`).
**Parallelizable**: Yes — with Step 7a (different files).

### Step 8b: Rewrite Poshmark query flow
**What**: Rewrite `scrapePoshmarkQuery(contextId, query)`: `createPage(contextId)` → `navigate(pageId, url)` → `pollContent(pageId, predicate, {timeout: 30s})` → keep the fixed 2s settle sleep unchanged → `getContent(pageId)` → `extractPoshmarkTilesFromHtml()` → `closePage(pageId)`.
**Files**: `packages/core/src/platforms/poshmark/scraper.ts` (edit, same file as Step 8a — sequential).
**Test**: Confirm no imports remain from `browser.ts`. Full behavior in Step 14 (live verification with persistence).
**Depends on**: Step 6 (`extractPoshmarkTilesFromHtml`), Step 8a (same file, sequential).
**Parallelizable**: No — sequential with 8a, same file.

### Step 9: Clean up CLI imports
**What**: Remove the `closeAllStealthBrowsers` import and call from `apps/cli/src/scrape.ts` and `apps/cli/src/run.ts`. Per Step 8a's corrected design, `closePoshmarkContext()` itself now calls `closeAllPersistentContexts()` internally, so CLI call sites keep calling `closePoshmarkContext()` completely unchanged; Depop has no cross-call state to clean (each call owns its context lifecycle).
**Files**: `apps/cli/src/scrape.ts` (edit), `apps/cli/src/run.ts` (edit).
**Test**: Grep for `closeAllStealthBrowsers` in `apps/cli/src/*.ts`; confirm zero matches. Run `npm run lint` in apps/cli to verify no unused imports remain.
**Depends on**: Step 7a, Step 7b, Step 8a, Step 8b.
**Parallelizable**: No — the Depop and Poshmark rewrites must complete first.

### Step 10: Add sidecar client unit tests
**What**: Create `packages/core/tests/platforms/stealth-sidecar/client.test.ts` with unit tests covering: (1) successful context/page/navigate/getContent calls with mocked fetch, (2) connect-error retry behavior (ECONNREFUSED → one retry → success or failure), (3) timeout handling, (4) non-2xx response → `SidecarResponseError`, (5) fetch rejection → `SidecarUnreachableError`, (6) health check with both healthy and unhealthy responses.
**Files**: `packages/core/tests/platforms/stealth-sidecar/client.test.ts` (create).
**Test**: Run `npm test -- client.test.ts`; all tests pass.
**Depends on**: Step 2b (client.ts's full contract, including retry/timeout/error-typing, must exist).
**Parallelizable**: Yes — only needs Step 2b; can run in parallel with Steps 4 through 9.

### Step 11a: Delete retired driver test file
**What**: Delete `packages/core/tests/platforms/playwright-browser.test.ts` (tests the retired module).
**Files**: `packages/core/tests/platforms/playwright-browser.test.ts` (delete).
**Test**: Confirm the file no longer exists; grep for its former test names in `packages/core/tests/` returns zero matches.
**Depends on**: None.
**Parallelizable**: Yes.

### Step 11b: Update Depop platform tests
**What**: Update Depop platform tests (`packages/core/tests/platforms/depop/*.test.ts`) to mock the sidecar client module — `withEphemeralPage`, `navigate`, `getContent`, `pollContent` — instead of playwright-extra/patchright. Verify correct URL resolution (both `url` and `image` fields, including the null-image guard) in `extractDepopTilesFromHtml`.
**Files**: Depop test files under `packages/core/tests/platforms/depop/` (edit).
**Test**: Run `npm test -- platforms/depop/*.test.ts`; all tests pass. Grep for `playwright-extra\|patchright` in the Depop test directory; zero matches.
**Depends on**: Step 5, Step 7a, Step 7b (implementations being tested).
**Parallelizable**: Yes — with Step 11c.

### Step 11c: Update Poshmark platform tests
**What**: Update Poshmark platform tests (`packages/core/tests/platforms/poshmark/*.test.ts`) to mock `getOrCreatePersistentContext`, `createPage`, `navigate`, `pollContent`, `getContent`, `closePage`, `closeAllPersistentContexts`. Verify correct URL resolution in `extractPoshmarkTilesFromHtml`.
**Files**: Poshmark test files under `packages/core/tests/platforms/poshmark/` (edit).
**Test**: Run `npm test -- platforms/poshmark/*.test.ts`; all tests pass. Grep for `playwright-extra\|patchright` in the Poshmark test directory; zero matches.
**Depends on**: Step 6, Step 8a, Step 8b (implementations being tested).
**Parallelizable**: Yes — with Step 11b.

### Step 12: Add fixture-based regression test for dropped cookie-banner click
**What**: Capture real Depop search-results HTML (with the cookie-consent banner NOT dismissed) as a test fixture, and add a test asserting `extractDepopTilesFromHtml` still successfully extracts tiles from that fixture — verifying the plan's assumption that dropping the banner-click is actually harmless, not just asserting it from code inspection.
**Files**: A new fixture HTML file under `packages/core/tests/platforms/depop/fixtures/` (or wherever existing Depop test fixtures live — check the repo for a convention) and the corresponding test file.
**Test**: The new test passes, extracting a non-zero tile count from the un-dismissed-banner fixture.
**Depends on**: Step 5 (extract.ts must exist), Step 7b (banner click actually dropped).
**Parallelizable**: No — must complete before Step 13 (Depop live verification) is considered a valid signal that the migration works.

### Step 13: Verify Depop scraper against live target
**What**: Build the scraper, run Depop scrape against a live listing URL, confirm scrape completes with valid output, contains expected tile data, and no runtime errors or imports from `packages/core/src/platforms/playwright/browser.ts`.
**Files**: (No file changes; manual verification test.)
**Test**: (1) Run scraper build: `cd apps/cli && npm run build`. (2) Run Depop scrape: `npm run scrape -- --platform=depop --url=<live-listing-url>`. (3) Confirm output contains Listing[] with tiles populated. (4) Inspect logs for no "browser.ts" imports or Patchright warnings. (5) Grep the built output: `grep -r "resolveStealthDriver\|launchStealthEphemeralBrowser" apps/cli/dist/` returns zero matches.
**Depends on**: Step 1, Step 2a, Step 2b, Step 3, Step 5, Step 7a, Step 7b, Step 12 (Depop-specific steps only, plus the fixture regression test that gates this step's validity).
**Parallelizable**: Yes — with Step 14, in terms of file conflicts. Expect real-world serialization since both hit the same single-worker-thread sidecar — this is expected sidecar-level queuing, not a bug.

### Step 14: Verify Poshmark scraper against live target with persistence
**What**: Build the scraper, run Poshmark scrape twice in succession against the same live search query on the same day, confirm both runs complete, and cookies/session state persists across runs.
**Files**: (No file changes; manual verification test.)
**Test**: Run a Poshmark scrape once, note the mtime of a specific cookie/session file inside `data/poshmark-profile/` after the run completes. Run a Poshmark scrape a second time immediately after. Confirm: (1) the profile directory is NOT recreated (same inode/creation time), (2) the specific cookie file's mtime updates on the second run (proving reuse+refresh, not a fresh unauthenticated session) — confirmed via `stat` before/after each run.
**Depends on**: Step 1, Step 2a, Step 2b, Step 3, Step 6, Step 8a, Step 8b (Poshmark-specific steps only).
**Parallelizable**: Yes — with Step 13, in terms of file conflicts. Expect real-world serialization since both hit the same single-worker-thread sidecar — this is expected sidecar-level queuing, not a bug.

### Step 15: Verify fail-fast behavior with sidecar stopped
**What**: Stop the local sidecar process, attempt a Depop and a Poshmark scrape run, confirm both fail within the client's single connect-attempt-plus-one-retry window (no multi-minute hang) with `SidecarUnreachableError`, not a generic Playwright error or silent fallback — verifies FR12/AC4.
**Files**: None (manual verification, no file changes).
**Test**: Both scrape attempts fail fast with the correct typed error, confirmed by inspecting the thrown error's class/type.
**Depends on**: Step 2b, Step 5, Step 6, Step 7a, Step 7b, Step 8a, Step 8b (both platforms' code, plus the client's error typing, must be complete).
**Parallelizable**: No — needs both platforms' code complete.

### Step 16: Verify downstream pipeline consumes sidecar-produced output
**What**: Confirm pipeline stages (dedupe/prefilter/scoring) accept scrape output from the sidecar-based scrapers (Steps 13–14) with no code changes required, fulfilling AC7's end-to-end compatibility requirement.
**Files**: (No file changes; integration verification test.)
**Test**: (1) Scrape output from Steps 13–14 is ready (live Depop and Poshmark results via sidecar). (2) Feed this output through the project's existing dedupe/prefilter/score pipeline: use the established execution path (automated scheduler, CLI command `npm run pipeline`, or direct Node function call, depending on project setup). (3) Confirm pipeline execution completes without errors (no schema validation failures, type mismatches, or missing-field exceptions). (4) Verify output structure: each Listing in final results contains all expected fields (title, url, images, price, category, metadata) with the same types and cardinality as legacy Patchright-driven output. (5) Spot-check: compare final scored/deduped output for one Depop listing and one Poshmark listing against the baseline file captured in Step 4, confirming business logic (dedupe grouping, prefilter criteria, score ranges) remains consistent.
**Depends on**: Steps 1–15 (all scraper code, live verification, and the fail-fast check complete; sidecar output available; baseline file from Step 4 available for comparison).
**Parallelizable**: No — requires actual sidecar-produced output from Steps 13–15.

### Step 17: Rewrite verify-scrapers.ts to remove driver selection logic
**What**: Rewrite `scripts/verify-scrapers.ts`: (1) remove `DRIVER_MATRIX`, `PLAYWRIGHT_STEALTH_DRIVER` environment variable handling, and per-driver loop logic (`runDriverMatrix`, `runDepopMatrixRow`, `runPoshmarkMatrixRow` driver parameterization). (2) Rewrite `capturePosture()` to use the new sidecar client directly (no driver selection) — create context, page, navigate to a test URL, screenshot, close. (3) Update report output: Depop and Poshmark each get one report row (not two), confirming sidecar path only.
**Files**: `scripts/verify-scrapers.ts` (edit).
**Test**: Run `node scripts/verify-scrapers.ts`; confirm output shows one row per platform (Depop, Poshmark) without driver labels; screenshots captured via sidecar without error.
**Depends on**: Step 1, Step 2a, Step 2b, Step 3 (client, session modules must exist).
**Parallelizable**: Yes — with Step 18 (different files).

### Step 18: Update docker-compose.yml and Dockerfile for sidecar migration
**What**: Add `STEALTH_SIDECAR_URL` to the `scraper` and `poshmark` services' environment (or rely on `env_file: .env` already present, matching this file's existing pattern — check which fits). Do NOT add a `stealth-sidecar` service block, image reference, healthcheck, or `depends_on` — scraper-commons has no container image yet, and referencing one would break `docker compose up` for the entire stack (dashboard, ntfy, grafana, mcp-server included). This is an explicit, accepted gap: until home-infra (ADR 0014/0015) or scraper-commons ships a reachable containerized sidecar, `scraper`/`poshmark` on the real desktop deploy will fail-fast (correctly, per FR12) when they can't reach `STEALTH_SIDECAR_URL` — this does not affect any other service in the compose file. Also remove the line `RUN pnpm exec playwright install --with-deps chromium` (and its explanatory comment if present) from the fashion-monitor `Dockerfile`, since browser automation no longer runs in-process — this shrinks the image since browser binary installation is now the sidecar's responsibility.
**Files**: `docker-compose.yml` (edit), `Dockerfile` (edit).
**Test**: (1) `docker compose config > /dev/null` succeeds. (2) `grep -q "stealth-sidecar:" docker-compose.yml` finds no match, confirming no new service key was added. (3) `docker build -t fashion-monitor:test .` succeeds without the playwright install step; confirm the final image is noticeably smaller (or at least does not include the chromium binary layer).
**Depends on**: None.
**Parallelizable**: Yes — with Step 17 (different files).
**Rollback note**: No production-breakage risk from this step specifically, since no new service/image reference is added — reversible via `git checkout docker-compose.yml Dockerfile`.

### Step 19: Delete retired driver and remove packages
**What**: (1) Delete `packages/core/src/platforms/playwright/browser.ts` entirely. (2) Remove four packages from `packages/core/package.json` `dependencies`: `patchright`, `playwright`, `playwright-extra`, `puppeteer-extra-plugin-stealth` (all used only by the retired driver; verified via grep in prior steps). (3) Remove the `playwright install chromium` command from the `postinstall` script in the same `package.json` (if present). (4) Run `npm install` to validate lock file consistency. (5) Grep the ENTIRE repo (not just `packages/`) for lingering references to the old driver and its env var — check `docker-compose.yml`, `.env.example`, README, and any CI workflow files (e.g. `.github/workflows/*.yml`), not just TS source under `packages/`.
**Files**: `packages/core/src/platforms/playwright/browser.ts` (delete), `packages/core/package.json` (edit).
**Test**: (1) `npm install` completes without error, lock file is consistent. (2) `grep -rn "PLAYWRIGHT_STEALTH_DRIVER\|resolveStealthDriver\|launchStealthEphemeralBrowser\|launchStealthPersistentContext\|getEphemeralBrowserDriver\|getStealthChromium\|closeAllStealthBrowsers\|resetStealthStateForTests" . --exclude-dir=node_modules --exclude-dir=.git` returns zero matches outside historical docs/spec files, covering `docker-compose.yml`, `.env.example`, README, and CI workflow files as well as `packages/`. (3) Run `npm test` in `packages/core` — all tests pass (verifies no broken imports). (4) Optional: run `npm run build` in apps/cli to confirm no missing dependencies.
**Depends on**: Steps 13–17 (live verification, fail-fast check, pipeline verification, and verify-scrapers rewrite all complete).
**Parallelizable**: No — must be last.

## Rollback plan

**Step 4 (baseline capture):** Read-only run against current, unmodified code; produces only a scratch output file. No rollback needed — delete the scratch file if desired.

**Steps 1, 2a, 2b, 3, 5, 6, 7a, 7b, 8a, 8b, 9, 10, 11a, 11b, 11c, 12 (foundations, code rewrites, test updates, and the cookie-banner regression fixture):** All reversible via `git checkout` since they only add new files or modify existing ones without deleting (Step 11a's deletion of the retired driver test file is also trivially restorable via `git checkout`). Rollback to the last clean commit if any step fails before Step 13.

**Steps 13–15 (live verification + fail-fast check):** These are manual tests with no file changes; rollback is N/A (just don't proceed to Step 16).

**Step 16 (pipeline verification):** Manual test with no file changes; rollback is N/A (just don't proceed to Step 17).

**Step 17 (verify-scrapers rewrite):** Reversible via `git checkout scripts/verify-scrapers.ts` if needed before Step 19.

**Step 18 (docker-compose.yml and Dockerfile update):** No production-breakage risk from this step specifically, since no new service/image reference is added — reversible via `git checkout docker-compose.yml Dockerfile`.

**Step 19 (deletion + package removal):** This is the only truly destructive step. Before running it, ensure: (1) Steps 13–17 confirm both scrapers work against live targets, fail fast correctly when the sidecar is down, the pipeline accepts sidecar output, and all exports of the old driver are gone, (2) all grep checks in Step 19 confirm zero lingering imports across the WHOLE repo, not just `packages/`. If rollback is needed after Step 19, restore the deletion: `git checkout packages/core/src/platforms/playwright/browser.ts packages/core/package.json`. Also restore `package-lock.json` alongside `package.json` and `browser.ts` — re-running `npm install` without the original lockfile risks resolving different transitive dependency versions than what was actually removed. Re-run `npm install` only after the lockfile is restored.

**No parallel-running fallback:** The requirements explicitly prohibit leaving the legacy driver dormant post-migration (FR9, non-functional requirement "No parallel-running period"). Once Step 19 completes and tests pass, the sidecar path is the only path forward; no driver selection or fallback exists.
