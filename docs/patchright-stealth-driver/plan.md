# Plan: Patchright Stealth Driver (narrowed pilot)

## Approach

Give `platforms/playwright/browser.ts` a real driver switch: a `resolveStealthDriver(override?)` helper reads `PLAYWRIGHT_STEALTH_DRIVER` (`patchright` | `legacy`, default/fallback `legacy`, warn-not-throw on anything else — `rebrowser` included), and the existing `launchStealthPersistentContext`/`launchStealthEphemeralBrowser` branch between the current `playwright-extra` + `StealthPlugin` stack and a new `patchright` import's `chromium.launch()`/`launchPersistentContext()`, which is a drop-in API match confirmed against the package's own docs (`npm i patchright`, `import { chromium } from "patchright"`). The `patchright` module itself is loaded via a dynamic `await import("patchright")` gated behind the resolved driver actually being `"patchright"` — never a static top-level import — so a process that only ever runs the `legacy` path never touches patchright's own module-load-time behavior (including whatever its postinstall/binary provisioning does, which Risk Areas already flags as unconfirmed).

Both launch functions gain an *optional* driver-override parameter so `poshmark/scraper.ts` and `depop/playwright-fallback.ts` keep their existing zero-arg call sites (env-var-driven, unchanged behavior) while `verify-scrapers.ts` can request a specific driver explicitly for its matrix. Internally, the module tracks at most one live ephemeral browser at a time (`ephemeralBrowser: Browser | null` plus `ephemeralBrowserDriver: StealthDriver | null` recording which driver launched it) rather than a `Map` keyed by driver — the verify-scrapers matrix loop always closes everything between driver passes sequentially, so no two drivers' ephemeral browsers are ever open concurrently, and a `Map` would only add unused coexistence capability plus a `.set()`-overwrite leak risk. Persistent contexts, by contrast, genuinely can have multiple *profile paths* live at once, so `persistentContexts` stays a `Map` — but it's now keyed by a composite `` `${driver}:${profilePath}` `` string instead of `profilePath` alone, fixing a bug where `launchStealthPersistentContext`'s early-return on a cache hit consulted the map before the driver was part of the key, silently handing a second driver the first driver's cached context for the same profile path.

This keeps the diff to one module plus its direct callers, avoids touching scraper factory signatures, and lets `legacy` and `patchright` be exercised back-to-back in the same process for matrix runs without a rebuild-and-rerun cycle.

## Design decisions

Three choices in this plan are deliberate rather than accidental gaps — recorded here so they aren't mistaken for oversights in review:

**a. Launch-arg parity is intentional, not an omission.** `LAUNCH_ARGS` and `headless: true` are reused identically across both drivers by design, so any pass-rate difference in the matrix is attributable to *which package launched Chromium*, not incidental config drift between the two branches. Risk: if patchright's own documentation ends up recommending different launch options for its stealth properties to actually engage, matching legacy's config regardless would be silently self-defeating. That's a real risk to flag and revisit against patchright's docs during implementation — not something to work around quietly by diverging the configs without noting it.

**b. Production opt-in via env var is accepted, not a gap to close.** An operator setting `PLAYWRIGHT_STEALTH_DRIVER=patchright` in a real production `.env` (not just when running `verify-scrapers`) is a deliberate, accepted consequence of this design — consistent with the pilot's existing "do not remove legacy yet" gate, which assumes the env var is the one and only switch. This feature does not build a separate production-vs-diagnostic allowlist or feature-flag mechanism to prevent that; adding one would be scope expansion beyond this pilot.

**c. The env-var-mutation steering mechanism is single-threaded/sequential-only by construction.** Because scraper factory signatures must stay unchanged, the matrix loop's only way to steer `createDepopScraper`/`createPoshmarkScraper` toward a given driver is mutating `process.env.PLAYWRIGHT_STEALTH_DRIVER` around each iteration. This is safe today only because `verify-scrapers.ts` runs its matrix sequentially. It is a known limitation, not a bug fixed here: if the matrix run is ever scheduled or parallelized (already flagged as future "Next" work in the pilot doc), this mechanism will need to become an explicit parameter instead of an env mutation.

## Architecture

```
                    PLAYWRIGHT_STEALTH_DRIVER (env, or explicit override)
                                     │
                                     ▼
                 platforms/playwright/browser.ts
                 ┌───────────────────────────────────────┐
                 │ resolveStealthDriver(override?)         │
                 │   "legacy" (default/fallback/warn)       │
                 │   "patchright" (only other valid value)   │
                 │        │                    │              │
                 │  playwright-extra      await import("patchright")│
                 │  + StealthPlugin()     (dynamic, gated on driver)│
                 │  (static import)            │                  │
                 │        └────────┬───────────┘                  │
                 │   launchStealthEphemeralBrowser(driver?)          │
                 │   launchStealthPersistentContext(path, driver?)    │
                 │   ephemeralBrowser: Browser | null                   │
                 │   ephemeralBrowserDriver: StealthDriver | null          │
                 │   persistentContexts: Map<"driver:profilePath", Ctx>    │
                 │   close*() / resetStealthStateForTests()                 │
                 └───────────────┬─────────────────────────────────────────┘
        ┌────────────────────────┼─────────────────────────────┐
        ▼                        ▼                               ▼
 poshmark/scraper.ts    depop/playwright-fallback.ts      scripts/verify-scrapers.ts
 (persistent ctx,       (ephemeral browser,               matrix loop over
  no driver arg —       no driver arg —                   ["legacy","patchright"]:
  env decides)          env decides)                      - sets/restores env var
                                                            for scrape checks (depop,
                                                            poshmark — factories
                                                            unchanged)
                                                            - passes explicit driver
                                                            override into its own
                                                            capturePosture() calls
                                                            - labels every report/
                                                            posture row with driver
                                                            (Depop's HTTP-first path
                                                            gets an "n/a" sentinel,
                                                            not the requested driver,
                                                            when no browser launches)
                                                            - eBay/Grailed/Vestiaire
                                                            run once, outside loop
```

The `patchright` package is imported lazily — only once the resolved driver is actually `"patchright"` — so a broken or missing `patchright` install can only ever break the patchright path, never the default `legacy` path used in production today. `playwright-extra` + `StealthPlugin` remains a static import, since it's already a baseline production dependency with no comparable installation risk.

## Data model

No persisted data model changes. (`integration_events` / `v_integration_daily` driver-tagging is explicitly out of scope per the requirements doc — this feature only makes the matrix runnable and truthful on demand.)

The one internal-state shape worth calling out as a data-model-analog fix: `persistentContexts` moves from keying purely on `profilePath` to keying on `` `${driver}:${profilePath}` ``, so two drivers pointed at the same profile path never collide on the same cached context (see Approach and API/interface contract).

## API / interface contract

**Env var** (`.env.example`, read in `browser.ts`):
- `PLAYWRIGHT_STEALTH_DRIVER` — `patchright` | `legacy`, default `legacy`. Any other value (including the now-retired `rebrowser`) warns to console and runs as `legacy`.

**`packages/core/src/platforms/playwright/browser.ts` exports (new/changed):**
- `export type StealthDriver = "patchright" | "legacy"`
- `export function resolveStealthDriver(override?: StealthDriver): StealthDriver` — new. Centralizes env parsing + the warn/fallback rule; `override` lets a caller (verify-scrapers) skip env inspection entirely.
- `launchStealthEphemeralBrowser(driverOverride?: StealthDriver): Promise<Browser>` — signature grows an optional param; existing zero-arg callers (`depop/playwright-fallback.ts`) unaffected. Internally sets `ephemeralBrowser` and `ephemeralBrowserDriver` (single nullable pair, not a map) when it launches.
- `launchStealthPersistentContext(profilePath: string, driverOverride?: StealthDriver): Promise<BrowserContext>` — same external signature; `poshmark/scraper.ts`'s one-arg call site unaffected. Internally, the cache lookup/early-return now checks `persistentContexts.get(\`${driver}:${profilePath}\`)`, resolving the driver *before* consulting the cache, so a second call with the same profile path but a different driver never returns the first driver's context.
- `closeStealthEphemeralBrowser()` — closes `ephemeralBrowser` if non-null, then clears both `ephemeralBrowser` and `ephemeralBrowserDriver`.
- `closeAllStealthBrowsers()`, `closeStealthPersistentContext()` — signatures unchanged, but both continue to close *every* entry they touch indiscriminately (all persistent contexts in the map, regardless of driver or profile) — see Risk Areas for the naming-smell note this cements.
- `resetStealthStateForTests()` — signature unchanged; clears the ephemeral pair and empties the `persistentContexts` map.

**`scripts/verify-scrapers.ts` CLI (`npm run verify:scrapers`)** — no new flags; behavior keyed off the same env var:
- `ScrapeReport.driver` and `PostureCapture.driver` are typed as `StealthDriver` (imported from `browser.ts`), not plain `string`. `ScrapeReport.driver` is widened locally to `StealthDriver | "n/a"` to cover Depop's HTTP-first (impit) path, which never invokes a browser at all — see Integration points.
- `DRIVER_MATRIX = ["legacy", "patchright"] as const satisfies readonly StealthDriver[]` — tied to the `StealthDriver` type so the matrix array can't silently drift from the type it's supposed to enumerate.
- Console output: one row per platform per driver for Depop/Poshmark (`driver=legacy`/`driver=patchright`/`driver=n/a` in the bracketed suffix, same format already used for posture); eBay/Grailed/Vestiaire print exactly once, unlabeled by driver, as today.
- Exit code contract unchanged: only real scrape failures fail the run; driver-matrix/posture capture stays diagnostic-only, per existing contract and the NFR that forbids widening it.

Error cases: unrecognized `PLAYWRIGHT_STEALTH_DRIVER` value → warn + run `legacy`, never throws. Patchright launch failure (e.g., missing browser binary) surfaces the same way legacy launch failures do today — as a `ScrapeReport`/`PostureCapture` `error` field, not a hard crash of the whole matrix (one driver's failure must not abort the other driver's pass).

## Integration points

- **Build step, ordered before any `verify-scrapers` run.** `scripts/verify-scrapers.ts` imports everything from `../packages/core/dist/...`, not `src/`, and `packages/core/dist/` does not currently exist in this worktree. A build (`pnpm --filter @fm/core build`, or the equivalent turbo command) MUST run between making the `src/`-level changes to `browser.ts` and any attempt to run `scripts/verify-scrapers.ts` — otherwise the matrix runs against stale or absent compiled output while unit tests (which mock modules and run directly against `src/`) give false confidence that everything works.
- `packages/core/src/platforms/playwright/browser.ts` — add a dynamic `await import("patchright")` gated behind the resolved driver (not a static import), `StealthDriver` type, `resolveStealthDriver()`, branch the two launch functions on the resolved driver, replace `ephemeralBrowser: Browser | null` tracking with the same nullable field plus a paired `ephemeralBrowserDriver: StealthDriver | null`, and re-key `persistentContexts` from `Map<profilePath, BrowserContext>` to `Map<"driver:profilePath", BrowserContext>`. Update `close*`/`resetStealthStateForTests()` accordingly. This is the only file where the actual driver swap happens (FR1, FR2, FR6, FR7, FR8).
- `packages/core/package.json` — add `patchright` to `dependencies`, with its exact version locked in the lockfile (the real npm package name is `patchright`, not `patchright-nodejs` — confirmed via `npm view patchright` and the package's own README; `patchright-nodejs` 404s on the registry). Keep `playwright-extra` and `puppeteer-extra-plugin-stealth` untouched (FR12, AC6). Do not bump the pinned `playwright` `^1.52.0`.
- `scripts/verify-scrapers.ts` — replace `resolveDriver()` (currently hardcoded to always return `"legacy"` with a warning) with a call into `browser.ts`'s `resolveStealthDriver()`; add a `DRIVER_MATRIX` loop (see API/interface contract for its exact typing) that, for Depop and Poshmark only: (a) temporarily sets `process.env.PLAYWRIGHT_STEALTH_DRIVER` to the loop driver before calling the existing scraper factories (`createDepopScraper`, `createPoshmarkScraper`) so those factories' unchanged, zero-arg calls into `browser.ts` pick up the right driver; (b) calls `capturePosture(platform, url, driver)` with an *explicit* driver override (no env mutation needed there, since verify-scrapers imports `launchStealthEphemeralBrowser` directly); (c) uses a per-driver Poshmark profile temp dir (`mkdtempSync` inside the loop, not once before it) so the two drivers never contend for the same Chromium user-data-dir lock, and removes that temp dir (`rmSync(path, { recursive: true, force: true })`) in a `finally` block after that driver's pass completes, so repeated matrix invocations don't accumulate orphaned profile directories; (d) closes everything (`closePoshmarkContext()`, `closeStealthEphemeralBrowser()`) between driver passes; (e) restores the original env var value in a `finally` after the loop. When Depop's impit-first HTTP path succeeds without invoking any Playwright/patchright browser at all, its matrix row records `driver: "n/a"` (not the configured/requested driver) — attributing a browser-driver label to a request that never launched a browser would reproduce the exact "mislabeled fallback" bug this pilot exists to fix. eBay/Grailed/Vestiaire keep their existing single run, outside the loop (FR9, FR10, FR11, AC3, AC4, AC5).
- `packages/core/tests/platforms/playwright-browser.test.ts` — extend with new `describe`/`it` blocks (do not touch the two existing tests, which are also AC2's regression check): mock the `patchright` module the same way `playwright-extra` is already mocked; assert `PLAYWRIGHT_STEALTH_DRIVER=patchright` (or an explicit override) calls patchright's `chromium.launch`/`launchPersistentContext` and *not* `playwright-extra`'s; assert an unrecognized value (e.g. `rebrowser`) warns via `console.warn` and still calls the legacy mocks; assert `resetStealthStateForTests()` clears state between a patchright-driver case and a legacy-driver case in the same file; assert that calling `launchStealthPersistentContext` with the same profile path but two different drivers produces two distinct contexts, not a cache hit (AC1, AC3, AC10).
- `.env.example` — add a `PLAYWRIGHT_STEALTH_DRIVER` entry near the other scraper-related vars, one-line comment above it in the file's existing convention, documenting `patchright|legacy` and the `legacy` default (FR13, AC7).
- `docs/playwright-stealth-pilot.md` — rewrite: drop `rebrowser-patches` from the "Mitigations" list entirely (Camoufox stays mentioned only as an already-out-of-scope alternative, unchanged); add the benchmark citation (https://ianlpaterson.com/blog/anti-detect-browser-benchmark-patchright-nodriver-curl-cffi/, published 2026-05-13, updated 2026-07-12; 651 verdicts, 31 Cloudflare-protected targets, Patchright 25/29 OK vs. rebrowser-patches/vanilla tied at 24/29 OK), phrased as motivating evidence rather than a Depop/Poshmark-specific proof (see Technology choices); change "Recommended pilot (not yet wired)" to describe the swap as wired, pointing at `resolveStealthDriver()` in `browser.ts` and the matrix loop in `verify-scrapers.ts`; retarget the "Do not remove yet" gate to name Patchright specifically while keeping it a hard requirement (`playwright-extra` + stealth-plugin stays until Patchright passes live smoke on Depop and Poshmark) (FR14, FR15, AC8, AC9).

## Technology choices

- `patchright` (npm package name, backed by `patchright-core`, currently 1.61.1) — the only new dependency, version pinned in the lockfile. Chosen because it's the requirements doc's mandated Node/TypeScript package and is a structural drop-in for `playwright`'s `chromium.launch()`/`launchPersistentContext()` API. The general-Cloudflare-target benchmark (https://ianlpaterson.com/blog/anti-detect-browser-benchmark-patchright-nodriver-curl-cffi/, published 2026-05-13, updated 2026-07-12; Patchright ahead 25/29 vs. rebrowser-patches/vanilla tied at 24/29 across 31 Cloudflare-protected targets) *motivates* the choice — it does not prove a Depop/Poshmark-specific efficacy delta, which Risk Areas already flags as unproven. This feature's job is to make that specific experiment runnable and truthfully labeled, not to declare it settled ahead of time.
- No new test, build, or CLI framework — the matrix loop is a plain array iteration over `["legacy", "patchright"]`, reusing the existing `vitest` mocking pattern and the script's existing report/console-output shapes.

## Risk areas

- **Type compatibility across the two Playwright forks.** `browser.ts` types its returns as `playwright`'s `Browser`/`BrowserContext`, but `patchright`'s `chromium.launch()` returns *its own* `Browser`/`BrowserContext` classes (same shape, different package). Implementation must run an actual `tsc --noEmit` pass/fail check once the dependency is installed — not just an informal "verify compilation succeeds." If a cast (`as unknown as Browser`) is genuinely needed, it must be paired with a narrow runtime shape assertion at the cast site (e.g., confirm `newPage`/`close` exist on the returned object) so a future patchright upgrade that changes shape fails loudly at runtime instead of silently misbehaving.
- **Browser binary provisioning.** The Dockerfile runs `pnpm exec playwright install --with-deps chromium`; it's unconfirmed whether `patchright` reuses that same Chromium revision/cache path or needs its own `patchright install chromium`-equivalent. Because the `patchright` module is only ever dynamically imported behind the resolved driver, this risk is confined to the patchright path — a missing binary can only ever break `patchright`-driver runs, never the default `legacy` path Docker/CI/production actually run today. Out of scope for this feature's acceptance criteria (which are code/test/doc-level), but worth a one-line note in the doc update, not a blocker for local `verify:scrapers`.
- **Shared user-data-dir across driver passes.** Poshmark's persistent-context profile path must not be reused unclosed between the `legacy` and `patchright` passes in the matrix loop (Chromium's `SingletonLock`). Mitigated in this plan by minting a fresh temp profile dir per driver inside the loop rather than once before it, and removing it in a `finally` block once that driver's pass completes (see Integration points) — cheap, but worth a specific test/manual-run check since it's new code, not carried over from today's single-driver script.
- **Env-var mutation as the driver-selection channel for scrape checks.** Because scraper factory signatures must stay untouched, the matrix loop's only way to steer `createDepopScraper`/`createPoshmarkScraper` is to mutate `process.env.PLAYWRIGHT_STEALTH_DRIVER` around each iteration. This works but is a process-global side effect inside a single script run — must be restored in a `finally` and must not race with anything else reading the env var concurrently. As recorded in Design decisions (c), this is accepted as single-threaded/sequential-only by construction for this pilot, not fixed here; it becomes a real blocker only if/when the matrix run is scheduled or parallelized.
- **Naming smell on close functions.** `closePoshmarkContext()` and `closeAllStealthBrowsers()` close EVERY driver's resources, not anything Poshmark- or driver-scoped, despite the name — this plan cements that further rather than introducing it. Renaming these widely-used functions is a separate, broader refactor and is explicitly out of scope here.
- **Patchright's real anti-detection delta on Depop/Poshmark specifically is unproven here.** The benchmark cited in Technology choices is a general 31-target sweep, not a Depop/Poshmark-specific result — the "do not remove legacy yet" gate exists precisely because this plan does not itself prove live smoke passes; it only makes that experiment runnable and truthfully labeled.
- **Supply-chain hygiene.** `patchright` is a new dependency that drives browser automation; its exact version is locked in the lockfile as standard supply-chain hygiene. No further dependency-risk action is warranted for this personal-scale pilot.
