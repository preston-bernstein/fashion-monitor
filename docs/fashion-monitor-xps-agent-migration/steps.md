# Steps: Migrate fashion-monitor from desktop-agent to xps-agent

## Prerequisites

- SSH access to both `desktop-agent` and `xps-agent` via agent user with sudo NOPASSWD
- Local `sqlite3` CLI (for row-count verification queries)
- Local `make` tool (for Makefile invocation)
- Confirmed that `xps-agent`'s `gluetun-scraper` container is running and healthy (per FR13 / plan's "Stage 1/2a")
- Confirmed that `/opt/docker/fashion-monitor` directory structure will be created on xps-agent by step 1
- Desktop-agent's fashion-monitor deploy is currently live and accessible at `/opt/docker/fashion-monitor`
- Git working tree is clean (or all migration commits are staged)

## Implementation steps

### Step 1: Verify Makefile DEPLOY_HOST/DEPLOY_USER configuration
**What**: Verify that the Makefile uses `DEPLOY_HOST` and `DEPLOY_USER` as operator-supplied environment variable placeholders (not hardcoded values), and confirm that passing `DEPLOY_HOST=xps-agent DEPLOY_USER=agent` produces the expected behavior per AC1.

**Files**: Makefile (read-only verification).

**Test**:
- `grep 'DEPLOY_HOST.*?=' Makefile` returns a line with `?=` placeholder syntax
- `grep 'DEPLOY_USER.*?=' Makefile` returns a line with `?=` placeholder syntax
- `make -n deploy DEPLOY_HOST=xps-agent DEPLOY_USER=agent 2>&1 | grep -q xps-agent` succeeds (dry-run shows xps-agent target, AC1)
- `make -n sync DEPLOY_HOST=xps-agent DEPLOY_USER=agent 2>&1 | head -5` contains xps-agent references
- `make -n push DEPLOY_HOST=xps-agent DEPLOY_USER=agent 2>&1 | head -5` succeeds without errors

**Depends on**: None.

**Parallelizable**: Yes.

---

### Step 2: Verify xps-agent architecture and prepare OS account/directory permissions
**What**: Confirm xps-agent's CPU architecture is `x86_64` (required for Playwright Chromium, per the skill doc's existing pre-flight note, which has never previously been checked for xps-agent specifically — FR3) before any build/deploy proceeds. Then create the `fashionmonitor` service user idempotently (no UID pinning — ownership is fixed by name via `chown`, not UID parity with desktop-agent), add `agent` to the `fashionmonitor` group, and set `/opt/docker/fashion-monitor` to `2775` (setgid, group-writable) while `data/` stays `750` (no group-write) — this is the corrected permission model plan.md now specifies, replacing UID-mirroring. It fixes a grounded bug: `agent` was never actually a member of the `fashionmonitor` group on desktop-agent, and the top-level dir there is `750` (no `other` access at all), so `make sync`'s unprivileged `tar` extraction cannot succeed as plain `agent` against either host's permissions as originally modeled. Also confirm xps-agent's `gluetun-scraper` container is present and reachable (folded in here from the now-dropped standalone health-check step — the only useful check it provided; the rest duplicated the Prerequisites section and had zero downstream dependents since nothing in this migration starts `scraper`/`poshmark`, FR19).

**Files**: None (host-side setup only).

**Test**:
- `ssh xps-agent "uname -m"` returns `x86_64` — halt here if not, before proceeding to Step 3 (FR3)
- `ssh xps-agent "id -u fashionmonitor >/dev/null 2>&1 || sudo useradd --system --no-create-home --shell /usr/sbin/nologin fashionmonitor"` then `ssh xps-agent "id fashionmonitor"` returns a valid uid/gid (OS-assigned, no pinned value expected)
- `ssh xps-agent "sudo usermod -aG fashionmonitor agent"` then `ssh xps-agent "groups agent"` includes `fashionmonitor`
- `ssh xps-agent "sudo mkdir -p /opt/docker/fashion-monitor/data && sudo chown -R fashionmonitor:fashionmonitor /opt/docker/fashion-monitor && sudo chmod 2775 /opt/docker/fashion-monitor && sudo chmod 750 /opt/docker/fashion-monitor/data"` then `ssh xps-agent "stat -c '%a %U:%G' /opt/docker/fashion-monitor"` returns `2775 fashionmonitor:fashionmonitor`
- `ssh xps-agent "stat -c '%a %U:%G' /opt/docker/fashion-monitor/data"` returns `750 fashionmonitor:fashionmonitor` (unchanged from desktop-agent's stricter model — `agent` gets read/traverse via group membership, not write)
- `ssh xps-agent "docker ps"` returns without permission errors (confirms `agent` user is in the docker group)
- `ssh xps-agent "docker ps --format '{{.Names}}' | grep -q gluetun-scraper"` confirms gluetun-scraper's container is present in xps-agent's docker namespace

**Depends on**: None.

**Parallelizable**: No.

---

### Step 3: Run make sync and make push for xps-agent
**What**: Synchronize docker-compose.yml, config.yaml, and other repo-tracked deployment files to xps-agent; build and push container images for the xps-agent architecture. Validate that the unprivileged `tar` extraction `make sync` runs (`ssh $(DEPLOY_USER)@$(DEPLOY_HOST) "tar xzf - -C $(DEPLOY_PATH)/"`, no `sudo`) actually succeeds under Step 2's new group-writable `2775` directory — not just that files exist afterward.

**Files**: None (files deployed to host, not tracked in repo).

**Test**:
- `make sync DEPLOY_HOST=xps-agent DEPLOY_USER=agent 2>&1 | tee /tmp/fm-sync-output.txt; echo "exit:$?"` shows `exit:0`, and `grep -qi 'permission denied' /tmp/fm-sync-output.txt` returns false (proves the unprivileged tar extraction actually succeeds as plain `agent`, not merely that the command was attempted)
- `ssh xps-agent "ls /opt/docker/fashion-monitor/docker-compose.yml /opt/docker/fashion-monitor/config.yaml"` confirms both files landed
- `make push DEPLOY_HOST=xps-agent DEPLOY_USER=agent 2>&1; echo "exit:$?"` shows `exit:0`
- `ssh xps-agent "docker images | grep fashion-monitor"` shows at least `dashboard`, `mcp-server`, `grafana`, `ntfy` images present locally
- `ssh xps-agent "docker compose -f /opt/docker/fashion-monitor/docker-compose.yml config --quiet"` succeeds without validation errors

**Depends on**: Step 1 (Makefile `DEPLOY_HOST`/`DEPLOY_USER` config verified), Step 2 (`fashionmonitor` user, `agent`'s group membership, and directory permissions must exist).

**Parallelizable**: No.

---

### Step 4: Recreate .env on xps-agent
**What**: Transfer the `.env` file (containing `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `ENCRYPTION_KEY`, `GRAFANA_ADMIN_PASSWORD`, and other secrets) from desktop-agent to xps-agent using a direct ssh-to-ssh pipe, never staging it locally and never printing values.

**Files**: None (`.env` is gitignored on both hosts).

**Test**:
- `ssh desktop-agent "sudo cat /opt/docker/fashion-monitor/data/.env" | ssh xps-agent "sudo -u fashionmonitor tee /opt/docker/fashion-monitor/data/.env >/dev/null"` completes with exit code 0
- `ssh xps-agent "sudo chmod 600 /opt/docker/fashion-monitor/data/.env"` completes with exit code 0
- `ssh xps-agent "test -f /opt/docker/fashion-monitor/data/.env && wc -l /opt/docker/fashion-monitor/data/.env"` confirms `.env` exists and has content
- `ssh xps-agent "grep -c '^TELEGRAM_BOT_TOKEN=' /opt/docker/fashion-monitor/data/.env"`, `ssh xps-agent "grep -c '^ENCRYPTION_KEY=' /opt/docker/fashion-monitor/data/.env"`, and `ssh xps-agent "grep -c '^GRAFANA_ADMIN_PASSWORD=' /opt/docker/fashion-monitor/data/.env"` each return `1` (name-presence only — never echo values, per the "Never expose secret values" NFR)
- `ssh xps-agent "stat -c '%a' /opt/docker/fashion-monitor/data/.env"` returns `600`

**Depends on**: Step 3 (deploy directory must exist).

**Parallelizable**: No.

---

### Step 5: Commit systemd unit files to repo
**What**: Create and commit two new systemd unit files (`fashion-monitor-scraper-health.service` and `fashion-monitor-scraper-health.timer`) to the repository at the repo root. These are currently hand-installed on desktop-agent but must be tracked in git.

**Files**: `fashion-monitor-scraper-health.service`, `fashion-monitor-scraper-health.timer` (repo root).

**Test**:
- `git ls-files | grep fashion-monitor-scraper-health` returns both filenames
- `git log --oneline -- fashion-monitor-scraper-health.service fashion-monitor-scraper-health.timer | head -1` shows a recent commit
- `cat fashion-monitor-scraper-health.service | grep -A 2 '\[Service\]' | grep -q 'Type=oneshot'` confirms correct content
- `cat fashion-monitor-scraper-health.timer | grep -A 2 '\[Timer\]' | grep -q 'OnCalendar='` confirms timer content is present

**Depends on**: None.

**Parallelizable**: Yes.

---

### Step 6: Add scrape profile gate to docker-compose.yml
**What**: Add `profiles: ["scrape"]` to the `scraper`, `poshmark`, and `score` service definitions in `docker-compose.yml` (FR21). These three currently have `restart: "no"` but no `profiles:` gate, so any bare `docker compose up -d` — including a future `make deploy` run by an operator or agent unaware of Risk area #1 — starts a real scrape as a side effect. This closes that gap for every future deploy, not just this cutover's manually-scoped bring-up (Step 12). Future intentional scraper/poshmark/score runs use `docker compose --profile scrape run --rm <service>` instead of a bare `docker compose run --rm <service>` — the same invocation shape `scraper-health` already uses under `profiles: ["tools"]`.

**Files**: `docker-compose.yml`.

**Test**:
- `docker compose config | grep -B5 'profiles:' | grep -A5 -E 'scraper:|poshmark:|score:'` shows each of the three services carries `profiles: [scrape]` (or equivalent) in the resolved config
- `docker compose up -d 2>&1 && docker compose ps --format '{{.Service}}'` (invoked with no service names) does not list `scraper`, `poshmark`, or `score` — confirms the profile gate actually prevents them from starting on a bare `up -d`
- `docker compose --profile scrape config --services | grep -qE '^(scraper|poshmark|score)$'` confirms all three still resolve under the profile-scoped invocation

**Depends on**: None.

**Parallelizable**: Yes.

---

### Step 7: Stop desktop-agent's scraper-health timer
**What**: Stop (not disable/remove) desktop-agent's `fashion-monitor-scraper-health.timer` so it cannot fire and write to the database mid-backup. Disabling/uninstalling it is deferred to decommission (Step 15, FR17) — this step only pauses it (FR5).

**Files**: None.

**Test**:
- `ssh desktop-agent "sudo systemctl stop fashion-monitor-scraper-health.timer"` completes with exit code 0
- `ssh desktop-agent "sudo systemctl is-active fashion-monitor-scraper-health.timer"` returns `inactive`
- `ssh desktop-agent "sudo systemctl is-enabled fashion-monitor-scraper-health.timer"` still returns `enabled` (confirms it was only stopped, not disabled — decommission is a separate, later step)

**Depends on**: None.

**Parallelizable**: Yes.

---

### Step 8: Stop dashboard/mcp-server containers on desktop-agent
**What**: Stop the two containers that hold the DB open, out of caution — `.backup` (Step 9) is documented safe against a live writer per SQLite's Online Backup API, so this isn't strictly required, but it's a rare, operator-attended cutover where a few seconds of downtime costs nothing and removes any dependency on retry-under-contention behavior working exactly as documented on this SQLite build. Confirm `scraper`/`poshmark`/`score` aren't mid-run first — they're `restart: "no"` one-shots not normally running between manual invocations; if one is mid-run, wait for it to exit rather than killing it.

**Files**: None.

**Test**:
- `ssh desktop-agent "cd /opt/docker/fashion-monitor && docker compose ps --format '{{.Service}} {{.Status}}' | grep -E '^(scraper|poshmark|score) '"` returns no output; if it does, wait for the container to exit before proceeding rather than killing it
- `ssh desktop-agent "cd /opt/docker/fashion-monitor && sudo -u fashionmonitor docker compose stop dashboard mcp-server"` completes with exit code 0
- `ssh desktop-agent "cd /opt/docker/fashion-monitor && docker compose ps --format '{{.Service}} {{.Status}}' | grep -E '^(dashboard|mcp-server) '"` shows neither service in an `Up` state (positive-assertion check against the resulting status string)

**Depends on**: Step 7 (scraper-health timer must already be stopped, so it can't race this container stop). Soft ordering dependency (operator judgment, not a hard gate): Step 2 — desktop-agent's live service should not be taken down before xps-agent's host-prep is confirmed viable, so a fallback host remains ready if this cutover needs to pause.

**Parallelizable**: No.

---

### Step 9: Create DB backup and capture source checksum/row count on desktop-agent
**What**: Take the single-file consistent snapshot with sqlite3's `.backup` command (SQLite's Online Backup API — one complete, consistent file in one step, replacing the old WAL-checkpoint-then-copy-three-files approach). Capture its SHA256 checksum with stderr included, so a missing/unreadable file's error is captured in the saved record instead of silently dropped. Also capture the current `seen_listings` row count as the fallback comparison baseline Step 13 will re-derive and diff against.

**Files**: None (files copied to `/tmp` on desktop-agent; checksum/row-count captured locally for this session).

**Test**:
- `ssh desktop-agent "sudo -u fashionmonitor sqlite3 /opt/docker/fashion-monitor/data/fashion_monitor.db '.backup /tmp/fashion_monitor.db.backup'"` completes with exit code 0
- `ssh desktop-agent "sudo sha256sum /tmp/fashion_monitor.db.backup" > /tmp/fm-source-checksum.txt 2>&1` and `cat /tmp/fm-source-checksum.txt` shows one line in `sha256sum` format with no error text
- `ssh desktop-agent "sudo -u fashionmonitor sqlite3 /opt/docker/fashion-monitor/data/fashion_monitor.db 'SELECT COUNT(*) FROM seen_listings;'" > /tmp/fm-source-rowcount.txt` and `cat /tmp/fm-source-rowcount.txt` shows a single integer

**Depends on**: Step 8 (containers stopped).

**Parallelizable**: No.

---

### Step 10: Transfer DB backup to xps-agent via checksummed temp path
**What**: `set -o pipefail`, then transfer the one backup file to a `.tmp` path on xps-agent — never directly over the live destination path, so a dropped connection leaves a leftover `.tmp` file instead of a truncated production DB — via an ssh|ssh pipe, checking the exit status of both sides of the pipe.

**Files**: None.

**Test**:
```bash
set -o pipefail
ssh desktop-agent "sudo cat /tmp/fashion_monitor.db.backup" \
  | ssh xps-agent "sudo -u fashionmonitor tee /opt/docker/fashion-monitor/data/fashion_monitor.db.tmp >/dev/null"
[[ ${PIPESTATUS[0]} -eq 0 && ${PIPESTATUS[1]} -eq 0 ]] || { echo "TRANSFER FAILED -- STOP"; exit 1; }
```
completes without printing `TRANSFER FAILED -- STOP`
- `ssh xps-agent "ls -lh /opt/docker/fashion-monitor/data/fashion_monitor.db.tmp"` shows the file present, with a size matching desktop-agent's `/tmp/fashion_monitor.db.backup`

**Depends on**: Step 9 (backup file must exist), Step 2 (host-prep — the `fashionmonitor` user and `/opt/docker/fashion-monitor/data` directory this writes into must already exist with correct ownership).

**Parallelizable**: No.

---

### Step 11: Verify checksum match and move DB into place on xps-agent
**What**: Checksum the temp file on xps-agent (stderr included, same as Step 9). Run a SCRIPTED gate comparing hashes only — halting on any mismatch instead of leaving it to a human to eyeball two `sha256sum` outputs. Only on a checksum match, atomically `mv` the temp file into place (same filesystem) and fix its mode to `600`.

**Files**: None.

**Test**:
- `ssh xps-agent "sudo sha256sum /opt/docker/fashion-monitor/data/fashion_monitor.db.tmp" > /tmp/fm-dest-checksum.txt 2>&1` and `cat /tmp/fm-dest-checksum.txt` shows one line, no error text
```bash
diff <(awk '{print $1}' /tmp/fm-source-checksum.txt) <(awk '{print $1}' /tmp/fm-dest-checksum.txt) \
  || { echo "CHECKSUM MISMATCH -- STOP"; exit 1; }
```
returns no differences and does not print `CHECKSUM MISMATCH -- STOP`
- `ssh xps-agent "sudo -u fashionmonitor mv /opt/docker/fashion-monitor/data/fashion_monitor.db.tmp /opt/docker/fashion-monitor/data/fashion_monitor.db && sudo chmod 600 /opt/docker/fashion-monitor/data/fashion_monitor.db"` completes with exit code 0
- `ssh xps-agent "stat -c '%a %U:%G' /opt/docker/fashion-monitor/data/fashion_monitor.db"` returns `600 fashionmonitor:fashionmonitor`

**Remediation on checksum mismatch**: delete the partial `.tmp` file on xps-agent (`ssh xps-agent "sudo rm -f /opt/docker/fashion-monitor/data/fashion_monitor.db.tmp"`) and retry from Step 9 (a fresh `.backup` snapshot) — do not retry Step 10 against a `.tmp` file that may already be partially written from the failed attempt.

**Depends on**: Step 10.

**Parallelizable**: No.

---

### Step 12: Bring up xps-agent containers (non-scraper only)
**What**: Start the four long-lived services on xps-agent (`dashboard`, `mcp-server`, `grafana`, `ntfy`) using a scoped docker compose command. Do **not** run bare `make deploy`, which would also start `scraper`, `poshmark`, and `score` (violating FR13). This is a manual, single-step bring-up with named services only.

**Files**: None.

**Test**:
- `ssh xps-agent "cd /opt/docker/fashion-monitor && docker compose up -d dashboard mcp-server grafana ntfy"` completes with exit code 0
```bash
ssh xps-agent "cd /opt/docker/fashion-monitor && for svc in dashboard mcp-server grafana ntfy; do \
  status=\$(docker compose ps --format '{{.Service}} {{.Status}}' | grep \"^\$svc \"); \
  echo \"\$status\" | grep -q 'Up' || echo \"FAIL: \$svc not Up (\$status)\"; \
done"
```
prints no `FAIL:` lines — a positive assertion per service, replacing the old fragile `grep -q -v running` double-negative
- `ssh xps-agent "cd /opt/docker/fashion-monitor && docker compose ps --format '{{.Service}}' | grep -E '^(scraper|poshmark|score)$'"` returns no output (scraper services are not started; also enforced by Step 6's profile gate)

**Depends on**: Step 4 (`.env` recreated), Step 11 (DB moved into place on xps-agent).

**Parallelizable**: No.

---

### Step 13: Verify xps-agent deployment non-destructively
**What**: Perform a comprehensive health check of the xps-agent deployment without triggering any scraper, poshmark, score, or scraper-health container invocation. Check container health status, verify direct database read AND write capability, confirm HTTP reachability for dashboard/grafana/ntfy (with an explicit state+log check for mcp-server instead, since it's SSE-based and a trivial curl check is impractical for it specifically), concretely re-derive and compare the row count against Step 9's baseline, and confirm no new ntfy alert was dispatched during the verification window.

**Files**: None.

**Test**:
- `ssh xps-agent "cd /opt/docker/fashion-monitor && docker compose ps --format '{{.Service}} {{.Status}}'"` shows `Up` (or `healthy`) for `dashboard`, `mcp-server`, `grafana`, `ntfy` — no `exited`/`unhealthy`
- `ssh xps-agent "sudo -u fashionmonitor sqlite3 /opt/docker/fashion-monitor/data/fashion_monitor.db 'SELECT COUNT(*) FROM seen_listings;'"` returns a number (confirms DB is readable)
- **Row-count comparison (concrete, re-derives and diffs Step 9's baseline)**: `diff /tmp/fm-source-rowcount.txt <(ssh xps-agent "sudo -u fashionmonitor sqlite3 /opt/docker/fashion-monitor/data/fashion_monitor.db 'SELECT COUNT(*) FROM seen_listings;'")` returns no differences
- **Write probe (FR9/AC7)**: `ssh xps-agent "sudo -u fashionmonitor sqlite3 /opt/docker/fashion-monitor/data/fashion_monitor.db 'BEGIN; CREATE TABLE IF NOT EXISTS __migration_write_probe__ (x INTEGER); INSERT INTO __migration_write_probe__ VALUES (1); ROLLBACK;'"` completes with exit code 0 and no error output (proves the migrated DB is actually writable under the host UID matching the bind-mounted file's ownership, not just readable); then `ssh xps-agent "sudo -u fashionmonitor sqlite3 /opt/docker/fashion-monitor/data/fashion_monitor.db \"SELECT name FROM sqlite_master WHERE name='__migration_write_probe__';\""` returns empty (confirms the rollback left no permanent change)
- `curl -s http://10.0.0.244:3030 -w '%{http_code}' -o /dev/null | grep -q '^2'` (dashboard, port 3030) returns a 2xx
- `curl -s http://10.0.0.244:3001 -w '%{http_code}' -o /dev/null | grep -q '^2'` (grafana, port 3001) returns a 2xx
- `curl -s http://10.0.0.244:8282 -w '%{http_code}' -o /dev/null | grep -q '^2'` (ntfy, port 8282) returns a 2xx
- **mcp-server (SSE-based — a trivial curl check is impractical for it specifically; this is intentionally a state+log check, not an HTTP probe)**: `ssh xps-agent "cd /opt/docker/fashion-monitor && docker compose ps mcp-server --format '{{.Status}}'"` shows `Up`, and `ssh xps-agent "docker compose logs mcp-server --since 5m 2>&1 | grep -qi error"` returns false
- `ssh xps-agent "docker compose logs dashboard --since 5m 2>&1 | grep -qi error"` returns false
- Zero scraper invocation: `ssh xps-agent "docker ps -a --format '{{.Names}} {{.CreatedAt}}' | grep -E 'scraper|poshmark|score|scraper-health'"` returns no containers created during this verification window
- **No new ntfy alert dispatched (NFR)**: note the timestamp Step 12 completed as `$VERIFY_START`, then `ssh xps-agent "docker compose logs ntfy --since \"$VERIFY_START\" 2>&1 | grep -i publish"` returns no matches for the fashion-monitor topic — confirms no new message was dispatched during the verification window
- No new rows as a side effect of verification itself: re-run the row-count comparison command above and confirm it still returns no differences

**Depends on**: Step 12.

**Parallelizable**: No.

---

### Step 14: Install systemd timer/service on xps-agent
**What**: Deploy the committed `fashion-monitor-scraper-health.service` and `fashion-monitor-scraper-health.timer` files from the repo to xps-agent's `/etc/systemd/system/`, enable and start the timer, then verify it is listed as active.

**Files**: None (files copied to host, not new repo files; the source files are from Step 5).

**Test**:
- `ssh xps-agent "sudo systemctl list-timers | grep fashion-monitor-scraper-health"` returns a line with the timer name, next activation time, and last trigger time
- `ssh xps-agent "sudo systemctl status fashion-monitor-scraper-health.timer | grep -q 'active (waiting)'"` confirms the timer is enabled and waiting
- `ssh xps-agent "cat /etc/systemd/system/fashion-monitor-scraper-health.service | grep -q 'docker compose.*scraper-health'"` confirms the service unit invokes the correct command
- `ssh xps-agent "sudo systemctl status fashion-monitor-scraper-health.service 2>&1 | grep -qi 'inactive\|failed'"` returns false (the service itself is not running continuously; it is a oneshot and will run on the timer's schedule)

**Depends on**: Step 5 (unit files committed), Step 13 (verification must pass before installing the replacement watchdog).

**Parallelizable**: No.

---

### Step 15: Decommission desktop-agent containers and timer/service
**What**: Stop and remove the four long-lived services (`dashboard`, `mcp-server`, `grafana`, `ntfy`) on desktop-agent. Disable and uninstall the hand-installed `fashion-monitor-scraper-health.timer` and `.service` units. Do **not** delete the DB files themselves on desktop-agent; they remain on disk as a backup until explicit confirmation that xps-agent is stable (see Rollback plan).

**Files**: None.

**Test**:
- `ssh desktop-agent "cd /opt/docker/fashion-monitor && docker compose down"` completes with exit code 0
- `ssh desktop-agent "docker compose ps 2>&1 | wc -l"` returns 1 (header only, no containers)
- `ssh desktop-agent "sudo systemctl disable fashion-monitor-scraper-health.timer && sudo systemctl stop fashion-monitor-scraper-health.timer"` succeeds
- `ssh desktop-agent "sudo rm /etc/systemd/system/fashion-monitor-scraper-health.{service,timer}"` removes both files
- `ssh desktop-agent "sudo systemctl daemon-reload"` reloads systemd config
- `ssh desktop-agent "sudo systemctl list-timers | grep fashion-monitor-scraper-health"` returns no results
- `ssh desktop-agent "ls /opt/docker/fashion-monitor/data/fashion_monitor.db*"` still shows the backup source files present and untouched (for rollback/backup)

**Depends on**: Step 13 (xps-agent verification must pass), Step 14 (xps-agent's replacement `fashion-monitor-scraper-health.timer`/`.service` must be confirmed installed and active — this closes the window where neither host would have a working watchdog).

**Parallelizable**: No.

---

### Step 16: Update fashion-monitor-run-and-operate skill doc
**What**: Update the `.claude/skills/fashion-monitor-run-and-operate/SKILL.md` documentation to reflect the new deploy target (xps-agent) and remove stale desktop-agent references. **Add** a new row to the docker-compose service-map table for `scraper-health` (profile `tools`, on-demand) and **add** a new subsection documenting the watchdog timer's install command and how to verify it (`systemctl list-timers`), plus the new unit files' repo paths (FR8/AC8). Do **not** edit the existing "**Not yet actually installed** as a cron/timer" sentence — it describes `scraper`/`poshmark`/`score`'s own scrape-execution scheduling, not the scraper-health watchdog, remains accurate, and must survive this edit verbatim and textually distinct from the new watchdog documentation (FR14, AC12).

**Files**: `.claude/skills/fashion-monitor-run-and-operate/SKILL.md`.

**Test**:
- `grep -i "xps-agent" .claude/skills/fashion-monitor-run-and-operate/SKILL.md | grep -q "deploy.*target"` confirms xps-agent is documented as the deploy target
- `grep -i "desktop" .claude/skills/fashion-monitor-run-and-operate/SKILL.md | grep -v "migration\|historical\|before"` returns no results (no stale desktop references, excluding migration-note context)
- `grep -q "fashion-monitor-scraper-health" .claude/skills/fashion-monitor-run-and-operate/SKILL.md` confirms the committed unit files are mentioned in a new subsection
- `grep -q "systemctl.*enable\|install" .claude/skills/fashion-monitor-run-and-operate/SKILL.md` confirms installation/verification instructions are present
- `grep -F "Not yet actually installed** as a cron/timer" .claude/skills/fashion-monitor-run-and-operate/SKILL.md` still matches — confirms the existing scraper/poshmark/score scheduling sentence survived this edit verbatim (AC12)
- **Manual review checkpoint (not scriptable — a human judgment call, not a pass/fail test)**: `git diff .claude/skills/fashion-monitor-run-and-operate/SKILL.md` — read the full diff to confirm the changes are coherent, additive where intended (the new service-map row and watchdog subsection), and don't touch the preserved sentence above

**Depends on**: Step 14 (install timer on xps-agent — documents its existence), Step 15 (decommission desktop-agent — documents its removal). Both are documented by this step, not just decommission.

**Parallelizable**: Yes.

---

### Step 17: Update CLAUDE.md's stale deploy-host bullet
**What**: Update CLAUDE.md's single stale "**Deployed/running copy**: desktop Docker Compose stack, dedicated `fashionmonitor` service user, `/opt/docker/fashion-monitor`..." bullet to reference xps-agent instead of desktop, so AI agents consulting this repo aren't misdirected to a stale host. This is a narrowly-scoped, single-bullet edit — everything else in CLAUDE.md stays untouched (out of scope per requirements).

**Files**: `CLAUDE.md` (repo root).

**Test**:
- `grep -i "Deployed/running copy" CLAUDE.md | grep -q "xps-agent"` confirms the bullet now points at xps-agent
- **Manual review checkpoint (not scriptable — a human judgment call, not a pass/fail test)**: `git diff CLAUDE.md` — read the full diff to confirm it touches only the one "Deployed/running copy" bullet and nothing else in the file
- `grep -ic "desktop" CLAUDE.md` — any remaining hits should be reviewed manually to confirm none are stale deploy-target references (the file may legitimately mention "desktop" elsewhere in unrelated context; this migration is scoped to the one bullet only)

**Depends on**: Step 14, Step 15 (documents the final, confirmed cutover state — same reasoning as Step 16).

**Parallelizable**: Yes.

---

## Rollback plan

**Steps 1–2 (Config verification, host-prep):** Reversible. Step 1 is read-only. Step 2's host-side changes can be cleaned up by removing `agent` from the `fashionmonitor` group, removing the `fashionmonitor` user, and deleting `/opt/docker/fashion-monitor` on xps-agent, or left in place as prepared state for a retry.

**Step 3 (make sync/push):** Reversible — re-run after fixing the underlying issue. **Note:** a partial or superseded `make push` run can leave built docker images in xps-agent's local image store even after a rollback; this is low risk (disk usage only, no running containers) but currently unaddressed by any cleanup step — prune manually with `docker image prune` on xps-agent if it becomes a concern.

**Step 4 (.env):** Reversible. If the transferred `.env` is wrong or incomplete, delete it (`ssh xps-agent "sudo rm /opt/docker/fashion-monitor/data/.env"`) and retry Step 4.

**Step 5 (commit unit files):** Reversible via git. If not yet pushed, the commit can be amended or reverted.

**Step 6 (docker-compose profiles gate):** Reversible via git. Revert the `docker-compose.yml` change if the profile gate causes unexpected issues with a future intentional scrape invocation.

**Step 7 (stop scraper-health timer):** Reversible. If the migration is aborted before Step 15 (decommission), restart desktop-agent's timer: `ssh desktop-agent "sudo systemctl start fashion-monitor-scraper-health.timer"` — it was only stopped, never disabled, so a plain start is sufficient to resume its normal schedule.

**Step 8 (stop desktop-agent containers):** Reversible. If the migration is aborted before Step 15, restart the two containers: `ssh desktop-agent "cd /opt/docker/fashion-monitor && sudo -u fashionmonitor docker compose start dashboard mcp-server"`.

**Steps 9–11 (DB backup, transfer, checksum-gate-and-move):** Fully reversible. Desktop-agent's original `fashion_monitor.db`, `fashion_monitor.db-shm`, and `fashion_monitor.db-wal` files are never touched by these steps — only a `.backup` snapshot is read from them. If Step 10 (transfer) or Step 11 (checksum gate) fails or is incomplete, follow the remediation note in Step 11 (delete the `.tmp` file on xps-agent, retry from Step 9's fresh `.backup`) — do not assume the source DB is now inconsistent; a failed backup/transfer attempt never touches it. **Desktop-agent's original DB files must not be deleted or overwritten at any point during or after the copy — they are the rollback/backup copy until xps-agent is confirmed stable and operational.**

**Step 12 (Bring up xps-agent):** Reversible. If containers fail to start, run `docker compose down` on xps-agent, diagnose the issue (e.g., missing secrets in `.env`, DB read errors), and retry Step 12. Desktop-agent's containers remain stopped (since Step 8) but can be restarted per Step 8's rollback if needed to serve the live deploy again while troubleshooting.

**Step 13 (Verification):** Not destructive. If verification fails (e.g., health check fails, DB query times out, HTTP request fails, write probe fails), troubleshoot the xps-agent containers, fix the issue, and re-run Step 13. Do not proceed to Step 14/15 until Step 13 fully passes — this is the gate that decides whether to commit to the xps-agent cutover.

**Step 14 (Install timer/service):** Reversible. If the timer/service installation is incorrect (e.g., wrong `WorkingDirectory` or `ExecStart`), uninstall it (`systemctl disable`, remove files, `daemon-reload`) and retry with corrected content.

**Step 15 (Decommission):** Point of no return for active services. Once `docker compose down` runs on desktop-agent, the desktop-agent deploy is offline. If xps-agent's deployment develops issues after this point, restart desktop-agent's containers using the same explicitly-scoped command as the cutover step (Step 12) — `ssh desktop-agent "cd /opt/docker/fashion-monitor && docker compose up -d dashboard mcp-server grafana ntfy"`, named services only — never an unscoped `docker compose up -d`, which would also start `scraper`/`poshmark`/`score` as a side effect (the exact landmine the rest of this plan avoids) — and troubleshoot xps-agent in parallel. **Desktop-agent's DB files remain untouched and available as a restore point if needed.**

**After Step 15 — Cleanup window (Desktop-agent DB files):** Desktop-agent's original `fashion_monitor.db`, `fashion_monitor.db-shm`, and `fashion_monitor.db-wal` files can be considered disposable **only after**:
1. Step 15 (decommissioning) has been executed.
2. At least 24–48 hours have elapsed with xps-agent running the live deploy without issues (operator's judgment).
3. A final row-count query confirms the xps-agent DB row counts remain stable and match the captured pre-copy value.

Only after all three conditions are met should `rm /opt/docker/fashion-monitor/data/fashion_monitor.db*` be run on desktop-agent.

**Steps 16–17 (Update docs):** Reversible. If documentation changes are incorrect, revert the relevant file (`.claude/skills/fashion-monitor-run-and-operate/SKILL.md` or `CLAUDE.md`) via git and re-edit.

**All other steps:** All steps reversible via git for repo changes, or by manual cleanup of host-side state (undoing container starts, removing deployed files, etc.).
