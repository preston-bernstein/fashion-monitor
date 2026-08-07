# Tasks: Migrate fashion-monitor from desktop-agent to xps-agent

Generated from: docs/fashion-monitor-xps-agent-migration/ on 2026-08-07

## Status legend
- [ ] pending
- [>] in progress
- [x] done
- [!] blocked

## Tasks

### Task 1: Verify Makefile DEPLOY_HOST/DEPLOY_USER configuration
**Status**: [x] done
**Files**: Makefile (read-only verification)
**Test**: see steps.md Step 1
**Depends on**: None
**Parallelizable**: Yes
**Notes**: Confirmed `?=` placeholder syntax for DEPLOY_HOST/DEPLOY_USER/DEPLOY_PATH; `make -n sync/push DEPLOY_HOST=xps-agent DEPLOY_USER=agent` dry-run shows correct xps-agent targeting.

### Task 2: Verify xps-agent architecture and prepare OS account/directory permissions
**Status**: [x] done
**Files**: None (host-side setup only)
**Test**: see steps.md Step 2
**Depends on**: None
**Parallelizable**: No
**Notes**: xps-agent is x86_64. `fashionmonitor` user created (uid 994, OS-assigned). `agent` added to `fashionmonitor` group. `/opt/docker/fashion-monitor` is `2775 fashionmonitor:fashionmonitor`, `data/` is `750`. `gluetun-scraper` container confirmed present.

### Task 3: Run make sync and make push for xps-agent
**Status**: [x] done
**Files**: None
**Test**: see steps.md Step 3
**Depends on**: Task 1, Task 2
**Parallelizable**: No
**Notes**: `make sync` — files landed, no permission-denied (2775 dir fix confirmed working for unprivileged tar extraction). `make push` — buildx cross-platform build succeeded, both images loaded on xps-agent (`fashion-monitor/cli`, `fashion-monitor/mcp-server`). `docker compose config --quiet` correctly fails on missing GRAFANA_ADMIN_PASSWORD — expected, .env doesn't exist yet (Task 4).

### Task 4: Recreate .env on xps-agent
**Status**: [x] done
**Files**: None
**Test**: see steps.md Step 4
**Depends on**: Task 3
**Parallelizable**: No
**Notes**: OPERATOR-RUN ONLY per CONVENTIONS.md §5, executed by Preston. **Spec bug found and corrected live**: steps.md/plan.md assumed the live .env was at `data/.env` on desktop-agent — it's actually at the compose-project-root `/opt/docker/fashion-monitor/.env` (698 bytes: ENCRYPTION_KEY, GRAFANA_ADMIN_PASSWORD, ADMIN_EMAIL, ADMIN_PASSWORD, STEALTH_SIDECAR_URL), confirmed by grafana actually running off it. `data/.env` was a stale pre-reorg leftover (3 old Telegram/encryption vars, missing GRAFANA_ADMIN_PASSWORD). Same root-vs-data mismatch existed on the xps-agent destination side too — corrected with a same-host `mv` (no secret values passed through the agent session, only cross-host transfer is operator-gated). Final state verified: xps-agent `/opt/docker/fashion-monitor/.env`, 600 fashionmonitor:fashionmonitor, all 5 expected vars present (name-only check), `docker compose config --quiet` validates clean via sudo. Note for Step 12/deploy: `agent` cannot read this 600 file even as a `fashionmonitor` group member (600 blocks group read) — matches desktop-agent's own working setup, so compose operations against this file need `sudo`, not plain `agent`.

### Task 5: Commit systemd unit files to repo
**Status**: [x] done
**Files**: fashion-monitor-scraper-health.service, fashion-monitor-scraper-health.timer
**Test**: see steps.md Step 5
**Depends on**: None
**Parallelizable**: Yes
**Notes**: Shipped in PR #10 (commit fdb81e0), merged to main as 6d67ad2.

### Task 6: Add scrape profile gate to docker-compose.yml
**Status**: [x] done
**Files**: docker-compose.yml
**Test**: see steps.md Step 6
**Depends on**: None
**Parallelizable**: Yes
**Notes**: Shipped in PR #10. Verified locally: `docker compose config --services` excludes scraper/poshmark/score; `--profile scrape` includes them.

### Task 7: Stop desktop-agent's scraper-health timer
**Status**: [x] done
**Files**: None
**Test**: see steps.md Step 7
**Depends on**: None
**Parallelizable**: Yes
**Notes**: Stopped (inactive), still enabled — confirmed decommission is a separate later step.

### Task 8: Stop dashboard/mcp-server containers on desktop-agent
**Status**: [x] done
**Files**: None
**Test**: see steps.md Step 8
**Depends on**: Task 7 (soft: Task 2)
**Parallelizable**: No
**Notes**: No scraper/poshmark/score mid-run. dashboard/mcp-server stopped; grafana/ntfy left running as intended. Note: `agent` still can't `cd` into `/opt/docker/fashion-monitor` on desktop-agent (the pre-existing permission bug, out of scope for desktop-agent itself) — used `docker compose -f ... --project-directory ...` with `sudo` instead.

### Task 9: Create DB backup and capture source checksum/row count on desktop-agent
**Status**: [x] done
**Files**: None
**Test**: see steps.md Step 9
**Depends on**: Task 8
**Parallelizable**: No
**Notes**: `.backup` succeeded, checksum captured cleanly. Row count = 0 (`seen_listings` empty) — consistent with the already-known fact that the pipeline has never completed a successful scrape run (the whole reason the watchdog exists), not a new finding.

### Task 10: Transfer DB backup to xps-agent via checksummed temp path
**Status**: [x] done
**Files**: None
**Test**: see steps.md Step 10
**Depends on**: Task 9, Task 2
**Parallelizable**: No
**Notes**: Transfer OK, sizes matched (236K both sides).

### Task 11: Verify checksum match and move DB into place on xps-agent
**Status**: [x] done
**Files**: None
**Test**: see steps.md Step 11
**Depends on**: Task 10
**Parallelizable**: No
**Notes**: Checksums matched exactly. Moved into place, `600 fashionmonitor:fashionmonitor`.

### Task 12: Bring up xps-agent containers (non-scraper only)
**Status**: [x] done
**Files**: None
**Test**: see steps.md Step 12
**Depends on**: Task 4, Task 11
**Parallelizable**: No
**Notes**: **Third spec gap found and fixed live**: `config.yaml` must also exist inside `data/` (containers read `/data/config.yaml` via the `./data:/data` volume mount) — `make sync` only places it at the compose-project root. Desktop-agent has an undocumented manual second copy in `data/` (different mtime than the root copy) that nothing in the Makefile or spec captures. Replicated with a same-host `cp` (config.yaml isn't a secret, no gating needed). dashboard crash-looped on `cli.config.missing` until this was fixed + `docker compose restart dashboard` (plain `up -d` on an already-crash-looping container doesn't force a fresh restart cycle). All four services (dashboard, mcp-server, grafana, ntfy) confirmed `Up`; scraper/poshmark/score confirmed absent.

### Task 13: Verify xps-agent deployment non-destructively
**Status**: [x] done
**Files**: None
**Test**: see steps.md Step 13
**Depends on**: Task 12
**Parallelizable**: No
**Notes**: All checks pass. Container status: all 4 Up. DB read/row-count: matches baseline (0=0). Write probe: succeeded + rollback confirmed clean. HTTP: dashboard 200, ntfy 200, grafana 302→200 (normal `/`→`/login` redirect, not a failure). mcp-server hit the same config.yaml-in-data/ gap as dashboard (Task 12 note) — fixed by `docker compose restart mcp-server`, clean after. Zero scraper/poshmark/score/scraper-health containers created (excluding an unrelated `gluetun-scraper` substring false-match — that's Stage 1's VPN tunnel, already running before this migration). No new ntfy publish (`messages_published=0` in stats log). Row count re-checked post-verification, no side effects.

### Task 14: Install systemd timer/service on xps-agent
**Status**: [x] done
**Files**: None
**Test**: see steps.md Step 14
**Depends on**: Task 5, Task 13
**Parallelizable**: No
**Notes**: Installed, enabled, daemon-reloaded. `list-timers` shows it (next tick ~3h33m out). Service unit correctly invokes `docker compose --profile tools run --rm scraper-health`. Note: steps.md's own test for the service check (`grep -qi 'inactive\|failed'` expected to return false) is imprecise — a freshly-installed, never-triggered `Type=oneshot` correctly shows `Active: inactive (dead)` (not `failed`), which is healthy, not a fault. `Loaded` clean, `TriggeredBy` correctly links to the timer — real intent satisfied, test string just doesn't distinguish "never fired yet" from "failed."

### Task 15: Decommission desktop-agent containers and timer/service
**Status**: [x] done
**Files**: None
**Test**: see steps.md Step 15
**Depends on**: Task 13, Task 14
**Parallelizable**: No
**Notes**: `docker compose down` removed all 7 containers (dashboard/mcp-server/grafana/ntfy plus stopped one-shots scraper/poshmark/score that existed from prior manual runs). Timer disabled+stopped, both unit files removed, daemon-reloaded, `list-timers` confirms gone. DB files confirmed untouched (241664 bytes, mtime unchanged since the Task 9 backup) — the wildcard glob check in steps.md's own test (`fashion_monitor.db*`) false-negatives here since glob expansion happens client-side as unprivileged `agent` before `sudo` applies, and `agent` can't list the `750` dir; `sudo ls -la` (no glob) is the correct check and confirms the file is present and unmodified. Desktop-agent is now fully decommissioned for fashion-monitor. Per the rollback plan's cleanup window, DB files stay on desktop-agent for 24-48h+ before deletion, contingent on stable xps-agent operation.

### Task 16: Update fashion-monitor-run-and-operate skill doc
**Status**: [x] done
**Files**: .claude/skills/fashion-monitor-run-and-operate/SKILL.md
**Test**: see steps.md Step 16
**Depends on**: Task 14, Task 15 (documentation ordering only — content already written ahead of live cutover)
**Parallelizable**: Yes
**Notes**: Shipped in PR #10. Note: steps.md's own test string for AC12 has a pre-existing typo (`"installed** as a cron/timer"` vs actual `"**Not yet actually installed** as a cron/timer"` — bold wraps the whole phrase). Verified by manual diff review that the original sentence survived byte-for-byte unedited — intent satisfied, test string itself is wrong.

### Task 17: Update CLAUDE.md's stale deploy-host bullet
**Status**: [x] done
**Files**: CLAUDE.md
**Test**: see steps.md Step 17
**Depends on**: Task 14, Task 15 (documentation ordering only — content already written ahead of live cutover)
**Parallelizable**: Yes
**Notes**: Shipped in PR #10. Diff reviewed — only the "Deployed/running copy" bullet changed.

## Blocked / open

- **Unrelated pre-existing CI break discovered during PR #10**: `pnpm run test:e2e` fails with `SyntaxError: ... does not provide an export named 'depopTileExtractScript'`/`'poshmarkTileExtractScript'` and reports "No tests found" — present on `main` since at least commit 1eff72a (2026-08-03), masked there by an earlier `format:check` failure (also pre-existing, fixed in this PR). Not caused by this migration's changes (no diff touches `packages/core/src/platforms/{depop,poshmark}/extract.ts` or the e2e suite). `main` has no branch protection, so this didn't block merging PR #10, but the e2e suite has been non-functional across several `main` commits — flagged for Preston, not fixed here (out of migration scope, and touches live scraper extraction logic CLAUDE.md cautions against editing casually).
