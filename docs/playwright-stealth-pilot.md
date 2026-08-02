# Playwright anti-bot pilot

This document tracks a pilot to reduce bot detection when fashion-monitor's scraper uses Playwright (a browser-automation library) against marketplaces that run anti-bot defenses.

## Current state (2026-07-18)

- Playwright is bumped to **1.52.x**, with Chromium (the browser engine Playwright drives) re-pinned in Docker and in the `postinstall` script.
- `@fm/core` now has two driver paths for launching the stealth browser (`platforms/playwright/browser.ts`), selected by the `PLAYWRIGHT_STEALTH_DRIVER=patchright|legacy` environment variable (default `legacy`):
  - the existing `playwright-extra` + `puppeteer-extra-plugin-stealth` stack, which hides automation signals by injecting JavaScript into the page, and
  - a new path backed by **Patchright**, described below.
- The ScrapFly fallback and the cookie-harvest-then-HTTP pattern (grab a session cookie with a browser, then switch to the lightweight `impit` HTTP client for the rest of the scrape) are unchanged.

## Why change

Modern anti-bot systems detect the **`Runtime.enable` CDP leak**. CDP is the Chrome DevTools Protocol — the interface Playwright and Puppeteer use to control a browser. Both tools call `Runtime.enable` in a way that leaves a detectable fingerprint, which anti-bot vendors use to flag automated traffic.

The mitigation is **Patchright** — a drop-in replacement for Playwright that patches the CDP leak at the browser launch/binary level, instead of trying to hide it with injected JavaScript the way the stealth-plugin approach does. (Camoufox, an anti-detect build of Firefox, is a known alternative approach. It is out of scope for this pilot.)

`rebrowser-patches` was previously considered alongside Patchright as a candidate for this same fix. It is now dropped from consideration: an independent benchmark (651 verdicts across 31 Cloudflare-protected targets, published 2026-05-13 and updated 2026-07-12 — https://ianlpaterson.com/blog/anti-detect-browser-benchmark-patchright-nodriver-curl-cffi/) found that `rebrowser-patches` now performs the same as unpatched, vanilla Playwright (24 of 29 targets passed), while Patchright did meaningfully better (25 of 29 targets passed). This evidence is general — it comes from Cloudflare-protected targets generally, not from Depop or Poshmark specifically. It motivates picking Patchright over `rebrowser-patches`, but it does not prove Patchright works against Depop or Poshmark's own defenses (see "Do not remove yet" below).

## Driver swap: wired (2026-07-18)

`PLAYWRIGHT_STEALTH_DRIVER=patchright|legacy` is a real, working environment variable. The function `resolveStealthDriver()` in `packages/core/src/platforms/playwright/browser.ts` reads it: it warns and falls back to `legacy` on any unrecognized value, including the now-retired `rebrowser` value. Both `launchStealthEphemeralBrowser()` and `launchStealthPersistentContext()` branch on the resolved driver. The `patchright` package is only imported when that driver is actually selected, so a broken or missing Patchright install can only break the `patchright` path — it can never break the default `legacy` path that production runs today.

`scripts/verify-scrapers.ts` runs a `DRIVER_MATRIX = ["legacy", "patchright"]` loop for Depop and Poshmark specifically. This produces one labeled report row per platform per driver — 4 rows total for those two platforms — each with its own posture capture (HTTP status code plus a screenshot), independent of whether the platform's own scraper call succeeded. This is the same posture-measurement approach used before the matrix existed. Depop's row is labeled `"n/a"` instead of the configured driver whenever its `impit`-first HTTP path succeeds without ever invoking a browser, so the matrix never credits a driver that never actually ran. eBay, Grailed, and Vestiaire each run once, unmatrixed — eBay and Grailed have no anti-bot surface to test, and Vestiaire's primary scrape path doesn't route through the stealth-browser driver at all.

Next: scheduled, automated matrix runs and `v_integration_daily` pass-rate reporting are still open. See item F4 in the `fashion-monitor-research-frontier` reference.

## Do not remove yet

`playwright-extra` and the stealth plugin stay in place until Patchright passes a live smoke test on Depop and Poshmark. This is a hard requirement. Wiring the driver swap only makes the experiment runnable and its results honestly labeled — it does not by itself satisfy the requirement.
