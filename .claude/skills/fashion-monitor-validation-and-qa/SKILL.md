---
name: fashion-monitor-validation-and-qa
description: Test taxonomy, evidence standards, acceptance thresholds, golden fixtures, and how to add tests in the fashion-monitor repo. Load when validating a change (what proof is required before it counts as done), when adding or locating tests, when running coverage/mutation/e2e/live suites, or when doing the manual smoke checklist. Do NOT load for diagnosing a failure you already have (fashion-monitor-debugging-playbook), for measuring runtime behavior via logs/DB views (fashion-monitor-diagnostics-and-tooling), or for designing experiments and analysis (fashion-monitor-research-methodology).
---

# Fashion Monitor — Validation and QA

How to prove a change works in this repo: which test layer to run, what evidence each change type requires, what thresholds are actually configured, and how to add tests. All facts verified against the repo as of 2026-07-02 unless marked unverified. Vocabulary (Monitor, Taste, Score, Feedback, Pipeline) is defined in `CONTEXT.md` — use it.

Package manager is **pnpm** (`packageManager: pnpm@9.15.0`, Node >= 24). Any doc or workflow saying `npm ci` / `npm run` is stale — see "Known-broken QA infrastructure" below.

## Test taxonomy

| Layer | Command (repo root) | Network? | Creds? | When required |
|---|---|---|---|---|
| Unit + integration | `pnpm test` (turbo, all packages; `test` dependsOn `build`) | No — providers/scrapers mocked | No | Every change, before any commit |
| Coverage | `pnpm run test:coverage` (runs `@fm/core` only) | No | No | Pipeline/scoring/storage changes; CI intent |
| E2E DOM fixture | `pnpm run test:e2e` (Playwright, `tests/e2e/`) | No — fixture HTML via `page.setContent` | No | Scraper extract/normalize changes (Poshmark especially) |
| Live scraper verify | `pnpm run verify:scrapers` | **Yes — real platform requests** | Per-platform (table below) | Scraper changes, after deploy, per `docs/SMOKE.md` |
| Live vitest smoke | `pnpm run test:live` (`VITEST_LIVE=1 vitest run tests/platforms/live-smoke.test.ts -t @live`) | **Yes** | Same table | Alternative to verify:scrapers with assertions |
| Mutation | `pnpm run test:mutation` (Stryker in `@fm/core`) | No | No | Pipeline-module or listing-snapshot changes; slow, optional |

Rate-limit discipline (assumed — confirm with owner, brief A2): minimize live scrapes during development; prefer fixtures. Never loop `verify:scrapers`. One run per validation session is the norm.

Test file inventory (counted 2026-07-02): 47 total — `packages/core/tests/` 38, `packages/api/tests/` 7, `apps/web/src/` 1 counted (`lib/api.test.ts`; `components/ui/button.test.tsx` also exists but `.tsx` files fall outside this count's find pattern), root `tests/e2e/` 1 (`poshmark-fixture.spec.ts`). Notable core suites: `tests/integration/full-flow.test.ts` (end-to-end pipeline with MockProvider), `tests/integration/scrape-isolation.test.ts`, `tests/pipeline/orchestrator.test.ts`, `tests/platforms/fixture-smoke.test.ts` (all five normalizers against golden fixtures), `tests/storage/listing-snapshot.test.ts`, `tests/lib/redact-secrets.test.ts`. Notable api suites: `tests/web/rbac.test.ts`, `tests/web/auth.test.ts`, `tests/web/audit-security.test.ts`.

### Live credentials (source of truth: `packages/core/tests/helpers/live-env.ts`)

| Platform | Required env | Notes |
|---|---|---|
| eBay | `EBAY_CLIENT_ID`, `EBAY_CLIENT_SECRET` | Official OAuth app (sanctioned API) |
| Grailed | `GRAILED_APP_ID`, `GRAILED_API_KEY` | Public Algolia keys |
| Depop | none | impit HTTP first, Playwright intercept fallback |
| Vestiaire | `SCRAPFLY_API_KEY` | Cloudflare blocks bare fetch |
| Poshmark | none | Playwright stealth + persistent profile |

`verify:scrapers` (`scripts/verify-scrapers.ts`) loads `.env`, prints per-platform READY/SKIP, **skips** platforms missing creds (skip is not failure), and **fails** on scrape error or zero listings; exits non-zero on any hard failure. It uses a throwaway temp Poshmark profile, so a logged-out Poshmark run may legitimately return fewer/zero tiles.

## Evidence standards per change type

What counts as evidence: a command you ran with its observed output, a test that fails before / passes after, or a measured number against a prediction. "It looks right" and "typecheck passes" are not evidence on their own. Gating rules for *whether* a change is allowed live in fashion-monitor-change-control — this section is the proof bar once it is allowed.

| Change type | Minimum evidence before done |
|---|---|
| Scraper (extract/normalize/anti-bot) | `pnpm test` green incl. `tests/platforms/*` fixture tests; `pnpm run test:e2e` if Poshmark DOM extraction touched; ONE `pnpm run verify:scrapers` run showing the platform `ok` with listing count |
| Pipeline / scoring (dedupe, prefilter, category, scorer, orchestrator) | Unit + integration tests green; new behavior covered by a test that fails on old code; predicted-then-measured funnel numbers (scraped → prefiltered → scored → alertable) per fashion-monitor-research-methodology; `test:coverage` still above thresholds; run `test:mutation` if a mutated module changed |
| Schema (new migration in `packages/core/src/storage/migrations/`, currently 001–014) | Migration file applies cleanly on a fresh DB (repo tests create fresh DBs via `tests/helpers/db.ts`); `packages/core/tests/storage/*` green; a test exercising the new column/table/view |
| Alerts | Mock-provider integration run green (`tests/integration/digest-mode.test.ts`, `tests/alerts/*`); the alert items of the `docs/SMOKE.md` checklist (pnpm-corrected, below). Note: alert channel is mid-migration Telegram→ntfy — see "Known-broken" below and fashion-monitor-failure-archaeology |
| Dormant-feature enable (e.g. login-based Connections) | Its ADR gate satisfied first: ADR `docs/adr/0004` requires ToS research + **measured** anonymous-vs-logged-in lift before enabling login scraping. No test suite substitutes for the gate |
| Config axis added | See fashion-monitor-config-and-flags; plus `tests/core/config.test.ts` / `profile-config.test.ts` updated and `config.example.yaml` updated |

## Acceptance thresholds that actually exist

State only what is configured or written down — do not invent bars.

- **Alert precision target: >60% of alerts genuinely interesting** — `spec/01-overview.md` line 37. Product-level; measured from Feedback, not from unit tests (see fashion-monitor-research-methodology for the measurement recipe).
- **Coverage thresholds (enforced, `packages/core/vitest.config.ts`):** lines 55, functions 55, branches 45, statements 55. `test:coverage` fails below these. v8 provider; reporters `text`, `json-summary`, `html`. Only `@fm/core` has coverage configured — no thresholds exist in api/web/cli/shared configs.
- **Mutation testing (no numeric threshold configured):** `packages/core/stryker.conf.json` mutates exactly `src/pipeline/dedupe.ts`, `prefilter.ts`, `category.ts`, `scorer.ts`, and `src/storage/listing-snapshot.ts`; vitest runner, `coverageAnalysis: perTest`, 120s timeout. Reporters are `clear-text` + `progress` only — output is **terminal text, no HTML report file**. Discipline per `docs/SMOKE.md`: review surviving mutants in those modules and either kill each with a test or note why it is equivalent/acceptable. Do not add a `thresholds` block without change-control sign-off.
- **Playwright e2e:** `retries: 0`, `workers: 1` (`playwright.config.ts`) — a flake is a failure; do not add retries to paper over one.

## Golden / certified inventory

Treat these as certified artifacts: changing them changes what "passing" means, so a fixture edit needs a reason (platform DOM/API actually changed) stated in the commit.

- **DOM/API fixtures** (`packages/core/tests/fixtures/`, 6 files):
  - `ebay/search-response.json`, `grailed/algolia-response.json`, `depop/search-response.json` — API-shaped JSON, consumed by `tests/platforms/fixture-smoke.test.ts` and per-platform tests.
  - `vestiaire/search-page.html` — parsed by `extractVestiaireProductsFromHtml`.
  - `poshmark/search-page.html`, `poshmark/search-tile.html` — the search-page fixture is the golden input for `tests/e2e/poshmark-fixture.spec.ts`, which loads it into a real Chromium page and asserts exact tiles (2 listings, known ids/brands/prices).
- **Mock LLM provider:** `packages/core/src/llm/mock.ts` (`MockProvider`, injectable batch/image handlers, `healthy` flag) plus canned results in `packages/core/tests/helpers/mock-provider.ts` (`yesScore`, `maybeScore`, ...). All pipeline/alert tests score through this — no test may call a real LLM.
- **Config example:** `config.example.yaml` is the canonical config shape (it contains the owner's personal defaults — do not copy its values into docs or tests as facts).
- **Shared test helpers:** `packages/core/tests/helpers/` (`db.ts` fresh-DB setup, `fixtures.ts` `sampleListing`/`minimalConfig`, `live-env.ts`, `scrapers.ts`) and `packages/api/tests/helpers/` (`fixtures.ts`, `web.ts`). Reuse these; do not hand-roll DB setup.

## How to add a test

ESM trap first: source and tests use NodeNext ESM — **relative imports must end in `.js` even from `.ts` files** (e.g. `import { x } from "../../src/pipeline/scorer.js"`). Omitting the suffix fails resolution.

| Package | Put test at | Naming | Config | Notes |
|---|---|---|---|---|
| `@fm/core` | `packages/core/tests/<area>/` (area = pipeline, platforms, storage, alerts, integration, lib, llm, core, images, analytics) | `*.test.ts` | `packages/core/vitest.config.ts` — includes `tests/**/*.test.ts`, excludes `tests/e2e/**` and `live-smoke.test.ts` (unless `VITEST_LIVE=1`) | `globals: false` — import `describe/it/expect` from `vitest`. 30s timeout. Use helpers/db.ts + MockProvider |
| `@fm/api` | `packages/api/tests/web/` or `tests/dashboard/` | `*.test.ts` | `packages/api/vitest.config.ts` (`tests/**/*.test.ts`, node env, 30s) | Fastify instance via `tests/helpers/web.ts` |
| `@fm/web` | next to source under `apps/web/src/` | `*.test.ts(x)` or `*.spec.ts(x)` | `apps/web/vitest.config.ts` — jsdom, `globals: true`, setup `src/test/setup.ts`, alias `@` → `src` | Only colocated tests are picked up (`src/**`) |
| `@fm/cli`, `@fm/shared` | no tests today | — | `vitest.config.ts` with `passWithNoTests: true` | First test added removes the "no tests" free pass for real |
| e2e | `tests/e2e/` at repo root | `*.spec.ts` | `playwright.config.ts` (`testDir: tests/e2e`) | Load golden HTML with `page.setContent`, never a live URL |
| live | extend `packages/core/tests/platforms/live-smoke.test.ts` | keep `@live` in describe/it name | gated by `VITEST_LIVE=1` + `-t @live` | Use `PLATFORM_LIVE_REQUIREMENTS` + `it.skipIf` so missing creds skip, not fail |

Run one package's tests directly: `pnpm --filter @fm/core test` (or `pnpm --filter @fm/core exec vitest run tests/pipeline/scorer.test.ts` for a single file — note root `pnpm test` goes through turbo and builds first).

## Manual smoke — `docs/SMOKE.md`, pnpm-corrected

`docs/SMOKE.md` is the checklist of record but is **stale as written**: every command says `npm`, and its prerequisites/alert steps still say Telegram (the alert channel is mid-migration to ntfy in the uncommitted working tree). Corrected commands:

```bash
pnpm install                 # doc says: npm ci (cannot work — npm lockfiles are gitignored)
pnpm run typecheck
pnpm test
pnpm run test:coverage
pnpm run test:e2e
# live (needs .env creds per table above; Chromium via playwright)
pnpm --filter @fm/core exec playwright install chromium
pnpm run verify:scrapers     # or: pnpm run test:live
# single pipeline run
pnpm run dev:run -- --config config.yaml
# mutation (slow, optional)
pnpm run test:mutation
```

Checklist items to keep from SMOKE.md (still valid): pipeline run logs `platform.scrape.success`; `listingsFound > 0` on healthy platforms; scores land YES/MAYBE/NO not stuck PENDING; `runs` + `seen_listings` updated; LLM-unavailable path marks PENDING with no alerts, then backlog scores on recovery. Items to treat as stale pending migration: "Telegram receives alert(s)" and the whole "Feedback bot" section (see below).

## Known-broken QA infrastructure (as of 2026-07-02 — do not trust green/red from these)

- **CI workflows cannot pass as written.** `.github/workflows/ci.yml` and `live-smoke.yml` use `actions/setup-node` with `node-version: "20"`, `cache: npm`, and `npm ci` — but the repo requires Node >= 24, is a pnpm workspace, and gitignores `**/package-lock.json`, so `npm ci` has nothing to resolve. Documented weak point; fixing it is a change-control item, not a drive-by.
- **`packages/core/tests/alerts/telegram.test.ts` is orphaned** in the working tree: it imports `../../src/alerts/telegram.js`, which is deleted (Telegram→ntfy migration in flight; `src/alerts/ntfy.ts` is untracked and has **no test file**). Expect `pnpm test` in `@fm/core` to fail on that suite until the migration lands (unverified — suite deliberately not run for this doc). Resolution belongs to fashion-monitor-alerting-feedback-campaign, not to whoever trips over it.
- **`docs/SMOKE.md` Feedback-bot section is dead:** `apps/cli/src/feedback-bot.ts` is a stub; there is no feedback-ingestion path right now.
- **Stale `coverage/` at repo root:** gitignored generated HTML report dated 2026-06-07 (summary then: ~68% lines). Do not cite it as current; regenerate with `pnpm run test:coverage`. (Where a fresh run writes its report — `packages/core/coverage/` vs root — is unverified; no `reportsDirectory` is configured.)

## When NOT to use this skill

- A test or the pipeline is failing and you need triage → **fashion-monitor-debugging-playbook**.
- You need to measure runtime behavior (log events, scorecard views, shipped scripts) rather than run tests → **fashion-monitor-diagnostics-and-tooling**.
- You are designing an experiment, predicting funnel numbers, or judging an idea's evidence bar → **fashion-monitor-research-methodology**.
- You are deciding whether a change is *allowed* at all → **fashion-monitor-change-control**.

## Provenance and maintenance

Re-verify before trusting; one-liners from repo root:

- Root test scripts: `grep -A2 '"test' package.json`
- Coverage thresholds: `grep -A6 thresholds packages/core/vitest.config.ts`
- Live-suite exclusion logic: `grep -B1 -A3 VITEST_LIVE packages/core/vitest.config.ts`
- Stryker mutate list / reporters: `cat packages/core/stryker.conf.json`
- Test file count: `find . -path ./node_modules -prune -o \( -name '*.test.ts' -o -name '*.spec.ts' \) -print | grep -v node_modules | wc -l`
- Fixture inventory: `find packages/core/tests/fixtures -type f`
- Live cred requirements: `grep -A5 'platform:' packages/core/tests/helpers/live-env.ts`
- CI still npm-broken?: `grep -n 'npm ci\|cache: npm\|node-version' .github/workflows/*.yml`
- SMOKE.md still stale?: `grep -c 'npm ' docs/SMOKE.md`
- Telegram test still orphaned?: `git status --short packages/core/src/alerts/ && ls packages/core/tests/alerts/`
- Precision target: `grep -n '60%' spec/01-overview.md`
- Migration count: `ls packages/core/src/storage/migrations/ | wc -l`
