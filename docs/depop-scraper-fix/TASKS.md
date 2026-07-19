# Tasks: Depop Scraper Data-Source Fix

Generated from: docs/depop-scraper-fix/ on 2026-07-19

## Status legend
- [ ] pending
- [>] in progress
- [x] done
- [!] blocked

## Tasks

### Task 1: Live-verify the real endpoint, block behavior, and DOM hydration BEFORE building anything
**Status**: [x] done
**Files**: none (read-only investigation)
**Test**: A written finding exists for: (1) confirmed endpoint URL, (2) plain-HTTP success rate, (3) real success JSON shape OR real block-response shape, (4) real DOM tile CSS selector OR confirmed-blocked/no-hydration status.
**Depends on**: none
**Parallelizable**: No
**Notes**: Findings in docs/depop-scraper-fix/investigation-findings.md. Key results: (a) endpoint confirmed live at www.depop.com/presentation/api/v1/search/products/; (b) plain impit HTTP call SUCCEEDS (200) with no cookie/header engineering — Task 8b should be SKIPPED; (c) real shape is {meta,page_info,objects[]}, closely matches existing normalizeDepopRscProduct pricing/pictures shape (keep as legacy per FR14), preview is single object not size-keyed, sizes are objects not strings, no timestamp field exists (listedAt must be null); (d) DOM fallback hydrates fine with the LEGACY stealth driver, real selector confirmed: `a[href*='/products/']`.

### Task 2: Create provisional fixture from Task 1's confirmed shape
**Status**: [x] done
**Files**: packages/core/tests/fixtures/depop/search-response.json
**Test**: `cat packages/core/tests/fixtures/depop/search-response.json` shows a valid JSON object with a `products` array matching Task 1's confirmed (or documented-inferred) shape.
**Depends on**: Task 1
**Parallelizable**: Yes
**Notes**: 2 products (real Fashion Nova item + invented discounted item for final_price_key/is_reduced coverage), valid JSON confirmed.

### Task 3: Add new log events and sync the logging registry doc (with conditional RSC-event retirement)
**Status**: [x] done
**Files**: packages/core/src/lib/log-events.ts, docs/logging-and-audit.md
**Test**: grep for the six new event IDs in log-events.ts and docs/logging-and-audit.md; conditional retirement of PlatformDepopRscSuccess per Task 1's finding.
**Depends on**: Task 1
**Parallelizable**: Yes
**Notes**: 6 new events added; PlatformDepopRscSuccess KEPT (not retired) since RSC branch is being retained as legacy per Task 1's finding. Redaction guarantee documented in logging-and-audit.md.

### Task 4: Update parse-rsc.ts with the confirmed API URL builder
**Status**: [x] done
**Files**: packages/core/src/platforms/depop/parse-rsc.ts
**Test**: grep for buildDepopProductsApiUrl; conditional removal of SEARCH_MARKER/extractDepopListingsFromHtml per Task 1's finding.
**Depends on**: Task 1
**Parallelizable**: Yes
**Notes**: Added buildDepopProductsApiUrl + DepopProductsApiResponse interface; RSC functions RETAINED (not removed) with legacy comment; no new tsc errors.

### Task 5: Create fetch-scrapfly.ts for the Cloudflare-bypass tier, and mark its test-env key optional
**Status**: [x] done
**Files**: packages/core/src/platforms/depop/fetch-scrapfly.ts, packages/core/tests/helpers/live-env.ts
**Test**: grep for fetchDepopViaScrapfly export; live-env.ts depop entry shows SCRAPFLY_API_KEY as optional with explanatory note.
**Depends on**: Task 1
**Parallelizable**: Yes
**Notes**: fetchDepopViaScrapfly created (JSON-parsing variant of Vestiaire's pattern, secrets-safe error wrapping); live-env.ts depop entry now optional:["SCRAPFLY_API_KEY"] with live-verified note.

### Task 6: Create extract.ts for DOM tile extraction using the confirmed selector
**Status**: [x] done
**Files**: packages/core/src/platforms/depop/extract.ts
**Test**: grep for depopTileExtractScript and parseDepopTile exports.
**Depends on**: Task 1
**Parallelizable**: Yes
**Notes**: DepopTileRaw interface, parseDepopTileText (Node-callable), depopTileExtractScript (browser, selector a[href*='/products/'], dedupe by slug, honest best-effort brand/size defaults documented).

### Task 7: Update normalize.ts for the confirmed shape, keeping RSC legacy branch as a conditional decision
**Status**: [x] done
**Files**: packages/core/src/platforms/depop/normalize.ts
**Test**: `pnpm run test packages/core/tests/platforms/depop.test.ts -- --reporter=verbose` passes offline.
**Depends on**: Task 1, Task 2
**Parallelizable**: Yes
**Notes**: normalizeDepopApiProduct added (throws on missing id/price), dispatch fixed via pricing.final_price_key check, _normalizerSource tag on all 3 branches, parseDepopProducts reads objects??products, throws on unexpected shape. tsc clean.

### Task 8a: Rewrite scraper.ts's primary HTTP tier (simple call, no cookie/header machinery)
**Status**: [x] done
**Files**: packages/core/src/platforms/depop/scraper.ts
**Test**: `pnpm run test packages/core/tests/platforms/depop-scraper-http.test.ts -- --reporter=verbose` passes with fixture data.
**Depends on**: Task 1, Task 3, Task 4, Task 5, Task 7
**Parallelizable**: No
**Notes**: searchViaHttp rewritten against buildDepopProductsApiUrl + parseDepopProducts; one-shot ScrapFly escalation on strict Cloudflare header check (403/429 + server:cloudflare + cf-ray); legitimate empty 2xx returned as-is (not treated as failure); export line preserved; tsc clean.

### Task 8b (CONDITIONAL): Add cookie-harvest/UUID-header engineering to the primary tier
**Status**: [x] done (SKIPPED per conditional)
**Files**: packages/core/src/platforms/depop/scraper.ts
**Test**: IF BUILT: cookie/header test cases pass. IF SKIPPED: recorded in notes why Task 1 justified skipping.
**Depends on**: Task 1, Task 8a
**Parallelizable**: No
**Notes**: SKIPPED — Task 1's live verification confirmed a single plain impit HTTP call succeeds unassisted (200) with no cookie warm-up or custom headers, on the very first attempt. Building the cookie-harvest/UUID-header machinery has no evidence behind it per the plan's own conditional, so it was not built. No test cases needed for it.

### Task 9: Update playwright-fallback.ts for real DOM extraction
**Status**: [x] done
**Files**: packages/core/src/platforms/depop/playwright-fallback.ts
**Test**: `pnpm run test packages/core/tests/platforms/depop-fallback.test.ts -- --reporter=verbose` passes with fixture-mocked page content.
**Depends on**: Task 1, Task 3, Task 4, Task 6, Task 7
**Parallelizable**: No
**Notes**: scrapeDepopViaPlaywright rewritten to use depopTileExtractScript + inline depopTileToListing converter; up to 3 hydration-wait attempts (4s then 2s) replacing old 15x2s poll; per-tile price-parse failures skip that tile rather than failing the batch; tsc clean.

### Task 10: Update test coverage — conditional RSC-test removal, corrected file list
**Status**: [x] done
**Files**: packages/core/tests/platforms/depop-rsc.test.ts, packages/core/tests/platforms/depop-normalize-rsc.test.ts, packages/core/tests/platforms/depop.test.ts, packages/core/tests/platforms/depop-scraper-http.test.ts, packages/core/tests/platforms/depop-fallback.test.ts
**Test**: `pnpm run test packages/core/tests/platforms/depop*.test.ts -- --reporter=verbose` passes.
**Depends on**: Task 1, Task 2, Task 3, Task 4, Task 5, Task 6, Task 7, Task 8a, Task 8b, Task 9
**Parallelizable**: No
**Notes**: 24/24 tests pass across all 5 files. RSC tests kept (retained legacy path still exercised via inline fixtures, not the shared JSON). Agent flagged a real tsc error (DepopProductsApiResponse missing index signature) instead of working around it in tests — fixed directly in parse-rsc.ts by orchestrator (added `[key: string]: unknown`). Full package tsc now clean.

### Task 11: Add three-tier cascade test cases
**Status**: [x] done
**Files**: packages/core/tests/platforms/depop.test.ts
**Test**: cascade/cloudflare/scrapfly/exhausted test cases pass offline.
**Depends on**: Task 8a, Task 8b, Task 9, Task 10
**Parallelizable**: No
**Notes**: Task 10 already added extensive searchViaHttp-level cascade tests to depop-scraper-http.test.ts; the 2 real remaining gaps (searchQuery-level Cloudflare-no-key-falls-through-to-Playwright, and all-tiers-exhausted-throws) added directly to depop.test.ts. 26/26 tests pass across all 5 depop test files; tsc clean.

### Task 12: Update spec/platforms/depop.md to match what actually shipped
**Status**: [x] done
**Files**: spec/platforms/depop.md
**Test**: grep confirms dead endpoint/marker removed (or documented as legacy) and new endpoint documented as shipped.
**Depends on**: Task 1, Task 8a, Task 8b, Task 9
**Parallelizable**: No
**Notes**: Full rewrite covering all 3 tiers as shipped, real response shape, legacy RSC-branch retention rationale, driver-flag integration, pagination/durability caveats. Written directly by orchestrator (facts already assembled from investigation-findings.md + shipped code).

## Blocked / open
(populated during implementation)
