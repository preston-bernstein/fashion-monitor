# Plan: Depop Scraper Data-Source Fix

## Approach

A throwaway, already-deleted patchright network trace against
`www.depop.com/search/?q=corduroy+jacket` (2026-07-19, not reproducible from this repo)
found: zero product markers in the initial HTML (no `result_count`, no `slug`, no
`media.depop.com` URLs — the search page renders an empty grid shell and hydrates
client-side), a candidate replacement endpoint
(`GET https://www.depop.com/presentation/api/v1/search/products/?what=<query>&limit=24&country=us&currency=USD&from=in_country_search&include_like_count=true`),
and a `403 Forbidden` (branded Depop error page, `server: cloudflare`, `cf-ray` present) on
the very first, unretried call to it, from patchright's headless Chromium (which leaked
`sec-ch-ua: "HeadlessChrome"`).

That one-off trace is a lead, not a foundation. It never observed a successful response —
every real call hit the Cloudflare block — so it cannot tell us the real JSON shape, whether
a plain HTTP call ever gets through in production, or whether the Playwright fallback's own
hydration actually reaches real tiles. The previous version of this plan treated that trace
as settled fact and scheduled live verification as the *last* of fourteen steps, after the
normalizer, fixtures, docs, and tests were already written against the guess. That is
backwards: verification is the one step that can correct a wrong guess, so it must run
**first**, before any of the downstream code depends on its unconfirmed assumptions. This
plan is reordered so a real, reproducible live-verification pass (Phase 0, below) runs early
and every subsequent decision — normalizer shape, RSC-branch retention, ScrapFly emphasis,
Cloudflare-detection rule — is stated as conditional on what that pass actually finds, not on
the deleted trace.

The other correction is scope. The deleted trace's discovery of a Cloudflare 403 does not
justify building a complex tier-1 (cookie-warm-up + generated `depop-device-id`/
`depop-search-id`/`depop-session-id` headers, up to 6 requests per query across 3 retries)
before knowing whether that complexity ever pays off. Vestiaire is not proof this pattern
works — Vestiaire's own `live-env.ts` marks `SCRAPFLY_API_KEY` as **required**, not optional,
with the note "Cloudflare blocks direct fetch — ScrapFly required in practice." Vestiaire's
cheap tier essentially never wins against Cloudflare in production; ScrapFly is the real
primary bypass there. Depop's trace found the identical 403 on the first call. So this plan
builds the *simple* version first — one plain GET, no cookie-harvest/UUID-header machinery
as a hard-built feature — and escalates straight to ScrapFly on a tightened, specific
Cloudflare-challenge signal. The complex cookie/header engineering is deferred: it's only
worth building if Phase 0's live verification actually shows the plain call succeeding often
enough, unassisted, to be worth maintaining. If it doesn't, ScrapFly carries the primary load
and that machinery is simply never built.

Two things this plan does **not** claim: the new endpoint's `v1` naming is not evidence of
durability — the endpoint it replaces was also versioned `v1` and still got retired, so
nothing here should be sold as a permanent fix. And the new endpoint's `limit=24` covers
fewer items per query than the previously-documented (if never implemented) 2-page/48-item
approach — this is an accepted, known regression, called out honestly rather than left
silent.

## Architecture

### Phase 0 — Live verification (runs FIRST, before any cascade code is written)

A real, reproducible script (not a throwaway trace deleted afterward) run from the actual
deploy network, that answers four questions and leaves its own trace for future reference:

1. Does a plain HTTP GET to the candidate products-search endpoint ever succeed (2xx with a
   parseable body), from a real deploy IP, with no cookie harvesting or custom headers?
2. What is the **real** success-response JSON shape — top-level key, per-product fields,
   price shape (decimal string like `"45.00"` vs. integer cents like `4500`), timestamp
   shape (ISO string vs. unix epoch)?
3. Does the Playwright/browser fallback's hydration actually reach real rendered product
   tiles — not just "the extraction code compiles" — and does its client-side fetch call the
   *same* backend endpoint that may be Cloudflare-blocked? (If so, the fallback is not an
   independent safety net; it can fail identically to tier 1, and the plan must say so rather
   than assume otherwise.)
4. What is the real DOM CSS selector for a product tile, captured from an actual hydrated
   page, not guessed from Poshmark's selector shape?

This step must run against **built** code (`pnpm build` first — `scripts/verify-scrapers.ts`
imports from `packages/core/dist/...`, not `src/...`, so running it against stale compiled
output would silently validate pre-fix behavior). It can reuse and extend
`scripts/verify-scrapers.ts`'s existing Depop path/posture-capture rather than being a wholly
separate tool. Its outputs (captured success-response body, captured selector, a written
note on whether tier 1 or the fallback actually got through) become the required inputs to
everything below — this plan does not commit to a normalizer shape, a fixture, or an
RSC-branch deletion until Phase 0 has produced real evidence one way or the other.

### Phase 1 — The cascade (built only after Phase 0's findings are in hand)

```
DepopScraper.searchQuery(query)
      │
      ▼
1. searchViaHttp(query)                      [impit, browser:"firefox" — no browser launch]
      │  ONE plain GET to the products-search endpoint. No cookie-warm-up request, no
      │  generated depop-device-id/search-id/session-id headers, UNLESS Phase 0 showed
      │  this succeeds often enough unassisted to justify the extra complexity — if so,
      │  add the warm-up/header machinery as a documented, evidence-backed addition, not
      │  a default assumption.
      │  Retried up to 3 attempts with backoff (1500ms + attempt*1000ms) — this retry
      │  applies ONLY to this tier. It does not re-run ScrapFly or Playwright.
      │
      │  non-2xx/empty, NOT a Cloudflare-challenge (see detection rule below) ───┐
      │  non-2xx/empty, IS a Cloudflare-challenge                                │
      ▼                                                                          │
2. fetchViaScrapfly (Depop)  — ONE-SHOT, not retried                             │
      │  only if config.platform_credentials.scrapfly_api_key set                │
      │  same JSON GET, asp:true, via scrapfly-sdk (mirrors vestiaire/fetch-page) │
      │  no key → throw "ScrapFly key required for Cloudflare bypass", still     │
      │  falls through to step 3                                                 │
      │                                                                          │
      │  fails or skipped ───────────────────────────────────────────────────────┤
      ▼                                                                          │
3. scrapeDepopViaPlaywright(query)  — ONE-SHOT, not retried  ◄────────────────────┘
      │  launchStealthEphemeralBrowser() via the EXISTING PLAYWRIGHT_STEALTH_DRIVER
      │  flag / resolveStealthDriver() (packages/core/src/platforms/playwright/browser.ts)
      │  — do not invent a Depop-specific driver fix.
      │  goto search HTML page, dismiss OneTrust consent (unchanged)
      │  wait for product tiles using the REAL selector captured in Phase 0
      │  page.evaluate(depopTileExtractScript) against that real selector
      │  NOTE (per Phase 0 finding #3): if hydration calls the same Cloudflare-blocked
      │  backend, this tier may fail for the identical reason as tier 1 — it is not
      │  guaranteed to be an independent safety net.
      │
      ▼
   listings[] or throw (never silent empty — FR8)
```

`scrapeQueries` (`scrape-utils.ts`) is untouched — it still just calls `searchQuery` per
query and interprets the outcome; everything above lives inside `DepopScraper`.

**Cloudflare-challenge detection is tightened, not broadened.** The prior draft's rule
(403/429 + `server: cloudflare`, OR a bare body-substring match on "Forbidden"/`cdn-cgi`/etc.)
false-positives: an ordinary non-Cloudflare 403 (e.g. a malformed request) can contain the
word "Forbidden" and would get misrouted into the shared, budget-limited ScrapFly quota
(~1,000 req/month, shared with Vestiaire). The rule instead is: **`server: cloudflare` AND a
`cf-ray` header present are both required** as the primary condition. A body-substring match
(`cdn-cgi`, "Just a moment", "Attention Required") is corroborating evidence only, logged
alongside the decision, never sufficient alone to trigger the ScrapFly escalation.

**Stealth-driver integration.** The `sec-ch-ua: "HeadlessChrome"` leak observed on
patchright's request is a real, fixable issue, but this repo already has a governance
mechanism for exactly this class of problem: `PLAYWRIGHT_STEALTH_DRIVER=patchright|legacy`
and `resolveStealthDriver()`, plus the explicit hard-fence in
`docs/playwright-stealth-pilot.md` ("playwright-extra + stealth plugin stays until Patchright
passes live smoke on Depop AND Poshmark"). This plan does not add a parallel Depop-specific
header fix or otherwise modify shared browser-launch code outside that flag/matrix — any
header-leak investigation must route through `scripts/verify-scrapers.ts`'s existing
`DRIVER_MATRIX` and can contribute the "Depop" half of that gate's evidence requirement, but
must not touch launch code in a way that could affect Poshmark without going through the
flag.

## Data model

`Listing` (`packages/core/src/core/types.ts`) is unchanged. The normalizer (`normalize.ts`)
gets hardened, not reshaped speculatively:

- **Validate the real top-level response key** (whatever Phase 0 confirms it is) exists, and
  throw a distinct "unexpected response shape" error if it's absent. Do not let a wrong or
  renamed key silently degrade to an empty array indistinguishable from "genuinely no
  results."
- **Require a real product id.** Throw rather than coercing a missing id into the literal
  string `"undefined"` — today's `String(item.id)` would do exactly that and bake it into
  both `Listing.id` and its URL.
- **Require a real, parseable price.** Throw or flag rather than silently defaulting to `0`
  when the price field is missing — a genuine `$0` listing and a broken parse must not look
  identical. The price-shape assumption (decimal string `"45.00"` vs. integer cents `4500`)
  is unconfirmed until Phase 0 verifies it; the normalizer must sanity-check the parsed value
  rather than trust it blindly.
- **Guard the timestamp shape.** ISO string vs. unix epoch number is unconfirmed until Phase
  0; guard against silently producing an `Invalid Date`.
- **Keep `normalizeDepopRscProduct` as documented legacy** — do not delete it as a foregone
  conclusion. It already maps a real, previously-observed Depop backend schema (deeply-nested
  `pricing`/`preview`/`pictures` fields) that plausibly still describes the same backend, just
  reached differently. Keep it gated behind the existing `if (item.pricing)` duck-type check,
  with a comment explaining why it's retained, and only remove it — along with
  `parse-rsc.ts`'s extraction functions and `depop-rsc.test.ts`/`depop-normalize-rsc.test.ts`
  — if Phase 0 proves the real response never has that shape. Same conditionality applies to
  the fixture at `packages/core/tests/fixtures/depop/search-response.json`.
- **Design note (not a hard requirement this pass):** longer-term, the normalizer's three
  branches (webapi-legacy, RSC, new-API) should dispatch on an explicit source tag the caller
  passes in (which tier produced the data) rather than accumulating more duck-type
  shape-sniffing. A comment/TODO in `normalize.ts` is enough for this pass — don't build the
  dispatch mechanism now.
- **Worth doing since the file is being touched anyway:** stamp a `raw._normalizerSource` tag
  (or equivalent) onto the `raw` blob stored on each `Listing`, so historically-stored rows
  become self-describing about which code path (webapi-legacy / RSC / new-API / DOM-fallback)
  produced them.

## API / interface contract

Internal only (no HTTP surface exposed by this repo's changes) — the contract that changes is
Depop's own upstream endpoint this scraper depends on:

- **Candidate primary data source** (unconfirmed until Phase 0):
  `GET https://www.depop.com/presentation/api/v1/search/products/`. Query params: `what`
  (search text), `limit=24`, `country=us`, `currency=USD`, `from=in_country_search`,
  `include_like_count=true`. **The success-response shape was never observed** — every real
  call in the deleted trace hit the Cloudflare 403 — so exact JSON field names, the price
  shape, and the timestamp shape are open items Phase 0 must confirm before the normalizer
  ships. Treat the current `normalizeDepop`/`normalizeDepopRscProduct` split as a starting
  template, not a guess made from nothing — but don't commit further than that until Phase 0
  reports back.
- **Cloudflare-challenge detection** (gates the ScrapFly tier): `server: cloudflare` header
  AND `cf-ray` header both present, required. Body-substring matches (`cdn-cgi`,
  "Forbidden", "Just a moment", "Attention Required") are corroborating evidence logged
  alongside the decision, never sufficient alone — see Architecture above for why the
  original broader/looser rule was rejected.
- **Error cases**: `Depop search HTTP <status>` (non-Cloudflare failure, existing shape);
  `Depop unexpected response shape` (new — top-level key missing/renamed, distinct from "zero
  results"); `ScrapFly key required for Cloudflare bypass` (Cloudflare detected, no key
  configured); `Depop ScrapFly fetch failed: <detail>` (key present, ScrapFly attempt itself
  failed); `Depop Playwright fallback returned no listings` (existing, final failure — FR8).
- **Secrets hygiene**: ScrapFly error responses and harvested Cloudflare cookies
  (`__cf_bm`/`_cfuvid`, if the cookie-warm-up path is ever built per Phase 0's findings) must
  never be logged verbatim in any log event or debug output — either could leak the ScrapFly
  API key or a replayable session cookie.

## Integration points

- **New: a Phase 0 live-verification pass** — extends `scripts/verify-scrapers.ts`'s existing
  Depop path rather than a wholly separate tool; must run against `pnpm build`'d output
  (`packages/core/dist/...`, which is what `verify-scrapers.ts` already imports from) so it
  exercises the actual fixed code, not stale pre-fix compiled output. Its findings (captured
  success-response body if any, captured DOM selector, whether the Playwright fallback hits
  the same backend endpoint) are recorded and become the input to every step below — nothing
  downstream ships ahead of this.
- `packages/core/src/platforms/depop/parse-rsc.ts` — keep `buildDepopSearchUrl` (repurposed
  for the Playwright fallback's page load). Add `buildDepopProductsApiUrl(query)` for the new
  endpoint's query string. Do **not** delete `extractDepopSearchFromHtml`/
  `extractDepopListingsFromHtml`/`SEARCH_MARKER` as a foregone conclusion — keep them,
  commented as legacy, unless Phase 0 proves the RSC shape is truly unreachable. If any of
  these functions ARE removed, clean up the now-unused `mapDepopProducts` import in this file
  rather than leaving a dead import behind.
- `packages/core/src/platforms/depop/scraper.ts` — rewrite `searchViaHttp` to a single plain
  GET against the new endpoint by default; add cookie-warm-up + generated
  `depop-device-id`/`depop-search-id`/`depop-session-id` headers only if Phase 0's findings
  justify the complexity. On a tightened Cloudflare-challenge detection, delegate to the new
  ScrapFly tier. **The existing 3-attempt/backoff loop wraps only this tier's own attempts**
  — it must not be read as also retrying the ScrapFly call or relaunching the Playwright
  fallback multiple times (that would burn 3x the paid ScrapFly budget and 3x the browser
  launches per query). **`export { parseDepopProducts } from "./normalize.js";` (currently
  line ~90) must be preserved** — `depop.test.ts` imports it, and it is not otherwise called
  out anywhere in this rewrite; do not drop it during the rewrite.
- `packages/core/src/platforms/depop/fetch-scrapfly.ts` (new file, mirrors
  `vestiaire/fetch-page.ts`'s `fetchViaScrapfly`) — Depop-specific ScrapFly call against the
  products API URL, reusing `config.platform_credentials.scrapfly_api_key` (no new config
  key) and the already-installed `scrapfly-sdk` dependency. Ensure ScrapFly error bodies are
  never logged verbatim (see secrets-hygiene note above).
- `packages/core/src/platforms/depop/playwright-fallback.ts` — replace the RSC re-parse with
  real DOM tile extraction using the selector Phase 0 actually captured (not guessed from
  Poshmark's shape). Route any driver/header-leak fix through the existing
  `PLAYWRIGHT_STEALTH_DRIVER` flag and `scripts/verify-scrapers.ts`'s `DRIVER_MATRIX` — do not
  add a parallel Depop-specific fix to shared browser-launch code that could silently affect
  Poshmark.
- `packages/core/src/platforms/depop/extract.ts` (new file, sibling to
  `poshmark/extract.ts`) — self-contained `depopTileExtractScript()` for `page.evaluate`, plus
  a Node-side parser, following Poshmark's split of browser-context script vs. Node-side
  parsing. Built against Phase 0's captured selector.
- `packages/core/src/platforms/depop/normalize.ts` — add a normalizer branch for the new API's
  field shapes once Phase 0 confirms them; keep `normalizeDepopRscProduct` as documented
  legacy (see Data model) rather than deleting it; add the response-shape/id/price/timestamp
  validation described in Data model; add the `raw._normalizerSource` tag.
- `packages/core/src/lib/log-events.ts` — add `PlatformDepopHttpSuccess`
  (`platform.depop.http.success`), `PlatformDepopCloudflareChallenge`
  (`platform.depop.cloudflare.challenge`), `PlatformDepopScrapflySuccess`/
  `PlatformDepopScrapflyFailed` (`platform.depop.scrapfly.success`/`.failed`),
  `PlatformDepopFallbackSuccess`/`PlatformDepopFallbackFailed`
  (`platform.depop.fallback.success`/`.failed`). Keep `PlatformDepopHttpFailed` as the
  primary-failure/fallback-trigger event (FR7). **Explicitly retire
  `PlatformDepopRscSuccess`** (remove it, or mark it clearly deprecated with a comment) once
  nothing emits it — do not leave it dangling alongside the six new events as if it were still
  live.
- `docs/logging-and-audit.md` — append the new event ids and the retirement note, per its own
  "keep in sync" header comment.
- `spec/platforms/depop.md` — rewrite to document Phase 0's actual findings (not the deleted
  trace's assumptions): the confirmed endpoint and response shape, the tightened
  Cloudflare-detection rule, the retained/removed status of the RSC branch, the three-tier
  order, the `limit=24` pagination regression, and the "v1 is not a durability guarantee"
  caveat.
- `packages/core/tests/fixtures/depop/search-response.json` — replace with a fixture shaped
  like the real success response Phase 0 captures. Keep the old file only if the RSC branch
  is retained (see Data model).
- `packages/core/tests/platforms/depop-rsc.test.ts`, `depop-normalize-rsc.test.ts` — do not
  delete as a foregone conclusion; keep (possibly reduced, with a comment explaining the
  legacy branch) unless Phase 0 proves the RSC shape is truly dead.
- `packages/core/tests/platforms/depop.test.ts`, `depop-scraper-http.test.ts`,
  `depop-fallback.test.ts` — update mocks/fixtures to the confirmed endpoint/shape and the
  three-tier cascade; add cases for: Cloudflare-403 with key present → ScrapFly path invoked
  (one-shot, not retried); Cloudflare-403 with no key → clear error, falls through to
  Playwright fallback; a non-Cloudflare 403 (e.g. body containing "Forbidden" but no
  `cf-ray`/`server: cloudflare`) → does NOT route to ScrapFly, per the tightened detection
  rule; retry-scope test confirming ScrapFly/Playwright are not re-invoked on the primary
  tier's retry loop.
- `packages/core/tests/helpers/live-env.ts` — update the `depop` entry's `optional` list to
  include `SCRAPFLY_API_KEY` (not `required` — the DOM fallback still works without it,
  unlike Vestiaire) with a note reflecting the new endpoint and the observed 403.
- `scripts/verify-scrapers.ts` — extended per the Phase 0 bullet above. Separately, note (as a
  one-line comment, not a fix in this pass) that its own `buildPostureUrl` independently
  duplicates URL-construction logic already in `parse-rsc.ts`'s `buildDepopSearchUrl`, and is
  missing the `sizes` param that `buildDepopSearchUrl` includes — a pre-existing,
  out-of-scope inconsistency worth flagging, not fixing here.

## Technology choices

- No new libraries. `impit`, `scrapfly-sdk`, `patchright`/`playwright-extra` are all already
  repo dependencies — this is a data-source and code-path fix, not a new-dependency change.
- **ScrapFly, not cookie-harvest engineering, is the realistic primary Cloudflare bypass** —
  matching how Vestiaire actually behaves in production (ScrapFly required in practice, not
  "cheap tier usually wins"). The cookie-warm-up-then-HTTP pattern named in
  `docs/playwright-stealth-pilot.md` is not built by default in this pass; it's only added if
  Phase 0's live verification shows it earns its complexity.
- Stealth-driver selection reuses the existing `PLAYWRIGHT_STEALTH_DRIVER`/
  `resolveStealthDriver()` mechanism and `scripts/verify-scrapers.ts`'s `DRIVER_MATRIX` —
  no parallel Depop-specific driver logic.

## Risk areas

1. **The Playwright fallback may not be an independent safety net.** If its hydration calls
   the same Cloudflare-blocked backend endpoint as tier 1, it can fail for the identical
   reason, leaving no real fallback once ScrapFly is also exhausted or unconfigured. Phase 0
   must check this explicitly rather than assume the fallback is independent.
2. **Success-response shape remains unconfirmed until Phase 0 runs.** The deleted trace never
   observed a real 200 with product JSON. The normalizer branch, fixture, price-shape
   assumption (decimal string vs. integer cents), and timestamp-shape assumption (ISO vs.
   epoch) are all provisional until that pass captures a real success body — this is why
   Phase 0 is sequenced first, not last.
3. **The deleted trace's egress IP is not representative of the deploy target.** It ran from
   a sandboxed dev environment (US datacenter IP), not Preston's home/NAS network. The
   confirmed 403 may be partly IP-reputation-driven in a way that doesn't reproduce from the
   real deploy IP — or the real environment could get blocked for different reasons entirely.
   Phase 0's live-verification pass must run from the actual deploy network to be meaningful.
4. **Required custom headers (`depop-device-id`, `depop-search-id`, `depop-session-id`) are
   unverified as to whether they're actually validated server-side** or just analytics noise.
   This only matters if Phase 0 justifies building the cookie/header tier at all — if ScrapFly
   ends up carrying the primary load instead, this risk is moot.
5. **RSC-branch retention is provisional, not permanent.** Keeping `normalizeDepopRscProduct`
   and its associated tests as "documented legacy" is the safer default given the branch
   describes a real previously-observed schema, but it adds a small amount of dead-code risk
   if Phase 0 later proves conclusively that shape is unreachable and nobody circles back to
   remove it.
6. **`sec-ch-ua: "HeadlessChrome"` leak is real but gated by an existing hard-fence** —
   `docs/playwright-stealth-pilot.md` requires Patchright to pass live smoke on *both* Depop
   and Poshmark before `playwright-extra`/stealth-plugin can be removed. This plan's Depop
   verification can supply the Depop half of that evidence, but does not itself clear the
   gate — Poshmark's half is out of scope here.
7. **Pagination regression is accepted, not hidden.** The new endpoint's `limit=24` covers
   fewer items per query than the previously-documented (never implemented) 2-page/48-item
   approach. This plan does not implement cursor pagination (`after` token) — out of scope
   per requirements — so query coverage is smaller than the aspirational baseline.
8. **The endpoint's `v1` naming is not a durability guarantee.** The endpoint being replaced
   was also versioned `v1` and still got retired without notice; this fix should not be
   presented as more stable long-term than it can support.
9. **Shared ScrapFly budget.** ScrapFly's free-tier quota (~1,000 req/month) is already shared
   with Vestiaire (`spec/platforms/vestiaire.md`). Making ScrapFly Depop's realistic primary
   bypass (not just an emergency fallback) increases pressure on that shared budget — the
   tightened Cloudflare-detection rule (header-required, not body-substring-triggered) exists
   specifically to avoid burning this budget on false positives.
10. **Secrets in logs.** ScrapFly error bodies and any harvested Cloudflare cookies must never
    be logged verbatim — both can carry replayable credentials (API key, session cookies).
    Enforce this in code review of the new log events, not just as a plan note.
