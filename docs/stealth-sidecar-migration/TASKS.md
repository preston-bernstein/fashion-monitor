# Tasks: Stealth Sidecar Migration

Generated from: docs/stealth-sidecar-migration/ on 2026-07-21

## Status legend
- [ ] pending
- [>] in progress
- [x] done
- [!] blocked

## Tasks

### Task 1: Create error types module
**Status**: [x] done
**Files**: packages/core/src/platforms/stealth-sidecar/errors.ts (create)
**Test**: grep -r "SidecarError\|SidecarUnreachableError\|SidecarResponseError" packages/core/src --include="*.ts" returns only errors.ts itself; confirm exports are importable.
**Depends on**: none
**Parallelizable**: No
**Notes**: SidecarError base (readonly type discriminator), SidecarUnreachableError, SidecarResponseError (status + errorType + message only, no raw payload). tsc --strict clean.

### Task 2a: Create sidecar HTTP client core
**Status**: [x] done
**Files**: packages/core/src/platforms/stealth-sidecar/client.ts (create), .env.example (edit)
**Test**: Import client functions; verify signatures. Confirm STEALTH_SIDECAR_URL entry in .env.example.
**Depends on**: Task 1
**Parallelizable**: No
**Notes**: Full client (checkHealth/createContext/createPage/navigate/getContent/getScreenshot/closePage/closeContext) + 2b's scope completed in same pass. tsc+eslint clean.

### Task 2b: Add retry, timeout, and error-typing to sidecar client
**Status**: [x] done
**Files**: packages/core/src/platforms/stealth-sidecar/client.ts (edit)
**Test**: Retry/timeout/error-mapping code paths exist for each documented error.type value.
**Depends on**: Task 2a
**Parallelizable**: No
**Notes**: Completed as part of Task 2a's pass: 25s navigate timeout cap, exactly-one-retry on connect-level failure only (200ms delay), full SidecarError typing.

### Task 3: Create session wrapper module
**Status**: [x] done
**Files**: packages/core/src/platforms/stealth-sidecar/session.ts (create)
**Test**: Import session functions; verify signatures and client-module calls.
**Depends on**: Task 2b
**Parallelizable**: No
**Notes**: withEphemeralPage, getOrCreatePersistentContext (in-flight-promise cache, path-traversal guard), closeAllPersistentContexts, pollContent. tsc clean.

### Task 4: Capture baseline legacy-driver scrape output
**Status**: [x] done
**Files**: none (read-only run; scratch output file)
**Test**: Output file contains valid Listing[] JSON with at least one entry per platform.
**Depends on**: none
**Parallelizable**: Yes
**Notes**: /tmp/fashion-monitor-baseline-scrape.json — 24 real Depop listings captured live. Poshmark returned 0 (no data/poshmark-profile exists in this worktree — no authenticated session available); flagged for Task 14/16, not fabricated.

### Task 5: Rewrite Depop tile extraction to use cheerio
**Status**: [x] done
**Files**: packages/core/src/platforms/depop/extract.ts (edit)
**Test**: extractDepopTilesFromHtml accepts HTML+baseUrl, returns DepopTileRaw[].
**Depends on**: Task 1
**Parallelizable**: Yes (with 2a, 2b, 3, 6)
**Notes**: cheerio-based, url+image resolved via new URL(), null-guarded image. Sanity-checked, tsc clean. depopTileExtractScript() kept (caller removed in Task 7b).

### Task 6: Rewrite Poshmark tile extraction to use cheerio
**Status**: [x] done
**Files**: packages/core/src/platforms/poshmark/extract.ts (edit)
**Test**: extractPoshmarkTilesFromHtml accepts HTML+baseUrl, returns tiles.
**Depends on**: Task 1
**Parallelizable**: Yes (with 2a, 2b, 3, 5)
**Notes**: cheerio-based, reuses parsePoshmarkMetaText(), url+image resolved via new URL(). Sanity-checked, tsc clean. poshmarkTileExtractScript() kept (caller removed in Task 8b).

### Task 7a: Wire Depop scraper to sidecar calls
**Status**: [x] done
**Files**: packages/core/src/platforms/depop/playwright-fallback.ts (edit)
**Test**: scrapeDepopViaPlaywright wired to sidecar calls, signature unchanged.
**Depends on**: Task 3, Task 5
**Parallelizable**: Yes (with 8a)
**Notes**: checkHealth→withEphemeralPage→navigate→pollContent(8s/2s)→extractDepopTilesFromHtml. Legacy import + banner click removed in same pass (couldn't compile as dead code) — see Task 7b.

### Task 7b: Remove legacy Depop imports and drop cookie-banner click
**Status**: [x] done
**Files**: packages/core/src/platforms/depop/playwright-fallback.ts (edit, same file as 7a)
**Test**: No import of browser.ts or Patchright remains.
**Depends on**: Task 7a
**Parallelizable**: No
**Notes**: Completed as part of Task 7a's pass — verified via Read, file has zero legacy imports/banner-click code. Fixture regression test (Task 12) still needed to verify the drop is safe.

### Task 8a: Rewrite Poshmark context lifecycle
**Status**: [x] done
**Files**: packages/core/src/platforms/poshmark/scraper.ts (edit)
**Test**: getPoshmarkContext returns contextId: string; closePoshmarkContext() calls closeAllPersistentContexts() with no new required args.
**Depends on**: Task 3
**Parallelizable**: Yes (with 7a)
**Notes**: Done. One expected temporary tsc error (scrapePoshmarkQuery still expects BrowserContext) — resolved by Task 8b.

### Task 8b: Rewrite Poshmark query flow
**Status**: [x] done
**Files**: packages/core/src/platforms/poshmark/scraper.ts (edit, same file as 8a)
**Test**: No imports remain from browser.ts.
**Depends on**: Task 6, Task 8a
**Parallelizable**: No
**Notes**: createPage→navigate→pollContent(30s/2s)→sleep(2s)→getContent→extractPoshmarkTilesFromHtml→closePage. contextId now string throughout. tsc clean.

### Task 9: Clean up CLI imports
**Status**: [x] done
**Files**: apps/cli/src/scrape.ts (edit), apps/cli/src/run.ts (edit)
**Test**: grep for closeAllStealthBrowsers in apps/cli/src/*.ts returns zero matches; lint passes.
**Depends on**: Task 7a, Task 7b, Task 8a, Task 8b
**Parallelizable**: No
**Notes**: CORRECTED 2026-07-21: original completion report was false — the import/call were still present, caught by Task 16's verification agent (would have broken Task 19). Fixed directly by orchestrator this time; grep now clean (exit 1), tsc clean in apps/cli.

### Task 10: Add sidecar client unit tests
**Status**: [x] done
**Files**: packages/core/tests/platforms/stealth-sidecar/client.test.ts (create)
**Test**: npm test -- client.test.ts passes.
**Depends on**: Task 2b
**Parallelizable**: Yes (with Tasks 4-9)
**Notes**: 26 tests, all passing, no client.ts bugs found.

### Task 11a: Delete retired driver test file
**Status**: [x] done
**Files**: packages/core/tests/platforms/playwright-browser.test.ts (delete)
**Test**: File no longer exists; grep for its former test names returns zero matches.
**Depends on**: none
**Parallelizable**: Yes
**Notes**: Deleted.

### Task 11b: Update Depop platform tests
**Status**: [x] done
**Files**: packages/core/tests/platforms/depop-extract.test.ts, depop-playwright-fallback.test.ts (edit)
**Test**: npm test passes; grep for playwright-extra|patchright returns zero matches (outside allowed comments).
**Depends on**: Task 5, Task 7a, Task 7b
**Parallelizable**: Yes (with 11c)
**Notes**: 26 tests, all passing, no implementation bugs found.

### Task 11c: Update Poshmark platform tests
**Status**: [x] done
**Files**: packages/core/tests/platforms/poshmark-extract.test.ts, poshmark.test.ts (edit)
**Test**: npm test passes; grep for playwright/patchright/BrowserContext returns zero matches.
**Depends on**: Task 6, Task 8a, Task 8b
**Parallelizable**: Yes (with 11b)
**Notes**: 27 tests, all passing. Found real bug in PoshmarkScraper.search() (context-open failure wasn't caught, would abort entire Promise.all pipeline) — fixed directly by orchestrator, test updated to assert correct degrade-to-ok:false behavior.

### Task 12: Add fixture-based regression test for dropped cookie-banner click
**Status**: [x] done
**Files**: packages/core/tests/platforms/depop-extract.test.ts (edit, appended test case)
**Test**: New test passes, extracting non-zero tile count from un-dismissed-banner fixture.
**Depends on**: Task 5, Task 7b
**Parallelizable**: No
**Notes**: Live fetch attempted (403), fell back to synthetic-but-realistic OneTrust-banner fixture per fallback guidance. 14/14 tests pass.

### Task 13: Verify Depop scraper against live target
**Status**: [x] done
**Files**: none (manual verification)
**Test**: Live Depop scrape produces valid tiles, no browser.ts imports.
**Depends on**: Task 1, 2a, 2b, 3, 5, 7a, 7b, 12
**Parallelizable**: Yes (with 14, file-wise; expect sidecar-level serialization)
**Notes**: CLI's HTTP-first path succeeded (24 listings, matches baseline) so never touched sidecar (expected). Directly invoked scrapeDepopViaPlaywright to exercise the sidecar path: succeeded, 24 listings, sidecar driver_state confirmed "alive" mid-call. No browser.ts refs in compiled dist.

### Task 14: Verify Poshmark scraper against live target with persistence
**Status**: [x] done
**Files**: none (manual verification)
**Test**: Two successive Poshmark runs; profile dir not recreated, cookie file mtime updates on 2nd run.
**Depends on**: Task 1, 2a, 2b, 3, 6, 8a, 8b
**Parallelizable**: Yes (with 13, file-wise; expect sidecar-level serialization)
**Notes**: No real Poshmark login in this environment (documented limitation, not a defect). Two CLI process runs with fixed profile path: on-disk Chromium profile dir verified reused (same inode, Cookies file grew 66→76 rows) across runs — real persistence at the browser-storage layer confirmed. Node-side in-memory cache is process-local by design (new sidecar context per CLI invocation) — not a bug, already covered by AC9's unit test.

### Task 15: Verify fail-fast behavior with sidecar stopped
**Status**: [x] done
**Files**: none (manual verification)
**Test**: Both scrapers fail fast with SidecarUnreachableError when sidecar is stopped.
**Depends on**: Task 2b, 5, 6, 7a, 7b, 8a, 8b
**Parallelizable**: No
**Notes**: Sidecar killed, confirmed refused. Depop's sidecar-fallback path: SidecarUnreachableError in 208ms via checkHealth() pre-check. Poshmark (always sidecar-dependent): failed cleanly in ~221ms, surfaced via normal pipeline error-reporting (not a crash/hang/silent fallback).

### Task 16: Verify downstream pipeline consumes sidecar-produced output
**Status**: [x] done
**Files**: none (integration verification)
**Test**: Pipeline consumes sidecar output with no code changes; compare against Task 4 baseline.
**Depends on**: Tasks 1-15
**Parallelizable**: No
**Notes**: Real prefilter/dedupe/score(mock provider)/alert-dispatch round trip via a fresh harness against real extraction/mapping code — zero exceptions, correct Listing field set matching baseline shape. Also caught the Task 9 false-completion regression (see Task 9 note), fixed by orchestrator.

### Task 17: Rewrite verify-scrapers.ts to remove driver selection logic
**Status**: [x] done
**Files**: scripts/verify-scrapers.ts (edit)
**Test**: node scripts/verify-scrapers.ts shows one row per platform, no driver labels.
**Depends on**: Task 1, 2a, 2b, 3
**Parallelizable**: Yes (with 18)
**Notes**: 389→341 lines. Matrix/driver logic removed, capturePosture rewritten on sidecar client. Ran live: 5 rows, no crash, no driver labels; Poshmark failed gracefully (no sidecar running) as expected.

### Task 18: Update docker-compose.yml and Dockerfile for sidecar migration
**Status**: [x] done
**Files**: docker-compose.yml (edit), Dockerfile (edit)
**Test**: docker compose config succeeds; grep confirms no stealth-sidecar: service key added; docker build succeeds without playwright install step.
**Depends on**: none
**Parallelizable**: Yes (with 17)
**Notes**: STEALTH_SIDECAR_URL flows via existing env_file:.env mechanism, no new service block. Playwright install removed from Dockerfile. No stealth-sidecar: key present.

### Task 19: Delete retired driver and remove packages
**Status**: [x] done
**Files**: packages/core/src/platforms/playwright/browser.ts (delete), packages/core/package.json (edit)
**Test**: npm install succeeds; whole-repo grep for old driver refs returns zero matches outside historical docs; npm test passes in packages/core.
**Depends on**: Task 13, 14, 15, 16, 17
**Parallelizable**: No — must be last
**Notes**: browser.ts deleted, 4 packages removed (incl. both duplicate patchright keys), postinstall trimmed. pnpm install clean, whole-repo grep clean, tsc clean (core+cli), 333/333 tests pass.

## All 19 tasks complete.

## Blocked / open
(none yet)
