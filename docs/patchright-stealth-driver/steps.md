# Steps: Modernize fashion-monitor's Playwright Stealth Driver

## Prerequisites

None. All dependencies are already present (patchright will be added in Step 1); existing `playwright-extra`, `puppeteer-extra-plugin-stealth`, and `vitest` are unchanged.

## Implementation steps

### Step 1: Add patchright dependency and document PLAYWRIGHT_STEALTH_DRIVER
**What**: Declare `patchright` as a dependency in the monorepo's core package alongside existing `playwright-extra` and `puppeteer-extra-plugin-stealth`; add a new environment-variable entry in `.env.example` documenting the `PLAYWRIGHT_STEALTH_DRIVER` env var (currently read by code but undocumented) with its two valid values (`patchright` | `legacy`) and the default (`legacy`).
**Files**: `packages/core/package.json`, `.env.example`
**Test**: Run `pnpm install` in the repo root, then verify `patchright` appears in `pnpm ls patchright`; verify `.env.example` contains `PLAYWRIGHT_STEALTH_DRIVER` entry documenting `patchright|legacy` and the `legacy` default, with format matching existing convention.
**Depends on**: None.
**Parallelizable**: Yes.

### Step 3a: Add StealthDriver type and resolveStealthDriver(override?) helper
**What**: Introduce `StealthDriver` type (`"patchright" | "legacy"`); implement `resolveStealthDriver(override?)` helper function that reads `PLAYWRIGHT_STEALTH_DRIVER` env var fresh on every call (must NOT memoize/cache), defaults/falls back to `legacy`, warns via `console.warn` on unrecognized values like `rebrowser`.
**Files**: `packages/core/src/platforms/playwright/browser.ts`
**Test**: `tsc --noEmit` passes; a temporary throwaway check (not a persisted test file) confirms `resolveStealthDriver("patchright")` returns `"patchright"`, no-arg/`"legacy"` returns `"legacy"`, and `"rebrowser"` warns + returns `"legacy"`.
**Depends on**: Step 1 (patchright dependency must be installed).
**Parallelizable**: No.

### Step 3b: Refactor launchStealthEphemeralBrowser() to branch on resolved driver
**What**: Refactor `launchStealthEphemeralBrowser()` to branch on the resolved driver between `patchright`'s and `playwright-extra`'s launchers. Keep a single nullable `ephemeralBrowser: Browser | null` plus a paired `ephemeralBrowserDriver: StealthDriver | null` tracking which driver launched it. Import `patchright` via dynamic `await import("patchright")` gated behind the resolved driver being `"patchright"` — not a static top-level import — so a broken patchright install only ever breaks the patchright path.
**Files**: `packages/core/src/platforms/playwright/browser.ts`
**Test**: `tsc --noEmit` passes; existing zero-arg callers (`packages/core/src/platforms/depop/playwright-fallback.ts`, verify-scrapers' posture capture) still compile and work unchanged.
**Depends on**: Step 3a.
**Parallelizable**: No.

### Step 3c: Refactor launchStealthPersistentContext() to key by composite driver:profilePath
**What**: Refactor `launchStealthPersistentContext(profilePath, driverOverride?)` the same way as 3b. Fix the `persistentContexts` map to key by a composite `` `${driver}:${profilePath}` `` string (not `profilePath` alone) so a second call with the same path but a different driver does not silently return the wrong driver's cached context.
**Files**: `packages/core/src/platforms/playwright/browser.ts`
**Test**: `tsc --noEmit` passes; existing `packages/core/src/platforms/poshmark/scraper.ts` one-arg call site still compiles and works unchanged.
**Depends on**: Step 3b.
**Parallelizable**: No.

### Step 4: Update close and reset functions for simplified single-nullable-field design
**What**: Update close/reset functions for the simplified design (single nullable `ephemeralBrowser` + `ephemeralBrowserDriver`, not a Map): `closeStealthEphemeralBrowser()` closes the one ephemeral browser if open; `closeAllStealthBrowsers()` closes it plus all persistent contexts across all composite keys; `resetStealthStateForTests()` clears both the single field and the persistent-contexts map.
**Files**: `packages/core/src/platforms/playwright/browser.ts`
**Test**: `tsc --noEmit` passes; existing `packages/core/tests/platforms/playwright-browser.test.ts` still passes (no regressions).
**Depends on**: Step 3c.
**Parallelizable**: No.

### Step 5: Extend packages/core/tests/platforms/playwright-browser.test.ts with patchright-driver tests
**What**: Add new `describe`/`it` blocks to test the `patchright` driver path without modifying the existing two test cases. Steps 3a-3c verify ONLY via `tsc --noEmit` plus confirming the two pre-existing tests in this file still pass — no new ad hoc/throwaway test files. This consolidated test step must: mock `patchright` module at import level (same pattern as existing `playwright-extra` mocks); assert `ScrapeReport.driver`/`PostureCapture.driver` field values directly (not just console text) once those exist; assert a simulated patchright launch failure does not abort a legacy pass; note (not re-test) that `packages/core/tests/platforms/live-smoke.test.ts` and `apps/cli/src/run.ts`'s close-everything-on-exit behavior are unaffected regression-wise (existing coverage).
**Files**: `packages/core/tests/platforms/playwright-browser.test.ts`
**Test**: Run `pnpm exec vitest packages/core/tests/platforms/playwright-browser.test.ts` and verify all tests (existing + new patchright-specific) pass. Verify coverage of AC1, AC2, AC3, AC10 (Acceptance Criteria 1, 2, 3, 10 from requirements doc).
**Depends on**: Steps 3a, 3b, 3c, 4 (must be able to call and verify both driver paths).
**Parallelizable**: Yes (with subsequent steps, after Steps 1–4 are complete).

### Step 6: Build @fm/core before running verify-scrapers
**What**: Build the core package so that compiled output exists before verify-scrapers.ts runs. Steps 3a/3b/3c/4 refactor the source code, but `scripts/verify-scrapers.ts` imports from `packages/core/dist/`, not `src/`. This step ensures `dist/` reflects the new driver-branching logic.
**Files**: None (build step, no source files).
**Test**: `packages/core/dist/platforms/playwright/browser.js` exists and its content reflects the new driver-branching logic (grep for `patchright` in the compiled output).
**Depends on**: Steps 3a, 3b, 3c, 4.
**Parallelizable**: No.

### Step 6a: Replace resolveDriver() with resolveStealthDriver() call
**What**: Replace the existing `resolveDriver()` function (which always warns and returns `"legacy"`) with a call to the now-wired `browser.ts`'s `resolveStealthDriver()` from the built `dist/platforms/playwright/browser.js`. Type `ScrapeReport.driver`/`PostureCapture.driver` as `StealthDriver`; label single-driver runs correctly.
**Files**: `scripts/verify-scrapers.ts`
**Test**: `tsc --noEmit` passes.
**Depends on**: Step 6 (build must complete before script can import built code).
**Parallelizable**: No.

### Step 6b: Add per-driver temp profile dir creation for Poshmark
**What**: For Poshmark, create a fresh temp profile dir per driver via `mkdtempSync` to avoid Chromium `SingletonLock` collisions between driver passes. Remove the temp dir (`rmSync(path, { recursive: true, force: true })`) in a `finally` block after each driver's pass completes.
**Files**: `scripts/verify-scrapers.ts`
**Test**: `tsc --noEmit` passes.
**Depends on**: Step 6a.
**Parallelizable**: No.

### Step 6c: Add DRIVER_MATRIX loop for Depop/Poshmark with driver-specific env var and result labeling
**What**: Add a `DRIVER_MATRIX = ["legacy", "patchright"] as const satisfies readonly StealthDriver[]` loop that, for Depop and Poshmark only: mutates/restores `process.env.PLAYWRIGHT_STEALTH_DRIVER` around each iteration; merges the existing scrape-check loop and posture-probe loop per-iteration for Depop/Poshmark; records Depop's `driver` field as a "not applicable" sentinel when its input-first path succeeds without launching any browser; pulls Vestiaire OUT of the existing combined posture loop into its own single, unlabeled run (since Vestiaire must not be duplicated per-driver); closes everything between passes. Restore `process.env.PLAYWRIGHT_STEALTH_DRIVER` in `finally`.
**Files**: `scripts/verify-scrapers.ts`
**Test**: A single `verify:scrapers` invocation produces two labeled rows each for Depop and Poshmark, Vestiaire/eBay/Grailed appear exactly once, and `process.env.PLAYWRIGHT_STEALTH_DRIVER` is restored to its original value after the script exits.
**Depends on**: Step 6b.
**Parallelizable**: No.

### Step 7: Update docs/playwright-stealth-pilot.md
**What**: Remove `rebrowser-patches` entirely from the "Mitigations" or candidate list (not merely deprioritized). Add the 2026-07-18 benchmark citation with real source URL https://ianlpaterson.com/blog/anti-detect-browser-benchmark-patchright-nodriver-curl-cffi/ (651 verdicts, 31 Cloudflare-protected targets, published 2026-05-13, updated 2026-07-12, Patchright 25/29 OK vs. rebrowser-patches/vanilla tied at 24/29 OK). Change the "Recommended pilot" section from "not yet wired" to "wired": point readers at `resolveStealthDriver()` in `packages/core/src/platforms/playwright/browser.ts` and the matrix loop in `scripts/verify-scrapers.ts`. Retarget the "Do not remove yet" gate to name Patchright specifically while keeping it a hard requirement (playwright-extra + stealth-plugin stays until Patchright passes live smoke on both Depop and Poshmark; the gate is not weakened, only retargeted).
**Files**: `docs/playwright-stealth-pilot.md`
**Test**: (1) Verify the file contains no mention of `rebrowser-patches` as an active candidate (Camoufox may still be mentioned as an out-of-scope alternative). (2) Verify the benchmark citation is present and the URL https://ianlpaterson.com/blog/anti-detect-browser-benchmark-patchright-nodriver-curl-cffi/ appears in the file. (3) Verify the gate is still present and still requires live smoke on Depop/Poshmark before removal. (4) Verify any code references point to real, existing locations (e.g., `packages/core/src/platforms/playwright/browser.ts` exists).
**Depends on**: Steps 6a, 6b, 6c (doc must be truthful about what code does).
**Parallelizable**: No.

### Step 8: Update stale rebrowser references in docs and skills
**What**: Grep for and update every reference to `rebrowser`/`rebrowser-patches` as a live/recognized option in `.claude/skills/fashion-monitor-change-control/SKILL.md`, `.claude/skills/fashion-monitor-research-frontier/SKILL.md`, `.claude/skills/resale-platforms-reference/SKILL.md`, and `docs/plans/stack-modernization.md`. Mentions of it as a rejected/historical option are fine; the goal is removing it from descriptions of active/recognized candidates.
**Files**: `.claude/skills/fashion-monitor-change-control/SKILL.md`, `.claude/skills/fashion-monitor-research-frontier/SKILL.md`, `.claude/skills/resale-platforms-reference/SKILL.md`, `docs/plans/stack-modernization.md`
**Test**: `grep -rn "rebrowser" .claude/skills docs/plans/stack-modernization.md` returns no hits describing it as active/recognized.
**Depends on**: Step 7 (doc update must complete first).
**Parallelizable**: No.

## Rollback plan

**Step 1** (dependency and env-var additions): Revert via `git checkout packages/core/package.json .env.example pnpm-lock.yaml && pnpm install` (lockfile must be reverted too since `pnpm install` modifies it, and CI uses `--frozen-lockfile`).

**Steps 3a–4** (browser.ts refactor): Revert via `git checkout packages/core/src/platforms/playwright/browser.ts`.

**Step 5** (test additions): Revert via `git checkout packages/core/tests/platforms/playwright-browser.test.ts`.

**Step 6** (build step): No rollback needed (build output is ephemeral).

**Steps 6a–6c** (verify-scrapers.ts changes): Revert via `git checkout scripts/verify-scrapers.ts`. Note: temp profile dirs created by Step 6b are OS-tmpdir-scoped; a run killed before its `finally` executes may leave one orphaned dir behind — low-severity residue, cleaned up by normal OS temp-dir hygiene, not a blocking rollback concern.

**Step 7** (playwright-stealth-pilot.md doc updates): Revert via `git checkout docs/playwright-stealth-pilot.md`.

**Step 8** (rebrowser-reference cleanup): Revert via `git checkout .claude/skills/fashion-monitor-change-control/SKILL.md .claude/skills/fashion-monitor-research-frontier/SKILL.md .claude/skills/resale-platforms-reference/SKILL.md docs/plans/stack-modernization.md`.

All steps are fully reversible via `git checkout` on their respective files. No database, file-system, or irreversible state changes.

