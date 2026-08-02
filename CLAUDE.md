# fashion-monitor — execution routing

This file tells an AI coding agent where fashion-monitor code actually runs, so it doesn't build, test, or read live data in the wrong place.

> Rules that apply across all of Preston's home-lab repos (which user account runs each service, Mac-vs-desktop execution, the shared Ollama LLM broker, secrets handling, commit attribution, scraping/egress policy, and when to share a service vs. a library) live in
> `home-infra/CONVENTIONS.md`. This file holds only what's specific to fashion-monitor.

**The deploy target is the desktop machine, not this Mac checkout.** Fashion Monitor moved off the NAS on 2026-07-19, as part of the same NAS-to-desktop move made for the arr-stack, financial-pipeline, and media-stack repos. Docker images are built on this Mac and shipped to the desktop — this repo never builds on the deploy host itself:

```bash
make sync   # compose file, static config, grafana provisioning -> deploy host
make push   # docker save fashion-monitor/cli fashion-monitor/mcp-server | ssh ... docker load
make deploy # sync + push, then docker compose up -d on the deploy host
```

- **Deployed/running copy**: desktop Docker Compose stack, dedicated `fashionmonitor`
  service user, `/opt/docker/fashion-monitor` (see `Makefile` `DEPLOY_HOST`/`DEPLOY_PATH`).
- **Live data**: the desktop-mounted SQLite DB + `data/poshmark-profile` (persistent
  Playwright cookies, if/when created) — never present on this Mac checkout.
- The desktop has no bundled TLS proxy of its own for this app. The old NAS
  setup ran its own `proxy`/Caddyfile service, but that would conflict with the desktop's existing shared Caddy instance, which
  already owns host ports 80/443. So the dashboard is exposed directly on host port 3030 with
  plain HTTP (`COOKIE_SECURE` defaults to `false`). Wiring it into the existing
  `houseoflight.dev` Caddy instance for public HTTPS (the same pattern used by resale-inventory)
  is a future option, not yet done.
- **Scrape/score split (2026-07-19):** the pipeline is now two separate CLI entry points
  (`apps/cli/src/scrape.ts`, `apps/cli/src/score.ts`) instead of one combined `run.ts`. The
  `scraper` and `poshmark` Compose services route their traffic through home-infra's
  `scraper-egress` VPN tunnel (`network_mode: container:gluetun-scraper`) and never touch the LLM. The new `score` service stays
  off that VPN tunnel so it can reach the LAN's Ollama broker, and
  it reads whatever the scrape step left marked `PENDING` in the `seen_listings` table. The
  `gluetun-scraper` Compose project must already be running before `scraper` or `poshmark`
  start. `run.ts`/`run.js` still exists unchanged for local development or other non-split use.
  No cron or systemd timer is installed yet for scraper, poshmark, or score — that's a
  deliberate manual decision, not an oversight.
- Live scrapes are opt-in only (`pnpm run verify:scrapers`, `pnpm run test:live`). The default
  dev/test loop runs entirely against saved fixtures (see the `resale-platforms-reference`
  skill). Don't run live scrapers from this Mac clone casually — they hit real marketplaces.

If a task involves running the pipeline, checking real scored listings, or anything touching
the live database or Poshmark profile, route it to the NAS deploy, not this Mac clone.

See also: `fashion-monitor-resale-inventory-merge.md` (in the Obsidian vault, under
`Development/Research/`). Fashion Monitor stays a separate codebase from `resale-inventory`;
the two are connected only by a manual CSV export/import, not a shared service or a merged
app.
