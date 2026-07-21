# Requirements: Stealth Sidecar Migration

## Problem statement

fashion-monitor's Depop and Poshmark scrapers currently drive a homegrown TypeScript
Patchright stealth browser in-process (`packages/core/src/platforms/playwright/browser.ts`:
`resolveStealthDriver`, `launchStealthEphemeralBrowser`, `launchStealthPersistentContext`,
`closeStealthEphemeralBrowser`, `closeStealthPersistentContext`, `closeAllStealthBrowsers`),
built under PR #5 and specced at `docs/patchright-stealth-driver/`. scraper-commons now
ships an equivalent capability as a standalone FastAPI HTTP sidecar
(`src/scraper_commons/sidecar/`, `/v1` routes for contexts/pages/navigate/content/
screenshot/health), merged to `scraper-commons` main as of 2026-07-21. Maintaining two
independent stealth-browser implementations (one embedded in fashion-monitor, one shared
in scraper-commons) duplicates anti-detection logic that must be kept in sync across
repos, and it blocks fashion-monitor from picking up sidecar fixes/hardening without a
manual port. The person who owns this pain is whoever maintains fashion-monitor's
scrapers day to day (currently Preston, solo) — they are the one who has to remember to
patch two Patchright configurations every time a marketplace's bot-detection changes.
This migration replaces the in-process driver with HTTP calls to the sidecar and retires
the TS driver, leaving exactly one stealth-browser implementation in the home-lab
ecosystem, per the pattern already established for shared dependencies in ADR 0006.

## Users / stakeholders

- fashion-monitor scraper code (Depop scraper: `packages/core/src/platforms/depop/`;
  Poshmark scraper: `packages/core/src/platforms/poshmark/`) — the direct callers being
  migrated.
- fashion-monitor `scraper`/`poshmark` Docker Compose services — the deployed runtime
  that must launch, network, and supervise the sidecar alongside the Node scraper
  process.
- scraper-commons maintainers — own the sidecar's API surface and behavior; not
  modified by this feature, only consumed.
- Whoever operates the desktop deploy host — responsible for the sidecar process being
  up before `scraper`/`poshmark` compose services run, and for its logs/health surfaced
  in the existing Grafana/Loki/Promtail stack.
- Future scrapers added to fashion-monitor (eBay, Grailed, Vestiaire currently use
  other platform clients, not Patchright) — inherit the sidecar-calling pattern instead
  of the retired in-process one.

## Functional requirements

1. The system shall provide an HTTP client module in `packages/core` that wraps the
   sidecar's `/v1` routes (contexts, pages, navigate, content, screenshot, health) for
   use by scraper code, replacing direct imports of
   `packages/core/src/platforms/playwright/browser.ts`.
2. The system shall create a sidecar-backed context for the Poshmark scraper's
   persistent-profile flow (`packages/core/src/platforms/poshmark/scraper.ts`,
   currently `launchStealthPersistentContext`) so cookie/session persistence continues
   to work across scrape runs.
3. The system shall create a sidecar-backed ephemeral context for the Depop scraper's
   fallback flow (`packages/core/src/platforms/depop/playwright-fallback.ts`, currently
   `launchStealthEphemeralBrowser`) with no persisted profile across runs.
4. The system shall navigate to a target URL via the sidecar's navigate route and
   retrieve rendered page content via the sidecar's content route, replacing direct
   Playwright `page.goto()`/`page.content()` calls in the Depop and Poshmark scrapers.
5. The system shall close/release sidecar-held contexts when a scrape run completes or
   errors, so the sidecar does not accumulate orphaned browser contexts across runs.
6. The system shall surface sidecar HTTP errors (connection refused, non-2xx response,
   timeout) as typed errors distinguishable from scrape-parsing errors, so calling code
   and logs can tell "sidecar unreachable" apart from "listing page changed shape."
7. The system shall retry a sidecar call exactly once when the failure is a
   connect-level error (connection refused/reset, before any response is received),
   with no retry on a timeout or a non-2xx response, given the sidecar is a
   single-worker-thread service and a request that reached it may have already
   partially executed.
8. The system shall read the sidecar's base URL from the `STEALTH_SIDECAR_URL`
   environment variable, defaulting to `http://127.0.0.1:8000` if unset, so the Node
   scraper and the sidecar process can be pointed at each other without a code change.
9. The system shall remove `packages/core/src/platforms/playwright/browser.ts` and all
   its exports (`resolveStealthDriver`, `getEphemeralBrowserDriver`,
   `getStealthChromium`, `launchStealthPersistentContext`,
   `launchStealthEphemeralBrowser`, `closeStealthPersistentContext`,
   `closeStealthEphemeralBrowser`, `closeAllStealthBrowsers`,
   `resetStealthStateForTests`) once the sidecar path is verified end-to-end against
   both live scrapers, so the codebase carries exactly one stealth-driving
   implementation.
10. The system shall remove the Patchright dependency from `packages/core`'s
    `package.json` once no code path imports it, so the retired driver cannot be
    reintroduced by accident.
11. The system shall document the network-namespace requirement (sidecar must share
    `network_mode: container:gluetun-scraper` with `scraper`/`poshmark` for loopback
    reachability) but shall NOT add a `stealth-sidecar` service definition to
    `docker-compose.yml` that references a container image that does not yet exist —
    doing so would break `docker compose up` for the entire stack. Standing up the
    sidecar as a reachable containerized service on the desktop deploy host is an
    explicit cross-repo follow-up (home-infra ADR 0014/0015 owns shared-service
    deploy/attach wiring), tracked as a known gap, not resolved by this feature.
12. The system shall fail a scrape run's startup with a clear error (not a silent
    fallback to a different driver) when the sidecar's `/v1/health` route is
    unreachable or reports unhealthy, since there is no longer a second driver to fall
    back to.
13. The system shall preserve existing scrape output contracts (the shapes consumed
    downstream by dedupe/prefilter/scoring in the pipeline) so this migration changes
    only how a browser session is launched/driven, not what a completed scrape
    produces.

## Non-functional requirements

- Concurrency: the system shall NOT implement client-side concurrent/parallel calls to
  the sidecar from a single scraper invocation — each scraper drives at most one
  in-flight sidecar operation at a time, matching the sidecar's single-worker-thread
  model (max 1 concurrent op).
- Security: sidecar calls must stay on loopback / the isolated scraper-egress network
  namespace only; the sidecar has no auth or TLS by design, so no code path may expose
  or proxy it to a wider network.
- Compatibility: the migration must not change scraped-data shape or the pipeline's
  downstream consumption of it — this is a transport/launch-mechanism change only.
- Observability: sidecar-call failures must be distinguishable in logs from
  scrape-parsing failures, consistent with the existing Grafana/Loki/Promtail
  log-shipping already wired into the `scraper`/`poshmark` compose services.
- No parallel-running period: once the sidecar path is verified end-to-end, the legacy
  TS driver must be removed in the same change — not left dormant or feature-flagged
  indefinitely.

## Constraints

- Must integrate with scraper-commons' sidecar as built and merged (2026-07-21) — this
  feature does not modify the sidecar's API surface, only consumes it.
- Sidecar is local-loopback-only with no auth/TLS by design; this is a given property
  of the dependency, not something this feature can add to compensate for a wider
  network exposure.
- Must integrate with the existing `scraper`/`poshmark` Docker Compose services
  (`docker-compose.yml`), which run under `network_mode: container:gluetun-scraper`
  (home-infra's scraper-egress VPN tunnel) — the sidecar must be reachable from inside
  that same network namespace for loopback binding to work at all.
- Must integrate with the existing Depop scraper (`packages/core/src/platforms/depop/
  playwright-fallback.ts`) and Poshmark scraper (`packages/core/src/platforms/poshmark/
  scraper.ts`), the only two current callers of the TS stealth driver.
- Must preserve Poshmark's persistent-profile behavior (`data/poshmark-profile` cookie
  persistence) through whatever context/session concept the sidecar exposes.
- Mandated tech: the sidecar itself (FastAPI, Python, scraper-commons) is fixed by the
  feature description; fashion-monitor's side is a Node/TypeScript HTTP client only —
  no new browser-automation library is introduced in fashion-monitor.
- Follows the shared-dependency pattern already established in ADR 0006 (calling a
  shared local service instead of embedding the capability in-process).

## Out of scope

- Any change to the sidecar's implementation, API surface, or scraper-commons repo
  itself — this feature only adds a consumer in fashion-monitor.
- eBay, Grailed, and Vestiaire scrapers — they do not use the Patchright stealth driver
  today and are not touched by this migration.
- Adding authentication, TLS, or remote-network exposure to the sidecar — it stays
  loopback-only by design; if a future need for cross-host access arises, that is a
  separate feature.
- Changes to the pipeline stages downstream of scraping (dedupe, prefilter, scoring,
  alerting) — scrape output contracts are preserved, not redesigned.
- Standing up a scheduler/cron/systemd timer for `scraper`/`poshmark` — none exists
  today and this migration does not add one.
- Wiring the dashboard into public HTTPS (`houseoflight.dev` Caddy) — unrelated,
  already-tracked future work.
- A transition period running both the legacy TS driver and the sidecar path in
  parallel in production — the legacy driver is retired in the same change, once
  end-to-end verification passes.
- Building or shipping a container image for the sidecar itself, or wiring it into the
  desktop's docker-compose stack as a running, reachable service — that is
  home-infra's ADR 0014/0015 responsibility and scraper-commons' packaging
  responsibility, both explicit cross-repo follow-ups this feature does not resolve.
  This feature's docker-compose.yml changes are limited to adding the
  `STEALTH_SIDECAR_URL` env var and removing now-dead Playwright/Patchright
  artifacts — no new service definition.

## Acceptance criteria

1. Running the Depop scraper against a live target produces a scrape result via sidecar
   HTTP calls with no import of, or runtime dependency on,
   `packages/core/src/platforms/playwright/browser.ts`.
2. Running the Poshmark scraper against a live target produces a scrape result via
   sidecar HTTP calls, with cookie/session state persisted across two consecutive runs
   the same way the retired persistent-context flow did.
3. `packages/core/src/platforms/playwright/browser.ts` and its Patchright dependency no
   longer exist in the repo after this feature ships; `grep -r "resolveStealthDriver\|
   launchStealthEphemeralBrowser\|launchStealthPersistentContext" packages/` returns no
   matches outside historical docs.
4. With the sidecar process stopped, starting a scrape run for Depop or Poshmark fails
   within the client's single connect-attempt-plus-one-retry window (no multi-minute
   hang) with an error instance of `SidecarUnreachableError` or `SidecarResponseError`,
   not a generic Playwright/browser error and not a silent fallback.
5. A sidecar connection failure during a scrape produces a log entry using a distinct
   log event name/error class (`SidecarUnreachableError`/`SidecarResponseError`)
   separate from the log event used for a scrape-parsing failure (e.g. selector/
   tile-extraction failure), verifiable by inspecting captured log output for each
   failure mode.
6. (deferred, cross-repo follow-up): full desktop-deployed reachability of
   `scraper`/`poshmark` to a containerized sidecar cannot be verified by this feature
   alone and is explicitly out of this feature's completion bar; verification for THIS
   feature is: the migration works correctly against the sidecar run as a local process
   (`python scripts/run_sidecar.py` in scraper-commons) during development/
   CI-equivalent verification. Full production desktop reachability is verified once
   home-infra or scraper-commons ships the container image (separate follow-up,
   tracked in `home-infra/docs/plans/stealth-sidecar-rollout.md`).
7. Downstream pipeline stages (dedupe/prefilter/scoring) consume scrape output produced
   via the sidecar path with no code changes required on their side, confirmed by
   running the existing pipeline against sidecar-produced output.
8. No test, config, or runtime code path references a "driver" selection between
   Patchright/legacy and sidecar — only the sidecar path exists post-migration.
9. Two concurrent calls to acquire the same Poshmark persistent context (e.g. from
   overlapping process invocations) do not both create a duplicate sidecar context for
   the same profile path — the second caller either reuses the in-flight creation or is
   serialized behind it, verifiable by a unit test that fires two concurrent
   `getOrCreatePersistentContext` calls against a mocked slow-resolving client and
   asserts only one `createContext` HTTP call was made.
