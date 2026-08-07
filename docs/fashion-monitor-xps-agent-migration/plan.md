# Plan: Migrate fashion-monitor from desktop-agent to xps-agent

## Approach
This is a host-cutover, not a code change: the Makefile's `DEPLOY_HOST`/`DEPLOY_USER` are already operator-supplied env vars with placeholder defaults (`?= YOUR_DEPLOY_HOST`), so FR1 is satisfied by invocation (`DEPLOY_HOST=xps-agent DEPLOY_USER=agent`), not a repo edit. The only repo changes are two new committed systemd unit files (currently hand-installed and uncommitted on desktop-agent) and a doc refresh. The live-data move is a manual, ordered runbook — pause the desktop-agent scraper-health timer, take a consistent single-file snapshot with SQLite's own `.backup` command (safe against a live writer per its Online Backup API semantics, so stopping `dashboard`/`mcp-server` first is no longer strictly required — the plan keeps that stop as a belt-and-suspenders precaution; see the DB migration mechanism section), transfer that one file to a checksummed temp path, gate the move into place on a checksum match, verify (including a write probe), then cut over — because this is a one-time operator-run migration, not a recurring operation, so a permanent migration script would be gold-plating.

## Architecture
```
BEFORE                                          AFTER
desktop-agent (agent user, docker group)        xps-agent (agent user, docker group)
  /opt/docker/fashion-monitor  [fashionmonitor]   /opt/docker/fashion-monitor  [fashionmonitor, new]
    docker-compose.yml, config.yaml, grafana/       docker-compose.yml, config.yaml, grafana/  (make sync)
    data/.env  (secrets)                            data/.env  (recreated by hand, FR12)
    data/fashion_monitor.db{,-shm,-wal}  LIVE  ───▶  data/fashion_monitor.db{,-shm,-wal}  LIVE
    dashboard mcp-server grafana ntfy  (running)     dashboard mcp-server grafana ntfy  (running)
    fashion-monitor-scraper-health.timer/.service    fashion-monitor-scraper-health.timer/.service
      (hand-installed, uncommitted)                    (installed from repo-committed unit files)
    scraper/poshmark ── network_mode:                scraper/poshmark ── network_mode:
      container:gluetun-scraper ──X (stale/gone)        container:gluetun-scraper ──✓ (healthy, FR13,
                                                          already deployed per Stage 1/2a)
```
Cutover order (single ordered handoff — no dual-live window, FR9/FR11):
1. **Prepare xps-agent** — confirm `ssh xps-agent "uname -m"` returns `x86_64` (Playwright Chromium requires it, per SKILL.md's existing pre-flight note, which has never previously been checked for xps-agent specifically) before proceeding with build/deploy; create `fashionmonitor` service user, `make sync`+`make push` (build/ship images and config, no containers started), recreate `data/.env` by hand, confirm `gluetun-scraper` is healthy on xps-agent (FR13).
2. **Pause the watchdog, then freeze + copy the DB** — stop desktop-agent's `fashion-monitor-scraper-health.timer` (`ssh desktop-agent "sudo systemctl stop fashion-monitor-scraper-health.timer"` — don't disable/uninstall yet, that happens at decommission per FR11; this just keeps it from writing to the DB mid-copy), then take a single-file `.backup` snapshot, transfer it to a checksummed temp path on xps-agent, and `mv` it into place only on a checksum match (FR3/FR4 — see the DB migration mechanism section for exact commands).
3. **Bring up xps-agent, scoped** — `docker compose up -d dashboard mcp-server grafana ntfy` (named services only — see Risk area #1 on why this must not be the Makefile's bare `deploy` target during this window).
4. **Verify, non-destructively** — container state for all four services; HTTP reachability checks for `dashboard` (:3030), `grafana` (:3001), and `ntfy` (:8282); `mcp-server` is SSE-based and harder to trivially curl-check, so a `docker compose ps` health-state check plus a log-tail-for-errors check is sufficient for it specifically; a direct DB read; and a safe write probe (see Data model) proving the app's runtime UID can actually write, not just read. Zero scraper/poshmark/score/scraper-health invocation (FR10).
5. **Install the committed timer/service on xps-agent** (FR6/FR7) and confirm it's active (`systemctl list-timers | grep fashion-monitor-scraper-health` shows it) before proceeding to step 6 — desktop-agent's watchdog must not be decommissioned until xps-agent's replacement is confirmed installed and active, so there is never a window where no watchdog exists on either host.
6. **Decommission desktop-agent** only after step 4 passes (FR11). Retain desktop-agent's `data/fashion_monitor.db*` files, untouched, for at least 24-48 hours post-decommission (operator's judgment) — they remain the only rollback copy — and only delete them after a final row-count/checksum re-check confirms xps-agent's copy is still stable.

**Clarifying the "no dual-live window" NFR's scope:** `grafana` and `ntfy` do end up running on both hosts simultaneously for a window in this sequencing — desktop-agent's copies aren't stopped until step 6, xps-agent's start at step 3 — which technically overlaps. This is accepted as low risk and does not violate the NFR: "authoritative deploy" in the NFR's language is about the **dashboard** (the source of truth for what Preston sees/interacts with), and neither `grafana` nor `ntfy` performs writes or alert-worthy actions during the verification window (`score` isn't running, so nothing triggers a new alert). The dashboard itself follows the single-ordered-handoff sequencing strictly — it's the one service where a dual-live window would actually violate the NFR's intent.

## Data model
No data model changes. The migration relocates the existing `fashion_monitor.db` (SQLite, WAL mode) byte-for-byte; no schema, table, or index changes.

### DB migration mechanism (FR3/FR4 — concrete, safe copy of a live WAL-mode DB)
Current state on desktop-agent: `fashion_monitor.db` is 241,664 bytes but `fashion_monitor.db-wal` is 1,013,552 bytes — most recent writes are sitting uncheckpointed in the WAL, so copying `.db` alone would silently drop data. Rather than hand-rolling a WAL-checkpoint-then-copy-three-files sequence, use SQLite's own recommended safe-copy mechanism — the `.backup` command (SQLite's Online Backup API) — which produces ONE complete, consistent file in a single step and is documented to safely handle a live writer: it takes the snapshot page-by-page under SQLite's own locking, retrying automatically if a writer's transaction touches a page mid-backup, rather than requiring the writer to be quiesced first. This eliminates the multi-file WAL/shm checksumming complexity and the "busy checkpoint" failure mode entirely, and only one resulting file needs to be transferred and checksummed.

**Do we still need to stop `dashboard`/`mcp-server` first?** Per SQLite's documented Online Backup API behavior, strictly no — `.backup` is safe against a live writer. The plan keeps the stop-containers step anyway, out of caution rather than necessity: it removes any dependency on retry-under-contention behavior working exactly as documented on this specific SQLite build, and this is a rare, operator-attended cutover where a few seconds of `dashboard`/`mcp-server` downtime costs nothing — not because `.backup` is known to be unsafe live. A future re-run of this migration could reasonably skip the stop; that would be a simplification, not a correctness fix.

```bash
# 0. Stop desktop-agent's scraper-health watchdog so it can't write to the DB
#    mid-copy (don't disable/uninstall yet — that happens at decommission, FR11).
ssh desktop-agent "sudo systemctl stop fashion-monitor-scraper-health.timer"

# 1. Stop the two containers that hold the DB open, out of caution (see above —
#    .backup itself doesn't strictly require this). scraper/poshmark/score are
#    restart:"no" one-shots and are not running between manual invocations —
#    confirm with `docker compose ps` before proceeding; if one is mid-run, wait
#    for it to exit rather than killing it.
ssh desktop-agent "cd /opt/docker/fashion-monitor && sudo -u fashionmonitor docker compose stop dashboard mcp-server"

# 2. Take the single-file consistent snapshot with sqlite3's .backup command.
ssh desktop-agent "sudo -u fashionmonitor sqlite3 /opt/docker/fashion-monitor/data/fashion_monitor.db '.backup /tmp/fashion_monitor.db.backup'"

# 3. Capture the source checksum immediately after the backup (FR4). Redirect
#    stderr too, so a missing/unreadable file's error is captured in the saved
#    record instead of silently dropped.
ssh desktop-agent "sudo sha256sum /tmp/fashion_monitor.db.backup" > /tmp/fm-source-checksum.txt 2>&1

# 4. Transfer the ONE file to a TEMP path on xps-agent — never write directly
#    over the live destination path, so a dropped connection leaves a leftover
#    .tmp file instead of a truncated production DB. `set -o pipefail` so a
#    source-side ssh failure isn't masked by the destination-side tee's exit code.
set -o pipefail
ssh desktop-agent "sudo cat /tmp/fashion_monitor.db.backup" \
  | ssh xps-agent "sudo -u fashionmonitor tee /opt/docker/fashion-monitor/data/fashion_monitor.db.tmp >/dev/null"
[[ ${PIPESTATUS[0]} -eq 0 && ${PIPESTATUS[1]} -eq 0 ]] || { echo "TRANSFER FAILED -- STOP"; exit 1; }

# 5. Checksum the temp file on xps-agent (stderr redirected, same as step 3).
ssh xps-agent "sudo sha256sum /opt/docker/fashion-monitor/data/fashion_monitor.db.tmp" > /tmp/fm-dest-checksum.txt 2>&1

# 6. SCRIPTED gate — compare hashes only (first field), halt on any mismatch
#    instead of leaving it to a human to eyeball two sha256sum outputs.
diff <(awk '{print $1}' /tmp/fm-source-checksum.txt) <(awk '{print $1}' /tmp/fm-dest-checksum.txt) \
  || { echo "CHECKSUM MISMATCH -- STOP"; exit 1; }

# 7. Only on a checksum match, move the temp file into place (atomic rename,
#    same filesystem) and fix its mode.
ssh xps-agent "sudo -u fashionmonitor mv /opt/docker/fashion-monitor/data/fashion_monitor.db.tmp /opt/docker/fashion-monitor/data/fashion_monitor.db && sudo chmod 600 /opt/docker/fashion-monitor/data/fashion_monitor.db"

# 8. Row-count fallback (FR4's alternate path, AC5) — run before decommissioning
#    desktop-agent, compare against the same query on xps-agent post-copy:
sqlite3 fashion_monitor.db "SELECT COUNT(*) FROM seen_listings;"
```
FK integrity across `fashion_monitor.db`'s tables is inherently preserved by `.backup`'s consistent-snapshot semantics — it is not something this copy step must additionally guard against.

`data/poshmark-profile` is deliberately NOT created or copied (FR5) — none exists on desktop-agent; xps-agent creates it lazily on first opted-in Poshmark scrape.

**Remediation on checksum mismatch:** delete the partial `.tmp` file on xps-agent (`ssh xps-agent "sudo rm -f /opt/docker/fashion-monitor/data/fashion_monitor.db.tmp"`) and retry from step 2 (a fresh `.backup` snapshot) — do not retry step 4 against a `.tmp` file that may already be partially written from the failed attempt.

### Verification: write probe (FR10, AC5)
A read-only `SELECT COUNT(*)` never confirms the migrated DB is actually *writable* by the app's runtime UID — a permission break here would only surface after desktop-agent is decommissioned, past easy rollback. Verification (Cutover order step 4) must also run a safe, non-scrape write probe confirming the migrated DB is writable, not just readable — e.g., inside a transaction, `INSERT` a throwaway row into a low-risk table and `ROLLBACK`, or use `PRAGMA quick_check` plus a scratch table — proving write access without leaving any permanent change or triggering app logic. `steps.md` implements the exact probe query.

## API / interface contract
No HTTP/API changes. The interfaces that change are deploy-invocation and systemd, both by relocation not redesign:

- **Makefile invocation** (FR1) — `make sync DEPLOY_HOST=xps-agent DEPLOY_USER=agent DEPLOY_PATH=/opt/docker/fashion-monitor` and `make push DEPLOY_HOST=xps-agent DEPLOY_USER=agent`. **Do not run bare `make deploy` for the initial cutover** — see Risk area #1.
- **systemd unit `fashion-monitor-scraper-health.service`** (new, FR6/FR7) — `ExecStart=/usr/bin/docker compose --profile tools run --rm scraper-health`, `WorkingDirectory=/opt/docker/fashion-monitor`, `Type=oneshot`, matches the desktop-agent unit verbatim (read from the live host, reproduced below) so the CLI invocation (`node apps/cli/dist/check-scraper-health.js --config /data/config.yaml`, per `scraper-health`'s command in `docker-compose.yml`) is unchanged, only the host it runs on moves.
- **systemd unit `fashion-monitor-scraper-health.timer`** (new, FR6/FR7) — `OnCalendar=*-*-* 00,06,12,18:15:00`, `Persistent=true`, `RandomizedDelaySec=120`, identical cadence to desktop-agent.

Exact committed content (verified against desktop-agent's `/etc/systemd/system/` on 2026-08-06):

```ini
# fashion-monitor-scraper-health.service
[Unit]
Description=Fashion Monitor: dead-scraper watchdog (alerts via ntfy if no successful scrape run in 48h)
Requires=docker.service
After=docker.service

[Service]
Type=oneshot
WorkingDirectory=/opt/docker/fashion-monitor
ExecStart=/usr/bin/docker compose --profile tools run --rm scraper-health
# The check itself exits 1 when stale (after already publishing the ntfy alert) —
# that's diagnostic signal for systemctl status/journalctl, not a unit failure to
# chase; do not add Restart= here, an immediate retry would just re-page.
TimeoutStartSec=120

[Install]
WantedBy=multi-user.target
```

```ini
# fashion-monitor-scraper-health.timer
[Unit]
Description=Run the Fashion Monitor dead-scraper watchdog every 6 hours

[Timer]
OnCalendar=*-*-* 00,06,12,18:15:00
Persistent=true
RandomizedDelaySec=120

[Install]
WantedBy=timers.target
```

Install on xps-agent: `scp` both files to `/tmp`, then `sudo mv /tmp/fashion-monitor-scraper-health.* /etc/systemd/system/ && sudo systemctl daemon-reload && sudo systemctl enable --now fashion-monitor-scraper-health.timer`. Verify with `systemctl list-timers | grep fashion-monitor-scraper-health` (AC7). Do not manually fire the service once installed — let it wait for its own tick (out of scope per requirements: this migration doesn't resolve the timer's currently-failing alert state, and a manual run adds a spurious ntfy dispatch during the verification window).

## Integration points
- `fashion-monitor-scraper-health.service` (new, repo root) — committed unit file, content above; currently exists only hand-installed on desktop-agent (FR6).
- `fashion-monitor-scraper-health.timer` (new, repo root) — committed unit file, content above (FR6).
- `.claude/skills/fashion-monitor-run-and-operate/SKILL.md` — replace "the desktop host"/"desktop-mounted"/`DEPLOY_HOST` desktop references with xps-agent. The existing "**Not yet actually installed** as a cron/timer" sentence is about `scraper`/`poshmark`/`score`'s OWN scrape-execution scheduling (the docker-compose service-map table has no `scraper-health` row at all today) — that stays out of scope and stays unchanged by this migration; do NOT edit that sentence. Instead: **add** a new row to the docker-compose service-map table for `scraper-health` (profile `tools`, on-demand), and **add** a new subsection documenting the watchdog timer's existence (now committed + installed, FR6/FR7), its install command, and how to verify it (`systemctl list-timers`). Also document the new unit files' repo paths (FR8, AC8).
- `Makefile` — no edit. `DEPLOY_HOST ?= YOUR_DEPLOY_HOST` / `DEPLOY_USER ?= YOUR_DEPLOY_USER` are already unresolved placeholders; FR1 is satisfied purely by invocation (`DEPLOY_HOST=xps-agent DEPLOY_USER=agent`), confirmed against the requirement's own wording ("repoint... so that make sync/push/deploy operate against xps-agent" — operationally true once the env vars are supplied, no source change needed).
- `docker-compose.yml` (new) — add `profiles: ["scrape"]` to `scraper`, `poshmark`, and `score`. These three currently have `restart: "no"` but no `profiles:` gate, so ANY bare `docker compose up -d` (including a future `make deploy` run by an operator or agent unaware of Risk area #1) starts a real scrape as a side effect — this closes that gap for every future deploy, not just this cutover's manually-scoped `up -d dashboard mcp-server grafana ntfy` window. This is a small, justified, low-risk scope addition, not gold-plating: it directly closes the exact failure mode Risk area #1 already identifies as the single most likely mistake. Consequence: any FUTURE intentional scraper/poshmark/score run must use `docker compose --profile scrape run --rm <service>` instead of a bare `docker compose run --rm <service>`. This is consistent with, not a new pattern — `scraper-health` already runs under `profiles: ["tools"]`, and the plan's own committed `fashion-monitor-scraper-health.service` unit already invokes it as `docker compose --profile tools run --rm scraper-health` (see the systemd unit content above); `--profile <name> run --rm <service>` is already the fleet's established invocation shape for profile-gated one-shots, this just extends it to the marketplace-scraping services.
- `CLAUDE.md` (repo root) — out of scope per requirements EXCEPT for one line: requirements.md's stakeholder section says AI agents "must not be misdirected to a stale host," and CLAUDE.md's "**Deployed/running copy**: desktop Docker Compose stack, dedicated `fashionmonitor` service user, `/opt/docker/fashion-monitor`..." bullet would otherwise read stale (pointing at desktop-agent) after cutover, directly contradicting that requirement. Bring CLAUDE.md into scope for this ONE bullet only — update "desktop" to xps-agent in that line — and touch nothing else in the file.
- xps-agent `/etc/systemd/system/fashion-monitor-scraper-health.{service,timer}` — host-side install target for the two new repo files (not repo-tracked; FR7).
- xps-agent `/opt/docker/fashion-monitor/data/.env` — host-side only, recreated from desktop-agent's real values via a direct ssh-to-ssh pipe, never through git or `make sync` (FR12). Exact command: `ssh desktop-agent "sudo cat /opt/docker/fashion-monitor/data/.env" | ssh xps-agent "sudo -u fashionmonitor tee /opt/docker/fashion-monitor/data/.env >/dev/null"`, then `ssh xps-agent "sudo chmod 600 /opt/docker/fashion-monitor/data/.env"`. See Technology choices for why this is a deliberate exception to the scraper-egress retyping precedent, not an instance of following it. **Operator warning:** never run `cat .env` (or otherwise print its contents) on either host during this migration's debugging — `grep`-ing for a variable *name* to confirm presence (e.g. `grep -c '^GRAFANA_ADMIN_PASSWORD=' .env`) is fine, printing a *value* is not.
- xps-agent OS account `fashionmonitor` (new) — created idempotently the same way `scraper-egress` already is on this fleet: `id -u fashionmonitor >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin fashionmonitor`, letting the OS assign the next free UID rather than pinning desktop-agent's `975:968` — ownership is fixed by name via `chown fashionmonitor:fashionmonitor` regardless, so UID parity buys nothing and risks colliding with another service's already-claimed slot on a fleet using the same first-free-UID convention elsewhere. Owns `/opt/docker/fashion-monitor` and its `data/` contents.
  **Permission bug found during grounding (do not replicate desktop-agent's current state as-is):** investigation (`ssh desktop-agent "id agent && groups agent"`, plus a direct write test) confirmed `agent` is genuinely NOT a member of the `fashionmonitor` group on desktop-agent, and `/opt/docker/fashion-monitor` is mode `750` (owner `rwx`, group `r-x`, **other: none** — not even directory traversal). A live write test as `agent` (`touch .../fashion-monitor/__perm_test__`) returned `Permission denied`. This means `make sync`'s literal `ssh $(DEPLOY_USER)@$(DEPLOY_HOST) "tar xzf - -C $(DEPLOY_PATH)/"` — which the Makefile runs with no `sudo` at all — cannot actually succeed as plain `agent` against desktop-agent's *current* permissions either; there is no working desktop-agent precedent to mirror here, only a latent bug a real deploy likely never exercised end-to-end since the directory was locked down. **Fix for xps-agent:** add `agent` to the `fashionmonitor` group at user-creation time (`usermod -aG fashionmonitor agent`), and set the top-level `/opt/docker/fashion-monitor` directory to `2775` (setgid, group-writable) with `docker-compose.yml`/`config.yaml`/`grafana/*` — the files `make sync` actually writes — group-writable too (`664`/`775`), so the unmodified Makefile's `tar` extraction succeeds as plain `agent` without `sudo`. Leave `data/` at the stricter `750` (group `r-x`, no group-write) since `make sync` never touches it — `agent` gains read/traverse there via the new group membership, but not write, and that read access is not an incremental exposure: `agent` already has fleet-standard NOPASSWD `ALL` sudo on both hosts, so it could already reach `data/`'s contents via `sudo cat` regardless. The Makefile's `DEPLOY_USER` stays `agent` (already docker-group member on xps-agent: `docker:x:990:agent`, confirmed).
- desktop-agent `/etc/systemd/system/fashion-monitor-scraper-health.{service,timer}` — removed as the final decommission step (FR11).

## Technology choices
- `sqlite3` CLI for the `.backup` snapshot and row-count verification — already an implicit dependency of a SQLite-backed app; no new library, just the standard Online Backup API (`.backup`) mechanism for a consistent live-DB snapshot in one step.
- Reuse the exact hand-installed systemd pattern from desktop-agent (`Type=oneshot` + `OnCalendar` timer, no `Restart=`) rather than inventing a different scheduling mechanism — it's already proven on this same app, just uncommitted.
- Plain `ssh` pipes for the one-time `.env` and DB transfer rather than a sync tool (rsync/rclone) — avoids adding a dependency for a single one-time transfer. For `.env` specifically, this is a deliberate, reasoned *exception* to home-infra's stricter scraper-egress precedent (operator retypes credentials by hand on the target host, never transiting host-to-host — see `deploy-and-rotate.md`), not an instance of following that precedent: `.env` contains `ENCRYPTION_KEY`, which must be byte-exact (a typo'd value would permanently break decryption of every existing per-profile Secret in the DB, per ADR-002), so an SSH pipe — encrypted in transit, never staged to disk — is the more correct choice here than manual retyping, which risks exactly the transcription error that would be catastrophic for this one variable. The risk this specific choice accepts (secrets briefly transiting an already-authenticated, already-encrypted SSH session) is low and bounded.

## Risk areas
1. **`make deploy`'s bare `docker compose up -d` would also launch `scraper`/`poshmark`/`score`.** These three services have `restart: "no"` but no `profiles:` gate — `restart` only governs behavior after a container exits, it does not stop `up -d` from starting them the first time. A literal `make deploy DEPLOY_HOST=xps-agent DEPLOY_USER=agent` (as AC2's wording might suggest) would trigger a real scrape as a side effect of "just deploying," directly violating FR10/the no-live-marketplace-side-effects NFR. The plan resolves this immediately by using `make sync`+`make push` (no container start) followed by a manually-scoped `docker compose up -d dashboard mcp-server grafana ntfy` for the cutover/verification window — this is the single most likely place an operator (or an agent following AC2 too literally) reintroduces the exact side effect the requirements explicitly forbid. This gap is also closed going forward, for every future deploy (not just this cutover window), by a new Integration point (`docker-compose.yml` `profiles: ["scrape"]` on `scraper`/`poshmark`/`score`) — see Integration points.
2. **Container runtime UID vs. host file permissions.** No `USER`/UID directive was found in `Dockerfile`/`services/mcp-server/Dockerfile` during grounding, and desktop-agent's `data/` is `750 fashionmonitor:fashionmonitor`. Docker containers typically run as root by default and bind-mount access is governed by the daemon (root), so this likely "just works" the same way it does today on desktop-agent — but it wasn't verified end-to-end (dockerd runs as root regardless of which host user invoked `docker compose`), so confirm the containers can actually read/write the copied DB after cutover rather than assuming. (This is distinct from the separate, confirmed host-level `agent`-vs-`fashionmonitor` permission bug documented under the `fashionmonitor` OS account Integration point — that one is about `make sync`'s tar extraction, not the container's own runtime UID.)
3. **`.backup` snapshot or transfer step failing partway.** `.backup` can fail if `/tmp` on desktop-agent lacks space for the full DB snapshot, or the destination `ssh` pipe drops mid-transfer — both are caught by the scripted checksum gate (DB migration mechanism section, steps 3-6), which halts before anything is moved into place on a mismatch or a non-zero `PIPESTATUS`. On any failure, follow the remediation note there (delete the `.tmp` file on xps-agent, retry from a fresh `.backup`) rather than assuming the DB is now inconsistent — the source DB on desktop-agent is untouched by a failed backup/transfer attempt.
4. **`.env` transfer is the one step that can't be checksummed against git** (it's deliberately never committed) — a typo'd secret or missed variable (`GRAFANA_ADMIN_PASSWORD` is `:?`-required and will hard-fail `grafana`'s startup if missing) only surfaces as a failed container at verification time, not earlier; worth explicitly diffing variable *names* (not values) between desktop-agent's `.env` and `.env.example` before cutover to catch a dropped key — at minimum, confirm `TELEGRAM_BOT_TOKEN`, `ENCRYPTION_KEY`, and `GRAFANA_ADMIN_PASSWORD` are all present by name (`grep -o '^[A-Z_]*=' .env`, never printing values — see the `.env` transfer Integration point for the full warning).
5. **Known, accepted gap:** neither `fashion-monitor-scraper-health.timer`/`.service` nor the migration itself register with home-infra's config-drift-monitor manifest (already flagged as a general xps-agent-fleet-tools gap, and explicitly out of scope per requirements) — drift on these two units after this migration won't be caught automatically.
