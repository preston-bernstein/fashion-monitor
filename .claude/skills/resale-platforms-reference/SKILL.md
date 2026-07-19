---
name: resale-platforms-reference
description: Domain reference for how fashion-monitor accesses each resale platform (eBay, Grailed, Vestiaire, Depop, Poshmark, Vinted) — access methods, required env vars, failure signatures, ToS tiers, anti-bot theory (Cloudflare, Datadome, TLS fingerprinting, CDP leak, stealth Playwright, impit, ScrapFly), Listing normalization quirks, and dedupe keys. Load when working on anything under packages/core/src/platforms/, debugging a specific scraper's blocked/empty results, adding or changing a platform, or reasoning about anti-bot strategy. Do NOT load for generic pipeline triage (fashion-monitor-debugging-playbook), LLM scoring (llm-scoring-reference), or test/fixture mechanics (fashion-monitor-validation-and-qa).
---

# Resale Platforms Reference

Domain pack: how this repo talks to each resale platform, why each platform is accessed the way it is, and what breaks. All paths relative to the repo root. Facts verified against code as of 2026-07-02.

Vocabulary (per `CONTEXT.md`): a **Monitor** is a saved search concept (DB table `search_groups`); a **Connection** is a per-profile, per-platform link layering test/status/risk-acknowledgment on top of Secrets (`docs/adr/0004`); a **Listing** is the normalized item record every scraper emits (`packages/core/src/core/types.ts`).

## Platform matrix

Scrapers are registered in `packages/core/src/platforms/registry.ts` (`FACTORIES` map, one factory per `Platform`). Enabled/disabled per platform via `config.yaml` `platforms:` booleans (see `config.example.yaml` lines ~97–103). `PLATFORMS` includes all six; `IMPLEMENTED_PLATFORMS` excludes vinted (`packages/shared/src/platforms.ts`).

| Platform | Access method | Entry file (`packages/core/src/platforms/`) | Required env vars | ToS tier (ADR-0004) | Test fixture |
|---|---|---|---|---|---|
| ebay | Official Browse API, OAuth2 client-credentials (app token, ~2h, auto-refresh with 60s skew) | `ebay/scraper.ts` | `EBAY_CLIENT_ID`, `EBAY_CLIENT_SECRET` | Sanctioned (API-key Connection) | `packages/core/tests/fixtures/ebay/search-response.json` |
| grailed | Public Algolia search keys (embedded in grailed.com page source, reverse-engineered), POST to `https://{APP_ID}-dsn.algolia.net/1/indexes/Post_production/query` | `grailed/scraper.ts`, `grailed/algolia.ts` | `GRAILED_APP_ID`, `GRAILED_API_KEY` | Public / "none" tier (no account; shown as "automatic") | `packages/core/tests/fixtures/grailed/algolia-response.json` |
| vestiaire | Plain HTTPS fetch of search page → parse `<script id="__NEXT_DATA__">` JSON; on 403/429 fall back to ScrapFly (paid anti-bot proxy) | `vestiaire/scraper.ts`, `vestiaire/fetch-page.ts`, `vestiaire/parse-html.ts` | `SCRAPFLY_API_KEY` (required in practice — Cloudflare blocks direct fetch, per `packages/core/tests/helpers/live-env.ts`) | Public scrape (anonymous); login Connection dormant | `packages/core/tests/fixtures/vestiaire/search-page.html` |
| depop | impit HTTP-first (TLS-impersonating client, `browser: "firefox"`) fetching `www.depop.com/search/` and parsing the Next.js RSC flight payload; Playwright stealth fallback re-renders the same page | `depop/scraper.ts`, `depop/parse-rsc.ts`, `depop/playwright-fallback.ts` | none | Public scrape (anonymous); login Connection dormant | `packages/core/tests/fixtures/depop/search-response.json` |
| poshmark | Playwright stealth Chromium with **persistent profile** (cookies survive runs), DOM tile extraction | `poshmark/scraper.ts`, `poshmark/extract.ts`, `playwright/browser.ts` | none (needs Chromium installed + `scraper.poshmark_profile_path` in config, default `data/poshmark-profile`) | Public scrape (anonymous); login Connection dormant | `packages/core/tests/fixtures/poshmark/search-page.html` (used by `tests/e2e/poshmark-fixture.spec.ts`) |
| vinted | **Deferred** — registry stub returns `{ ok: false, error: "Vinted disabled in v1" }`; no scraper dir exists | inline stub in `registry.ts` | n/a | Deferred (Datadome maintenance cost; EU-skewed inventory — `spec/platforms/vinted.md`) | none |

ToS tiers, spelled out (ADR-0004, `docs/adr/0004-tiered-connections-login-dormant.md`): **API-key** (eBay — sanctioned), **none** (Grailed — public search, nothing to connect), **login** (Poshmark/Depop/Vestiaire — scraping *as the user* violates those platforms' ToS with unappealable ban risk). Login Connections ship **dormant**: off by default, gated on (1) per-platform ToS research producing honest risk copy and (2) a measured anonymous-vs-logged-in result lift. Today all scraping is anonymous. Do not wire logged-in scraping without going through change control (see fashion-monitor-change-control).

## Per-platform behavior and failure signatures

All scrapers funnel through `scrapeQueries()` in `packages/core/src/platforms/scrape-utils.ts`: per-query try/catch, listings tagged with `sourceQueryId`, optional `betweenQueriesMs` delay, outcome `ok: false` only if **every** query failed and zero listings came back. Log events live in `packages/core/src/lib/log-events.ts` (`platform.query.failed`, `platform.scrape.failed`, plus per-platform events below).

### eBay (`ebay/scraper.ts`)
- Search: `GET /buy/browse/v1/item_summary/search` with `category_ids: "57988"` (Men's Clothing), `filter: itemLocationCountry:US,conditions:{USED|NEW}`, `sort: newlyListed`, `limit: 50`, header `X-EBAY-C-MARKETPLACE-ID: EBAY_US`.
- Failure signatures: `"EBAY_CLIENT_ID and EBAY_CLIENT_SECRET required"`; `"eBay OAuth failed: <status>"` + log event `platform.ebay.oauth.failed`.
- Rate limits: 5,000 calls/day free tier — never approached; no inter-query delay used.

### Grailed (`grailed/scraper.ts`)
- Algolia query hardcodes facets: `category_path:tops|outerwear`, sizes `L/XL/XXL/2XL/One Size`, `price_i <= 300`, 40 hits/page, 500ms between queries.
- Credentials validated once per scraper instance at first `search()` (`grailed/credentials.ts` fires a 1-hit probe); success logs `platform.grailed.credentials.valid`.
- Failure signatures: `"GRAILED_APP_ID and GRAILED_API_KEY required"`; `"Grailed Algolia failed: <status>"`; probe wraps it as `"Grailed Algolia credentials invalid: HTTP <n>"`. Keys are public read-only but **rotate** — if search 4xxs, re-extract from grailed.com page source (procedure in `spec/platforms/grailed.md`). Empty results with HTTP 200 can also mean the `Post_production` index name changed.

### Vestiaire (`vestiaire/scraper.ts`, `vestiaire/fetch-page.ts`)
- URL: `/search/?q=…&universe=M&size=XL&size=XXL&priceMax=300&order=publishedDate`. 2500ms between queries.
- HTTP 308 → `VestiaireRedirectError` = item sold/removed; scraper swallows it and returns `[]` (not a failure).
- 403/429 → logs `platform.vestiaire.fetch.blocked` and retries through ScrapFly (`fetchViaScrapfly`, `asp: true, render_js: false`). Missing key throws `"SCRAPFLY_API_KEY required for Cloudflare bypass"`. Other statuses: `"Vestiaire HTTP <n>"`.
- Parse failure: `"Vestiaire __NEXT_DATA__ not found"` (`parse-html.ts`) — site structure changed, or Cloudflare served a challenge page instead of HTML. JSON path is `props.pageProps.initialData.items`; this path is fragile by design (`spec/platforms/vestiaire.md`).

### Depop (`depop/scraper.ts`)
- The legacy `webapi.depop.com/api/v1/search/products/` endpoint is retired (404). Current path: fetch `https://www.depop.com/search/?q=…&gender=male&sort=newest&sizes=US-L,US-XL,US-XXL,US-2XL` via impit, parse the RSC flight payload (`self.__next_f.push` chunks) in `parse-rsc.ts`. Up to 3 HTTP attempts with 1.5–2.5s backoff; success logs `platform.depop.rsc.success`.
- Fallback: on HTTP exhaustion, logs `platform.depop.http.failed` then `scrapeDepopViaPlaywright()` — stealth **ephemeral** Chromium loads the same URL, clicks the OneTrust cookie consent if present, then polls `page.content()` up to 15×2s re-running the same RSC parser. **Note a spec-vs-code drift:** `spec/platforms/depop.md` still shows a Playwright *network-interception* fallback code block; the actual code does NOT intercept requests — it re-parses rendered HTML. Trust the code.
- Failure signatures: `"Depop search HTTP <status>"`, `"Depop search HTML missing embedded product payload"` (RSC marker `"data":{"meta":{"result_count":` absent), `"Depop Playwright fallback returned no listings"`.

### Poshmark (`poshmark/scraper.ts`)
- Persistent stealth context at `config.scraper.poshmark_profile_path` (default `data/poshmark-profile`; on the NAS deploy this is a mounted volume so cookies survive container restarts). URL: `/search?query=…&department=Men&sort_by=added_desc&size[]=XL&size[]=XXL&size[]=2XL`.
- Waits for selector `a[data-et-prop-location="listing_tile"]` (30s timeout) + 2s settle, then runs `poshmarkTileExtractScript` (`extract.ts` — a self-contained string evaluated in the page; it must stay import-free). **Spec drift:** `spec/platforms/poshmark.md` shows the older `[data-et-name='listing_tile']` selector; the code selector above is current. DOM selector drift is the #1 maintenance burden on this platform.
- Failure signature: Playwright `waitForSelector` timeout → caught, logged as `platform.scrape.failed`, whole platform returns `ok: false` (Poshmark is the only scraper with a platform-level catch outside `scrapeQueries`).
- Cleanup: always `closePoshmarkContext()` / `closeAllStealthBrowsers()` after ad-hoc runs, or Chromium processes leak.

### Vinted
- Deferred (spec status "enable in v2"). `spec/platforms/vinted.md` sketches a Python `vinted-scraper` approach — that is design-note material only; nothing is implemented in this TypeScript repo. Enabling means writing a real scraper and flipping `platforms.vinted` — an architecture change, not a config flip.

## Anti-bot theory (as it applies here)

Definitions, once:

- **Cloudflare** — CDN/anti-bot layer fronting Vestiaire. Blocks by TLS fingerprint, IP reputation, and JS challenges. Manifests as 403/429 or challenge HTML where `__NEXT_DATA__` should be.
- **Datadome** — a more aggressive commercial anti-bot, used by Vinted. Its maintenance cost is the stated reason Vinted is deferred.
- **TLS fingerprinting (JA3/JA4)** — servers identify clients by their TLS handshake (cipher order, extensions). Node's default `fetch` has a non-browser fingerprint that anti-bot layers flag regardless of headers. **impit** (npm dep `impit` ^0.5.0 in `packages/core/package.json`) counters this by impersonating a real browser TLS stack — Depop uses `new Impit({ browser: "firefox" })`. It replaces Python's `cloudscraper` role; `got-scraping` is deprecated.
- **CDP `Runtime.enable` leak** — stock Playwright/Puppeteer drive Chromium over the Chrome DevTools Protocol and call `Runtime.enable`, which modern anti-bot JS can detect from inside the page. This is why an unmodified headless Playwright gets caught even with good headers.
- **playwright-extra + puppeteer-extra-plugin-stealth** — the current mitigation (`platforms/playwright/browser.ts`, `getStealthChromium()`). Patches many headless tells but NOT the Runtime.enable leak.
- **Patchright / Camoufox** — candidate replacements that patch the CDP leak (Camoufox is an anti-detect Firefox). Status per `docs/playwright-stealth-pilot.md`: **wired** as of 2026-07-18 — `PLAYWRIGHT_STEALTH_DRIVER=patchright|legacy` is a real env var read by `resolveStealthDriver()`, and both stealth-launch functions in `browser.ts` branch on it (`rebrowser-patches`, previously a candidate alongside Patchright, was dropped after a benchmark showed it now ties unpatched vanilla Playwright). Hard fence in that doc: **do not remove playwright-extra + stealth until Patchright passes live smoke on Depop/Poshmark.**
- **Cookie-harvest-then-HTTP** — pattern named in the pilot doc: use a real/stealth browser once to pass a challenge and collect cookies, then continue with a cheap HTTP client carrying those cookies. In current code the closest realizations are Poshmark's persistent profile (browser keeps its own cookies across runs) and Depop's reused impit client per scraper instance; there is no explicit browser→HTTP cookie handoff step implemented.
- **ScrapFly** — paid scraping proxy (`scrapfly-sdk`) that solves anti-bot server-side (`asp: true`). Used only as Vestiaire's fallback. Free tier ~1,000 req/month (`spec/platforms/vestiaire.md`) — a budget, not unlimited.

Strategy summary: prefer sanctioned APIs (eBay) > public search backends (Grailed Algolia) > plain HTTP + embedded-JSON parsing (Vestiaire, Depop) > TLS impersonation (Depop impit) > stealth browser (Depop fallback, Poshmark) > paid proxy (Vestiaire ScrapFly). Cheapest tier that works wins; escalate only on evidence of blocking.

## Normalization and dedupe

Every scraper emits `Listing` (`packages/core/src/core/types.ts`): `id, platform, title, description, price, currency, size, brand, url, imageUrl, listedAt, condition, raw, sourceQueryId?`. `raw` keeps the untouched platform payload. `prepareForLLM()` truncates description to 500 chars and maps `brand: null → "unknown"` before scoring.

Per-platform mapping quirks (each `<platform>/normalize.ts`):

| Platform | Quirks |
|---|---|
| ebay | size from `localizedAspects` ("Size" then "US Size"); `shortDescription` often empty → LLM leans on title+brand |
| grailed | price from `price_i` (integer USD); brand = `designer.name`; `created_at` is epoch **seconds** (×1000) |
| vestiaire | price is `cents / 100`; brand/size/condition are nested `{ name }` objects; `url` = site prefix + relative `link` |
| depop | TWO payload shapes: legacy (`item.price.amountUsd`) and RSC (`item.pricing.…price_breakdown.price.amount`, discounted preferred) — branch on presence of `pricing`. Description doubles as title; RSC items missing description fall back to de-hyphenated slug. `sizes[0]` only |
| poshmark | tile text is regex-parsed (`extract.ts` `parsePoshmarkMetaText`): price `$n`, size = last token after price, brand = leading `"… Men's"` match. `description` = title; `listedAt`/`condition` always null → higher MAYBE rate expected at scoring |

Dedupe (`packages/core/src/pipeline/dedupe.ts` + `spec/03-data-model.md`):
1. **In-memory**: `listingKey(platform, id)` = `"{platform}:{id}"` — collapses the same item found by multiple queries in one run.
2. **DB**: `seen_listings` PK `(platform, id, profile_id)`; `hasFinalScore()` skips only listings already scored `YES | MAYBE | NO`. `PENDING` (LLM was down) and `null` rows re-enter scoring. Verdicts are cached forever — never re-score a final verdict.

Consequence: a platform-side `id` change (e.g. Depop slug vs numeric id — code uses `item.id`) would break dedupe and cause duplicate alerts, violating the spec/01 "no duplicate alerts" success bar. Treat id-field choice as load-bearing.

## Development discipline

- **Minimize live scrapes; prefer fixtures** (assumption A2 — assumed unwritten rule, confirm with owner). Unit tests run entirely on the fixture files listed in the matrix (`packages/core/tests/platforms/*.test.ts`, `fixture-smoke.test.ts`); the Playwright e2e (`pnpm run test:e2e`) drives the Poshmark DOM fixture, no network. Live traffic only via `pnpm run verify:scrapers` (`scripts/verify-scrapers.ts` — loads `.env`, prints per-platform readiness from `PLATFORM_LIVE_REQUIREMENTS`, skips platforms missing creds, uses a throwaway temp Poshmark profile) or `pnpm run test:live` (`@live`-tagged vitest in `packages/core/tests/platforms/live-smoke.test.ts`). Run these sparingly and never in a loop — the anonymous-scrape platforms tolerate personal volume, not hammering.
- Respect built-in pacing (Grailed 500ms, Vestiaire 2500ms between queries; Depop backoff). Don't strip `betweenQueriesMs` values to "speed things up".
- `packages/core/tests/fixtures/poshmark/search-tile.html` exists but no test references it as of 2026-07-02 (orphan; don't build on it).
- Login Connections stay dormant (ADR-0004 gate). Any logged-in scraping, key rotation automation, or new anti-bot dependency goes through fashion-monitor-change-control first.
- Repo is public (ADR-010): never commit real keys, the `data/` dir, or the Poshmark browser profile.

## When NOT to use this skill

- Pipeline is failing and you don't yet know it's a scraper problem → **fashion-monitor-debugging-playbook** (symptom→triage).
- Listings scrape fine but score wrong / LLM issues → **llm-scoring-reference**.
- Writing or extending tests/fixtures, evidence standards → **fashion-monitor-validation-and-qa**.
- Deciding whether a platform change is allowed at all → **fashion-monitor-change-control**.
- Env/config plumbing (where a var is read, config authority) → **fashion-monitor-config-and-flags**.

## Provenance and maintenance

Sources: `spec/platforms/*.md` (design intent — two known-stale spots flagged above), `packages/core/src/platforms/**` (ground truth), `docs/adr/0004-tiered-connections-login-dormant.md`, `docs/playwright-stealth-pilot.md`, `spec/03-data-model.md`, `scripts/verify-scrapers.ts`, `packages/core/tests/helpers/live-env.ts`. Re-verify before trusting:

- Registered platforms: `grep -n "createScraper\|FACTORIES" packages/core/src/platforms/registry.ts`
- Env vars required per platform: `grep -n "process.env" -r packages/core/src/platforms/` and `sed -n '30,70p' packages/core/tests/helpers/live-env.ts`
- Documented env vars: `cat .env.example`
- Platform toggles / profile path: `grep -n -A7 "^platforms:" config.example.yaml; grep -n "poshmark_profile_path" config.example.yaml`
- Stealth pilot status (still deferred?): `cat docs/playwright-stealth-pilot.md`
- Poshmark live selector: `grep -n "listing_tile" packages/core/src/platforms/poshmark/*.ts`
- Depop search URL params: `grep -n -A8 "buildDepopSearchUrl" packages/core/src/platforms/depop/parse-rsc.ts`
- Fixture inventory: `find packages/core/tests/fixtures -type f`
- Platform log events: `grep -n "Platform" packages/core/src/lib/log-events.ts`
