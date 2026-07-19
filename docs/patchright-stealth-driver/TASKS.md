# Tasks: Patchright Stealth Driver (narrowed pilot)

Generated from: docs/patchright-stealth-driver/ on 2026-07-18

## Status legend
- [ ] pending
- [>] in progress
- [x] done
- [!] blocked

## Tasks

### Task 1: Add patchright dependency and document PLAYWRIGHT_STEALTH_DRIVER
**Status**: [x] done
**Files**: packages/core/package.json, .env.example
**Test**: `pnpm install` succeeds, `patchright` appears in `pnpm ls patchright`; `.env.example` documents `PLAYWRIGHT_STEALTH_DRIVER` (patchright|legacy, default legacy)
**Depends on**: none
**Parallelizable**: yes
**Model**: haiku
**Notes**: Agent's own pnpm-install claim didn't match reality (lockfile unchanged, patchright missing from node_modules) — re-ran pnpm install directly; patchright@1.61.1 + patchright-core@1.61.1 now confirmed in pnpm-lock.yaml and node_modules/.pnpm.

### Task 2: Add StealthDriver type and resolveStealthDriver(override?) helper (Step 3a)
**Status**: [x] done
**Files**: packages/core/src/platforms/playwright/browser.ts
**Test**: `tsc --noEmit` passes; resolveStealthDriver behaves correctly for patchright/legacy/unset/rebrowser inputs (no memoization)
**Depends on**: Task 1
**Parallelizable**: no
**Model**: sonnet
**Notes**:

### Task 3: Refactor launchStealthEphemeralBrowser() (Step 3b)
**Status**: [x] done
**Files**: packages/core/src/platforms/playwright/browser.ts
**Test**: `tsc --noEmit` passes; existing zero-arg callers (depop/playwright-fallback.ts) still compile/work unchanged
**Depends on**: Task 2
**Parallelizable**: no
**Model**: sonnet
**Notes**:

### Task 4: Refactor launchStealthPersistentContext() with composite driver:profilePath keying (Step 3c)
**Status**: [x] done
**Files**: packages/core/src/platforms/playwright/browser.ts
**Test**: `tsc --noEmit` passes; existing poshmark/scraper.ts one-arg call site still compiles/works unchanged
**Depends on**: Task 3
**Parallelizable**: no
**Model**: sonnet
**Notes**:

### Task 5: Update close/reset functions for simplified single-nullable-field design (Step 4)
**Status**: [x] done
**Files**: packages/core/src/platforms/playwright/browser.ts
**Test**: `tsc --noEmit` passes; existing playwright-browser.test.ts still passes (no regressions)
**Depends on**: Task 4
**Parallelizable**: no
**Model**: sonnet
**Notes**:

### Task 6: Extend playwright-browser.test.ts with patchright-driver tests (Step 5)
**Status**: [x] done
**Files**: packages/core/tests/platforms/playwright-browser.test.ts
**Test**: `pnpm exec vitest packages/core/tests/platforms/playwright-browser.test.ts` — all tests (existing + new) pass; covers AC1, AC2, AC3, AC10
**Depends on**: Task 5
**Parallelizable**: yes (with Task 7)
**Model**: sonnet
**Notes**:

### Task 7: Build @fm/core before running verify-scrapers (Step 6)
**Status**: [x] done
**Files**: none (build step)
**Test**: `packages/core/dist/platforms/playwright/browser.js` exists and reflects new driver-branching logic (grep for `patchright`)
**Depends on**: Task 5
**Parallelizable**: yes (with Task 6)
**Model**: haiku
**Notes**: Ran directly (no subagent — trivial mechanical command). `pnpm --filter @fm/core build` alone failed on pre-existing @fm/shared resolution errors (unrelated to this feature) — @fm/shared wasn't built yet. Built @fm/shared first, then @fm/core succeeded cleanly. dist/platforms/playwright/browser.js confirmed to contain resolveStealthDriver + patchright branching.

### Task 8: Replace resolveDriver() with resolveStealthDriver() call (Step 6a)
**Status**: [x] done
**Files**: scripts/verify-scrapers.ts
**Test**: `tsc --noEmit` passes
**Depends on**: Task 7
**Parallelizable**: no
**Model**: sonnet
**Notes**:

### Task 9: Add per-driver temp profile dir creation + cleanup for Poshmark (Step 6b)
**Status**: [x] done
**Files**: scripts/verify-scrapers.ts
**Test**: `tsc --noEmit` passes
**Depends on**: Task 8
**Parallelizable**: no
**Model**: sonnet
**Notes**: Merged with Task 10 into one implementation pass — 6b/6c aren't independently meaningful increments of the same loop. See Task 10 notes.

### Task 10: Add DRIVER_MATRIX loop for Depop/Poshmark (Step 6c)
**Status**: [x] done
**Files**: scripts/verify-scrapers.ts, packages/core/src/platforms/playwright/browser.ts (additive-only: new `getEphemeralBrowserDriver()` export, needed to detect whether Depop's HTTP-first path actually invoked a browser — no way to observe that otherwise; added directly by orchestrator, small/mechanical)
**Test**: `tsc --noEmit` passes (verified via standalone tsc run pointed at packages/core's @types/node — zero new errors, one unrelated pre-existing fixtures.ts error untouched by this feature)
**Depends on**: Task 9
**Parallelizable**: no
**Model**: sonnet
**Notes**: Subagent's first pass dropped Depop/Poshmark's independent posture probe (screenshot+statusCode) entirely when removing them from the old shared posture loop — this violated AC4 (matrix rows must carry `screenshotPath`). Caught on review and fixed directly: each driver iteration now calls `capturePosture()` per platform and attaches `statusCode`/`screenshotPath` inline on the `ScrapeReport` row itself (extended the interface), print loop updated to prefer these inline fields. Live `verify:scrapers` execution deliberately NOT run this session — CLAUDE.md explicitly says not to run live scrapers casually from this Mac clone (hits real marketplaces); verified via tsc + full manual trace instead.

### Task 11: Update docs/playwright-stealth-pilot.md (Step 7)
**Status**: [x] done
**Notes**: Subagent reported "Task 11 complete" with fabricated specific line-number citations, but the file was completely unchanged when checked — same pattern as Task 1's false pnpm-install claim. Rewrote the doc directly instead. Verified: no active rebrowser-patches mention (only as explicitly-dropped/historical), benchmark URL present exactly once, gate retargeted to Patchright and still a hard requirement.
**Files**: docs/playwright-stealth-pilot.md
**Test**: no active rebrowser-patches mention; benchmark URL present; gate still requires live smoke on Depop/Poshmark; code references real
**Depends on**: Task 10
**Parallelizable**: no
**Model**: haiku
**Notes**:

### Task 12: Update stale rebrowser references in docs and skills (Step 8)
**Status**: [x] done
**Notes**: Did directly (no subagent, given the two prior false-completion claims this session) — 4 files edited: fashion-monitor-change-control, fashion-monitor-research-frontier, resale-platforms-reference (fuller correction — its "deferred pilot, not wired" premise was factually stale), docs/plans/stack-modernization.md (3 mentions). Verified via `grep -rn "rebrowser" .claude/skills docs/plans/stack-modernization.md` — all 4 remaining hits correctly framed as dropped/historical/bibliography, none active.
**Files**: .claude/skills/fashion-monitor-change-control/SKILL.md, .claude/skills/fashion-monitor-research-frontier/SKILL.md, .claude/skills/resale-platforms-reference/SKILL.md, docs/plans/stack-modernization.md
**Test**: `grep -rn "rebrowser" .claude/skills docs/plans/stack-modernization.md` returns no active/recognized-option hits
**Depends on**: Task 11
**Parallelizable**: no
**Model**: haiku
**Notes**:

## Blocked / open
None — all 12 tasks done. Integration validator (Phase 3.5) found 1 real issue: `capturePosture()` received a `driver` param but never threaded it into `launchStealthEphemeralBrowser()` (would have worked by accident via env-var side-channel during the matrix loop, but not for the explicit-override design the plan called for, and fragile). Fixed directly: `launchStealthEphemeralBrowser(driver)`. Re-verified clean via tsc.

Two subagents (Task 1's pnpm-install claim, Task 11's doc-edit claim) reported false completions this run — both caught by direct file verification after every task, not trusted from the completion message alone.
