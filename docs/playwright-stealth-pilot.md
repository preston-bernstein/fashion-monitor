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
4. Extend `scripts/verify-scrapers.ts` with status-code + screenshot regression checks per platform.

## Do not remove yet

`playwright-extra` + stealth plugin stays until a rebrowser pilot passes live smoke on Depop/Poshmark.
