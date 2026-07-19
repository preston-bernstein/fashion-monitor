# Playwright anti-bot pilot (deferred implementation)

## Current state (June 2026)

- Playwright bumped to **1.52.x** with Chromium re-pinned in Docker/`postinstall`.
- Existing path: `playwright-extra` + `puppeteer-extra-plugin-stealth` in `@fm/core` (`platforms/playwright/browser.ts`).
- ScrapFly fallback + cookie-harvest-then-HTTP (`impit`) unchanged.

## Why change

Modern anti-bot detects the **Runtime.enable CDP leak** in stock Playwright/Puppeteer. Mitigation:

- **Patchright**: patches the Playwright build to hide the leak (alternative to rebrowser-patches, which is now superceded).
- Camoufox (anti-detect Firefox, out-of-scope for this pilot).

### Benchmark evidence (2026-07-18)

Independent sweep of 31 Cloudflare-protected targets (651 total verdicts, published 2026-05-13, updated 2026-07-12) found:
- Patchright: 25/29 OK
- rebrowser-patches (now retired): 24/29 OK (tied with unpatched vanilla Playwright)

This motivates Patchright as the pilot candidate, though the benchmark is general-purpose (not Depop/Poshmark-specific—see the gate below). Source: [ianlpaterson.com/blog/anti-detect-browser-benchmark-patchright-nodriver-curl-cffi/](https://ianlpaterson.com/blog/anti-detect-browser-benchmark-patchright-nodriver-curl-cffi/)

## Driver swap: wired (2026-07-18)

The Patchright pilot is now live:

- **Env var:** `PLAYWRIGHT_STEALTH_DRIVER=patchright|legacy` (default `legacy`). Resolved by `resolveStealthDriver()` in `packages/core/src/platforms/playwright/browser.ts`.
- **Browser launch:** Both `launchStealthEphemeralBrowser()` and `launchStealthPersistentContext()` branch between Patchright (dynamically imported) and the existing `playwright-extra` + stealth-plugin path.
- **Posture matrix:** `scripts/verify-scrapers.ts` runs a `["legacy", "patchright"]` matrix for Depop and Poshmark specifically, capturing status code + screenshot per platform per driver (4 rows total). Depop's row is labeled `"n/a"` when impit-first HTTP succeeds without a browser invocation. eBay, Grailed, and Vestiaire run once each, unmatrixed. All captures land in `test-results/verify-scrapers/` (gitignored), independent of scraper success—this separates posture (does the site render?) from scrape correctness (does the parser extract?).
- **Next:** Scheduled matrix run + automated `v_integration_daily` pass-rate reporting still open—see fashion-monitor-research-frontier F4.

## Do not remove yet

`playwright-extra` + stealth plugin stays until **Patchright** passes live smoke on both Depop and Poshmark. This is a hard requirement—no removal until production proof.
