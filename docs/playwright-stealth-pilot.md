# Playwright anti-bot pilot

## Current state (2026-07-18)

- Playwright bumped to **1.52.x** with Chromium re-pinned in Docker/`postinstall`.
- Two driver paths in `@fm/core` (`platforms/playwright/browser.ts`), selected via `PLAYWRIGHT_STEALTH_DRIVER=patchright|legacy` (default `legacy`): the existing `playwright-extra` + `puppeteer-extra-plugin-stealth` stack, and a new `patchright`-backed path.
- ScrapFly fallback + cookie-harvest-then-HTTP (`impit`) unchanged.

## Why change

Modern anti-bot detects the **Runtime.enable CDP leak** in stock Playwright/Puppeteer. Mitigation: **Patchright** — a drop-in Playwright replacement that patches the CDP leak at the launch/binary level rather than injecting JS evasions like the stealth-plugin approach. (Camoufox — anti-detect Firefox — remains a known alternative, out of scope for this pilot.)

`rebrowser-patches`, previously considered alongside Patchright as a candidate for this same mitigation, is dropped from consideration: an independent benchmark (651 verdicts across 31 Cloudflare-protected targets, published 2026-05-13, updated 2026-07-12 — https://ianlpaterson.com/blog/anti-detect-browser-benchmark-patchright-nodriver-curl-cffi/) found `rebrowser-patches` now ties unpatched vanilla Playwright (24/29 OK), while Patchright is meaningfully ahead (25/29 OK). This is general Cloudflare-target evidence motivating the choice of Patchright over `rebrowser-patches` — it is not proof of Depop/Poshmark-specific efficacy, which remains unproven (see "Do not remove yet" below).

## Driver swap: wired (2026-07-18)

`PLAYWRIGHT_STEALTH_DRIVER=patchright|legacy` is a real, working env var. `resolveStealthDriver()` in `packages/core/src/platforms/playwright/browser.ts` reads it (warns and falls back to `legacy` on any unrecognized value, including the now-retired `rebrowser`), and both `launchStealthEphemeralBrowser()`/`launchStealthPersistentContext()` branch on the resolved driver — `patchright` is dynamically imported only when actually selected, so a broken/missing patchright install can only ever break the `patchright` path, never the default `legacy` path production runs today.

`scripts/verify-scrapers.ts` runs a `DRIVER_MATRIX = ["legacy", "patchright"]` loop for Depop and Poshmark specifically, producing one labeled report row per platform per driver (4 rows total for those two platforms) with its own posture capture (status code + screenshot) per row — independent of whether the platform's own scraper call succeeded, same posture-measurement principle as before. Depop's row is labeled `"n/a"` instead of the configured driver whenever its impit-first HTTP path succeeds without ever invoking a browser, so the matrix never falsely attributes a driver that never ran. eBay, Grailed, and Vestiaire continue to run once each, unmatrixed, since they either have no anti-bot surface (eBay, Grailed) or don't route through the stealth-browser driver for their primary path (Vestiaire).

Next: scheduled/automated matrix runs and `v_integration_daily` pass-rate reporting are still open — see fashion-monitor-research-frontier F4.

## Do not remove yet

`playwright-extra` + stealth plugin stays until **Patchright** passes live smoke on Depop and Poshmark. This is a hard requirement, not weakened by the driver swap being wired — wiring the swap makes the experiment runnable and truthfully labeled, it does not itself prove the gate is satisfied.
