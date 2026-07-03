# Playwright anti-bot pilot (deferred implementation)

## Current state (June 2026)

- Playwright bumped to **1.52.x** with Chromium re-pinned in Docker/`postinstall`.
- Existing path: `playwright-extra` + `puppeteer-extra-plugin-stealth` in `@fm/core` (`platforms/playwright/browser.ts`).
- ScrapFly fallback + cookie-harvest-then-HTTP (`impit`) unchanged.

## Why change

Modern anti-bot detects the **Runtime.enable CDP leak** in stock Playwright/Puppeteer. Mitigations:

- [rebrowser-patches](https://github.com/rebrowser/rebrowser-patches) / Patchright
- Camoufox (anti-detect Firefox)

## Recommended pilot (not yet wired)

1. Add optional env `PLAYWRIGHT_STEALTH_DRIVER=rebrowser|legacy` (default `legacy`).
2. When `rebrowser`, install `patchright` or apply rebrowser-patches to the Playwright build in Docker.
3. Keep ScrapFly + cookie harvest as primary resilience; stealth browser only for initial challenge.
4. **Done (2026-07-03):** `scripts/verify-scrapers.ts` now captures status-code + screenshot
   posture per platform per driver. It reads `PLAYWRIGHT_STEALTH_DRIVER` and tags captures
   with the driver name, but **warns and falls back to `legacy`** if `rebrowser` is
   requested — step 1 above (the actual driver swap) still isn't wired, so honoring the
   env var without warning would silently mislabel captures. Screenshots + status codes
   land in `test-results/verify-scrapers/` (gitignored), one PNG per platform per run,
   independent of whether the platform's own scraper call succeeded — this is what makes
   it a posture measurement rather than a scrape-success proxy: a platform can return
   HTTP 200 with a normal-looking page while the production scraper still fails to
   extract listings (parsing/selector drift), and vice versa. eBay and Grailed are
   JSON APIs with no anti-bot surface, so they get status-code-only capture (parsed from
   the scrape error's `HTTP {status}` / `failed: {status}` text) — no screenshot,
   no separate probe. Depop, Vestiaire, and Poshmark get a real independent Playwright
   navigation to a representative search URL, screenshotted regardless of scrape
   readiness (so Vestiaire's posture is visible even without `SCRAPFLY_API_KEY` set).
   Next: steps 2–3 (scheduled matrix run + `v_integration_daily` pass-rate reporting) are
   still open — see fashion-monitor-research-frontier F4.

## Do not remove yet

`playwright-extra` + stealth plugin stays until a rebrowser pilot passes live smoke on Depop/Poshmark.
