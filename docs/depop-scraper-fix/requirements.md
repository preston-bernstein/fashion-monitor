# Requirements: Depop Scraper Data-Source Fix

## Problem statement

The Depop platform scraper (`packages/core/src/platforms/depop/`) has been silently
non-functional since live investigation on 2026-07-19: the primary extraction path
(`parse-rsc.ts`, marker `"data":{"meta":{"result_count":`) parses embedded Next.js RSC
flight JSON that no longer exists anywhere in Depop's search page response — confirmed via
a real `impit` HTTP fetch returning a legitimate 200 page with zero occurrences of
`result_count`, `products`, `totalCount`, `items`, or `listings`. The Playwright fallback
(`playwright-fallback.ts`) re-parses the exact same dead marker against the rendered DOM
after polling for up to 30 seconds, so it can never succeed regardless of how long it waits
— it is not a real fallback, just a slower path to the same failure. `spec/platforms/depop.md`,
the documentation of record for this scraper's access method, is itself stale: it still
describes a `webapi.depop.com/api/v1/search/products/` endpoint the same doc marks as
retired/404, plus a Playwright network-interception fallback targeting that dead endpoint.
Net effect: Depop currently contributes zero listings to every pipeline run, silently,
which starves downstream scoring and alerting of Depop inventory for the owner (the only
user of this personal monitoring tool) without any visible failure signal beyond a log line.
This matters now because the dead-end was only just diagnosed live; before a real fix ships,
every scheduled run against Depop is wasted work that looks superficially healthy (200
responses, no thrown errors reaching the pipeline in the common case) but returns nothing.

A prior investigation used a real browser network trace to locate a replacement endpoint and
observed it returning a Cloudflare 403; that trace was a throwaway investigation and was
deleted after use. Its conclusions (which endpoint, whether it is Cloudflare-blocked, what a
success response looks like) are carried forward here as working assumptions only — they have
not been re-confirmed via a reproducible step, and this document's functional requirements
now require that re-confirmation to happen early, before the rest of the implementation
commits to them as fact.

## Users / stakeholders

- **Owner** (sole user/operator of fashion-monitor) — depends on Depop listings reaching
  scoring/alerting; currently receives none.
- **Pipeline** (`packages/core` scheduled run) — calls `DepopScraper.search()` once per
  configured query per run; needs a `ScrapeOutcome` that reflects real success/failure, not
  a false-negative "ok" with zero listings.
- **Developers/maintainers of this repo** — need the platform's data-source contract
  (primary path, fallback path, and their trigger conditions) to be discoverable from code
  and from `spec/platforms/depop.md`, not rediscovered by live investigation each time it
  silently breaks.
- **Other platform scrapers (Poshmark, eBay, Grailed, Vestiaire)** — must be unaffected;
  they are explicitly out of scope for this change and must show no diff.

## Functional requirements

1. The system shall include an early, reproducible live-verification step — run and its
   output recorded before any other implementation step that depends on its findings is
   finalized or committed — that determines: (a) the actual current data endpoint Depop's
   search page uses; (b) whether a plain HTTP call to that endpoint ever succeeds without
   being blocked by Cloudflare; (c) the real success-response JSON shape when it does
   succeed; and (d) whether the Playwright/browser fallback's page actually hydrates to real
   product tiles in the rendered DOM — verified by inspecting actual rendered output, not
   merely by confirming that DOM-extraction code exists and runs without erroring.
2. The system shall implement a primary extraction path that first attempts a plain HTTP call
   (via the existing `impit` client) to the data endpoint identified in the live-verification
   step (requirement 1), without requiring Cloudflare-cookie warm-up or generated
   `depop-device-id`/`depop-search-id`/`depop-session-id` headers as a hard precondition for a
   first attempt. This path shall not assume the plain HTTP call will succeed: when
   Cloudflare blocks it (per the detection rule in requirement 6), the system shall treat the
   ScrapFly-gated tier as the realistic primary bypass path — consistent with the Vestiaire
   precedent (`vestiaire/fetch-page.ts`, where ScrapFly is required in practice per its own
   live-env config, not a rare escalation) — rather than over-building speculative
   cookie-harvest/UUID-header machinery ahead of evidence that maintaining it is worthwhile.
3. If the implementation generates any client-side header UUIDs at all (e.g.
   `depop-device-id`, `depop-search-id`, `depop-session-id`), those values shall be generated
   using the runtime's built-in `crypto.randomUUID()` (no new dependency) and shall never be
   derived from, or incorporate, user-supplied search-query text.
4. The system shall preserve the existing three-attempt-with-backoff retry structure
   (`1500ms + attempt * 1000ms` between attempts, 3 attempts) in `DepopScraper.searchViaHttp`
   for the primary HTTP tier only. The ScrapFly-gated tier and the Playwright/browser-fallback
   tier are one-shot escalations — each is attempted once per `searchQuery` call, not
   independently retried 3 times each — unless `spec/platforms/depop.md` explicitly documents
   and justifies a different retry shape for one of them.
5. When the primary path exhausts its retries with zero listings or a non-2xx response, the
   system shall invoke a fallback path that performs direct DOM tile extraction via CSS
   selectors against the rendered page (`page.evaluate` against real selectors). This shall
   follow the same architectural pattern as Poshmark's `extract.ts`/
   `poshmarkTileExtractScript` — a self-contained `page.evaluate` script paired with a
   separate Node-side parser function — not literal reuse of Poshmark's selectors or parsing
   logic, and not a re-parse of the same marker the primary path already failed on.
6. Cloudflare-challenge detection for the primary HTTP path shall REQUIRE a
   Cloudflare-specific header signal as the primary/required condition — specifically, a
   response carrying a `server: cloudflare` header combined with a `cf-ray` header present. A
   body-text substring match alone (e.g., matching `"Forbidden"`, `"cdn-cgi/challenge-platform"`,
   or similar text with no corroborating header) shall never be sufficient on its own to
   classify a response as a Cloudflare challenge, since ordinary non-Cloudflare 403s can
   false-positive on such text and would misroute traffic into the shared, budget-limited
   ScrapFly quota. When this header-based detection confirms a Cloudflare challenge on the
   primary path, the system shall invoke a ScrapFly-gated fallback tier for Depop analogous to
   `vestiaire/fetch-page.ts` (`fetchViaScrapfly`), gated on
   `config.platform_credentials.scrapfly_api_key`.
7. When the primary HTTP path, the DOM-extraction fallback, and (if implemented) the ScrapFly
   tier are all exhausted without producing listings, the system shall throw an error or emit
   a distinct terminal-failure log event (registered in `LogEvents` per the dotted-id
   convention below) — it shall never return a silently-empty listings array from a broken
   extraction path.
8. The system shall normalize all newly-extracted listings into the existing `Listing` type
   via `normalize.ts` (extending `normalizeDepop`/`mapDepopProducts` for the new data shape,
   or adding a sibling normalizer), so downstream pipeline code requires no changes.
9. Normalization shall validate the presence of required fields on each extracted product
   before constructing a `Listing` — at minimum a stable product identifier and a parseable
   price — and shall throw, or flag/skip the item with a logged error, on their absence rather
   than silently defaulting (e.g., defaulting price to `0`, or setting the id to the literal
   string `"undefined"`). Silent defaulting on a required field is indistinguishable from a
   real value and violates the never-silent-empty-or-wrong intent of this scraper's other
   failure-signaling requirements.
10. The system shall emit a distinct log event, added to `LogEvents` in `log-events.ts`
    following its existing dotted-id convention, for: successful extraction on the primary
    path, primary-path failure/fallback trigger, and fallback-path success or failure (and
    ScrapFly-tier success/failure, if implemented) — no ad-hoc string literals for event ids.
11. The system shall return listings from `DepopScraper.searchQuery` such that a caller
    cannot distinguish "no results for this query" from "extraction path broken" purely from
    an empty array. Logging alone is not sufficient: a broken extraction path shall also be
    surfaced as a thrown error or a caller-visible failed `ScrapeOutcome`, consistent with how
    other platforms' `scrapeQueries` integration already surfaces failures — not merely
    written to a log line no caller inspects.
12. The system shall update `spec/platforms/depop.md` (the doc of record for this scraper's
    access method) to describe the shipped primary and fallback paths accurately, removing
    references to the confirmed-dead `webapi.depop.com/api/v1/search/products/` endpoint and
    the RSC-marker approach unless one of them is proven still valid by this investigation.
13. The system shall update or replace the fixture(s) under
    `packages/core/tests/fixtures/depop/` (currently `search-response.json`, shaped for the
    dead RSC-marker format) to reflect the real current response shape, so the default
    dev/test loop runs entirely offline against fixtures per this repo's scraping discipline.
14. The system shall update the existing Depop test suite (`depop.test.ts`,
    `depop-rsc.test.ts`, `depop-normalize-rsc.test.ts`, `depop-scraper-http.test.ts`,
    `depop-fallback.test.ts`) so no test asserts the dead RSC marker is the production
    success path. The existing RSC-shaped normalizer/parsing logic (`normalizeDepopRscProduct`
    and related parsing) shall be RETAINED as a documented legacy/fallback code path — not
    deleted — unless and until the live-verification step (requirement 1) proves that shape is
    unreachable from any current Depop response; this uses the "secondary/legacy path with a
    documented reason" escape hatch as the default outcome, not deletion-first.
15. The system shall NOT modify `packages/core/src/platforms/poshmark/`,
    `packages/core/src/platforms/ebay/`, `packages/core/src/platforms/grailed/`, or
    `packages/core/src/platforms/vestiaire/`.

## Non-functional requirements

- The primary extraction path must not require launching a browser (Playwright) — only the
  fallback path (DOM extraction) or ScrapFly tier may do so, consistent with the
  faster/cheaper-first ordering already established by Vestiaire's fetch-then-ScrapFly
  pattern.
- Live scraping against real Depop during development shall stay bounded and measurable:
  all development iteration runs against fixtures only (no live network calls); real live
  calls against Depop are limited to the single opt-in live-verification step this document
  requires (requirement 1) plus final acceptance verification via the existing opt-in
  mechanisms (`pnpm run verify:scrapers`, `pnpm run test:live` /
  `VITEST_LIVE=1 vitest run tests/platforms/live-smoke.test.ts -t @live`) — not unbounded
  ad hoc live testing during implementation.
- No new persistent login/session state (cookies, connected-profile storage) is introduced
  for Depop — this fix addresses the anonymous/public search path only, matching Depop's
  current no-profile, no-cookie scraper shape.
- No hardcoded credentials: any ScrapFly API key must be read from
  `config.platform_credentials.scrapfly_api_key` (existing config shape), never inlined.
- ScrapFly error responses and any harvested Cloudflare cookies must never be logged
  verbatim — logging must redact or omit the API key and any cookie values, since verbatim
  logging risks leaking the ScrapFly API key or a replayable Cloudflare session cookie into
  log storage.

## Constraints

- Must reuse the existing `impit` client (`Impit({ browser: "firefox" })`) already
  instantiated in `scraper.ts` for the primary HTTP path.
- Must reuse `launchStealthEphemeralBrowser` (already imported in `playwright-fallback.ts`)
  for any browser-based fallback, consistent with how Poshmark launches its stealth context.
- Must integrate with `scrapeQueries` (`scrape-utils.ts`) unchanged — its per-query try/catch,
  tagging, and `ScrapeOutcome` shape are shared across all platforms and out of scope here.
- Must follow the `log-events.ts` dotted-id convention (`platform.depop.*`) for any new log
  event; existing ids `PlatformDepopRscSuccess` / `PlatformDepopHttpFailed` may be renamed,
  repurposed, or supplemented but the registry must stay in sync with
  `docs/logging-and-audit.md` per the file's own header comment.
- Must not change Poshmark, eBay, Grailed, or Vestiaire scraper code or tests.
- Config schema for `platform_credentials.scrapfly_api_key` already exists
  (`packages/core/src/core/config.ts`); reuse it rather than adding a Depop-specific key if a
  ScrapFly tier is added.

## Out of scope

- Adding a logged-in/connected-profile Depop scraper (session cookies, ban-risk-bearing
  authenticated access) — this fix covers the existing anonymous public-search path only.
- Any change to Poshmark, eBay, Grailed, or Vestiaire scraper code.
- Pagination beyond the current single-page/first-result-page search — the existing
  `DepopScraper.searchViaHttp` does not paginate today, and this fix does not add it.
- Engaging the ScrapFly tier for any response that does not carry the concrete
  header-based Cloudflare signal defined in this document's Cloudflare-detection requirement
  (a `server: cloudflare` header combined with a `cf-ray` header) — a 403 or other failure
  lacking that header signal is out of scope for ScrapFly escalation and must not trigger it,
  regardless of body-text similarity to a Cloudflare block page.
- Building any new persistent Depop browser profile/cookie store.
- General resilience/observability work on the pipeline beyond the log events this scraper
  itself emits.

## Acceptance criteria

1. A real `impit` HTTP fetch of a live Depop search URL (built via `buildDepopSearchUrl` or
   its replacement), when it returns product data in any form, yields at least one
   normalized `Listing` from `DepopScraper.searchViaHttp` without invoking the Playwright
   fallback.
2. When the primary path is forced to fail (fixture returns no matching data, or 3 attempts
   exhausted), `DepopScraper.searchQuery` invokes the fallback path and that fallback path
   extracts listings via real CSS selectors against rendered DOM content — not via
   `extractDepopListingsFromHtml`/the retired RSC marker.
3. Running the Depop test suite offline (no network access, fixtures only) passes
   deterministically and exercises both the primary and fallback code paths.
4. No test in the Depop suite asserts that production success depends on the retired RSC
   marker `"data":{"meta":{"result_count":` being present in a live page.
5. The single opt-in live-verification run required above (`pnpm run verify:scrapers` or
   `pnpm run test:live`), executed against real Depop using a query string manually confirmed
   in a browser beforehand to return results, returns one or more real listings that each
   satisfy all of: a non-empty title string; a price that is a positive number (not `0`, not
   `NaN`, not a placeholder); and a url matching the pattern `depop.com/products/...` (or the
   current live equivalent identified by the live-verification step).
6. `git diff` for this change shows zero modifications under
   `packages/core/src/platforms/{poshmark,ebay,grailed,vestiaire}/` and their corresponding
   test files.
7. Every new or changed log event used by the Depop scraper is registered in `LogEvents`
   (`log-events.ts`) with a dotted id following the existing `platform.depop.*` convention —
   no raw string literals passed to the logger for event ids.
8. `spec/platforms/depop.md` no longer describes the confirmed-dead
   `webapi.depop.com/api/v1/search/products/` endpoint as an active access method, and its
   "Access Method" / "Primary" / "Fallback" sections match what the shipped code actually
   does.
9. `packages/core/tests/fixtures/depop/` contains fixture data shaped like the real current
   Depop response (whatever data source was chosen), replacing or supplementing the
   RSC-shaped `search-response.json` such that fixture-based tests do not silently pass
   against a shape Depop no longer serves.
10. If a ScrapFly tier is added, it engages only after a detected Cloudflare-challenge
    response from the primary path — defined as a `server: cloudflare` header combined with a
    `cf-ray` header, never a body-text substring match alone — and only when
    `config.platform_credentials.scrapfly_api_key` is present; absent that key, the scraper
    fails with a clear "ScrapFly key required" error rather than silently skipping the tier.
