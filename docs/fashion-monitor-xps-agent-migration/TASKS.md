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
**Status**: [ ] pending
**Files**: None
**Test**: see steps.md Step 4
**Depends on**: Task 3
**Parallelizable**: No
**Notes**: OPERATOR-RUN ONLY per CONVENTIONS.md §5 — contains ENCRYPTION_KEY (root secret, ADR-002) and other tokens. Never run through an agent tool call.

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
**Status**: [ ] pending
**Files**: None
**Test**: see steps.md Step 7
**Depends on**: None
**Parallelizable**: Yes
**Notes**:

### Task 8: Stop dashboard/mcp-server containers on desktop-agent
**Status**: [ ] pending
**Files**: None
**Test**: see steps.md Step 8
**Depends on**: Task 7 (soft: Task 2)
**Parallelizable**: No
**Notes**:

### Task 9: Create DB backup and capture source checksum/row count on desktop-agent
**Status**: [ ] pending
**Files**: None
**Test**: see steps.md Step 9
**Depends on**: Task 8
**Parallelizable**: No
**Notes**:

### Task 10: Transfer DB backup to xps-agent via checksummed temp path
**Status**: [ ] pending
**Files**: None
**Test**: see steps.md Step 10
**Depends on**: Task 9, Task 2
**Parallelizable**: No
**Notes**:

### Task 11: Verify checksum match and move DB into place on xps-agent
**Status**: [ ] pending
**Files**: None
**Test**: see steps.md Step 11
**Depends on**: Task 10
**Parallelizable**: No
**Notes**:

### Task 12: Bring up xps-agent containers (non-scraper only)
**Status**: [ ] pending
**Files**: None
**Test**: see steps.md Step 12
**Depends on**: Task 4, Task 11
**Parallelizable**: No
**Notes**:

### Task 13: Verify xps-agent deployment non-destructively
**Status**: [ ] pending
**Files**: None
**Test**: see steps.md Step 13
**Depends on**: Task 12
**Parallelizable**: No
**Notes**:

### Task 14: Install systemd timer/service on xps-agent
**Status**: [ ] pending
**Files**: None
**Test**: see steps.md Step 14
**Depends on**: Task 5, Task 13
**Parallelizable**: No
**Notes**:

### Task 15: Decommission desktop-agent containers and timer/service
**Status**: [ ] pending
**Files**: None
**Test**: see steps.md Step 15
**Depends on**: Task 13, Task 14
**Parallelizable**: No
**Notes**:

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
