# Self-service onboarding, Connections & per-profile health

**Status:** Planned. Output of a grilling session (2026-06-15). Decisions captured in ADRs 0003–0006; vocabulary in CONTEXT.md (`Connection`, `Invite`, updated `User` / `Interface hierarchy`).

Goal: let a non-technical end user (e.g. the Owner's spouse) be invited, log into the web dashboard, configure her own Taste/Monitors, connect her own platform + alert accounts, verify they work, and watch her own flow/uptime — all without touching MCP or the CLI.

---

## Scope & terms

- **Connection** — per-profile, per-platform link (creds as `Secret`s + test + status + risk ack). Tiered: API-key (eBay), none (Grailed, "automatic"), login (Poshmark/Depop/Vestiaire, dormant). See ADR-0004.
- **Invite** — one-time link; redeeming creates User + fresh Profile + Owner membership. See ADR-0003.
- "Connect account" splits into three unrelated things: **signup** (Invite), **alert destination** (ntfy `Secret`), **platform Connection**. They are built and surfaced separately.

Non-goals (deferred): public registration, billing/quotas beyond the monitor cap, per-profile schedules, email infra, continuous background health heartbeat, the GPU broker itself (ADR-0006, separate spike).

---

## Phase 1 — Multi-tenancy foundations (blocks everything)

1. [x] **Multi-profile pipeline runner** (ADR-0005). Scheduled tick lists active profiles → runs existing single-profile pipeline per profile, serially. Per-profile `runs`/`integration_events` already `profile_id`-scoped. Implemented 2026-07-03: `runProfilesSerially` in `apps/cli/src/run.ts`.
2. [x] **Isolation audit.** Verify every query is `profile_id`-scoped and RBAC is per-membership — no cross-profile leak — *before* a real second tenant exists. This is a correctness gate, not a nicety. Audited 2026-07-03: no blocking findings across `packages/core/src/storage/repos/*`, `analytics/queries.ts`, and the web/MCP request paths (see PR); `packages/core/tests/storage/isolation.test.ts` adds a regression gate.
3. [x] **`max_monitors_per_profile` cap** (default 25), enforced at Monitor-create in `@fm/api`. Implemented 2026-07-03 as `MAX_MONITORS_PER_PROFILE` (`@fm/shared/limits.ts`) via `SearchGroupsRepo.assertMonitorCapNotExceeded()` — shared by the web API and the MCP `add_monitor` tool.

## Phase 2 — Invites & account lifecycle (ADR-0003)

0. [x] **Prerequisite discovered during implementation, not in the original plan:** the web API bound one fixed `profileId` per server instance at boot (login and every route closed over it) — a Phase 2 invite would have created a Profile nobody could ever log into through that same server. The Phase 1 isolation audit's "no blocking findings" was correct for its own scope (no second profile was ever reachable through the web layer at the time, so there was nothing to leak between); it didn't anticipate Phase 2 needing the web layer itself to become multi-tenant. Fixed 2026-07-03: login resolves the user's membership instead of a fixed value, session restore trusts the session's own `profile_id` (already stored, previously unused), and every route scopes via `req.profileId` instead of `ctx.profileId`. `packages/api/tests/web/profile-isolation.test.ts` is the regression gate (two owners, two profiles, one running app).
1. [x] **Invite issue/redeem.** Owner generates one-time token → link. Redeem: create User, create Profile, Owner membership, mark token consumed. `invites` table (migration 016: token hash, purpose, created_by, target_user_id, profile_id-on-redeem, expires_at, consumed_at) — shared with item 2. `POST /api/invites` (issue, `users:manage`), `POST /api/invites/redeem` (public).
2. [x] **Password reset** = owner-regenerated one-time link, same `invites` table with `purpose: "password_reset"` and `target_user_id` set. `POST /api/users/:id/password-reset-link` (issue), `POST /api/invites/redeem-password-reset` (public); destroys the user's existing sessions.
3. [x] **Profile deletion** = Owner self-serve (`DELETE /api/profile`, gated by `role === "owner"` directly rather than a Capability — every other capability is shared by owner+admin). Cascades every `profile_id`-scoped table (`packages/core/src/storage/profile-deletion.ts`); the "final audit record" is written to the `default` system profile since the deleted profile's own audit_log doesn't survive.
4. [x] Audit actions added: `invite.create`, `invite.redeem`, `password.reset.link`, `password.reset`, `profile.delete`.

## Phase 3 — Connections page (Sonarr-style, our aesthetic) (ADR-0004)

1. **Connection model/UI.** One card per platform: type badge, required fields, **Test** button, status badge (`untested`/`ok`/`degraded`/`failed`/`not_connected`), and for login platforms a risk-ack gate (`risk_acknowledged`).
2. **Per-type Test** writes `integration_event` (`operation='test'`):
   - eBay → fetch OAuth token + one sample search.
   - ntfy → send "✅ connected" test notification to her topic.
   - login platforms → load search with stored session, assert authenticated.
   - Grailed → no test; card shows "Automatic."
3. **Disconnect** (mandatory) → deletes `profile_secrets` rows, flips to `not_connected`, audit entry.
4. **Login connections stay dormant** until ToS research + anonymous-vs-logged-in lift measurement (see Spikes).

## Phase 4 — Per-profile Health page (her "monitor flow and uptime") (Q8)

1. Plain-language, per-profile view — no LogQL. Connection badges (reuse Phase 3 status) + last-alert timestamp + "test all connections."
2. **Funnel** from `runs`: scraped → new → prefiltered → scored (yes/maybe/no) → alerted, for her last run(s).
3. Status derived from `integration_events` (manual Test + per-run health share one timeline). Operator/system-wide monitoring stays in Grafana/Loki — not rebuilt.

## Phase 5 — Onboarding checklist (the "dashboard first" UX) (Q7)

Ordered first-run checklist on her dashboard: ① set Taste → ② add first Monitor → ③ connect ntfy + Test (banner "no alert destination yet" until it passes) → ④ optionally connect platforms.

---

## Spikes (gate dormant features, run during Phase 3)

- **Per-platform ToS research** → honest per-platform risk copy + finalize relevant ADR. eBay (API, sanctioned), Grailed (public Algolia), Poshmark/Depop/Vestiaire (login = ToS violation, ban risk). The risk is the *rule + unappealable penalty*, not the odds of per-session detection — copy must say so honestly.
- **Anonymous vs logged-in measurement** on Poshmark/Depop/Vestiaire — does a login session return materially more/better listings than anonymous? If not, login connections stay off permanently.

## Cross-cutting / open (ADR-0006)

Ollama is a shared, contended GPU. Direction: a **GPU broker** fronting Ollama (queue, priority, yield-when-operator-is-using-the-box, emit events) — likely a **separate repo** since estate-scraper, LibreChat/LightRAG, and personal use all consume the same GPU. Fashion Monitor's existing `PENDING` replay already absorbs "broker busy" with no new logic. Needs its own grilling session before building.
