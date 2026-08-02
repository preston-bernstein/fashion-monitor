# Self-service onboarding, Connections & per-profile health

This document plans letting a non-technical end user — for example, the Owner's spouse — use fashion-monitor's web dashboard entirely on her own. She should be able to log in, set up her own Taste profile and Monitors, connect her own platform and alert accounts, verify they work, and watch her own scrape flow and uptime. All of this should work without her ever touching MCP (Model Context Protocol, the interface AI agents use to call into this app) or the command-line tool (CLI).

**Status:** Planned. This plan is the output of a grilling session (a structured design-review meeting) held 2026-06-15. Decisions are recorded in ADRs 0003–0006 (Architecture Decision Records — short documents that record a design decision and why it was made). New vocabulary — `Connection`, `Invite`, and an updated `User` / Interface hierarchy — is recorded in `CONTEXT.md`.

---

## Scope & terms

- **Connection** — a per-profile, per-platform link: credentials stored as a `Secret`, a test action, a status, and a risk acknowledgment. Connections come in three tiers: API-key (eBay), none needed (Grailed, called "automatic"), and login-based (Poshmark, Depop, Vestiaire — currently dormant). See ADR-0004 for details.
- **Invite** — a one-time link. Redeeming it creates a new User, a fresh Profile, and an Owner membership on that profile. See ADR-0003.
- "Connect account" actually covers three unrelated things, built and shown separately: **signup** (an Invite), an **alert destination** (an ntfy `Secret`), and a **platform Connection**.

**Not planned right now** (deferred): public self-registration, billing or quotas beyond the monitor cap, per-profile schedules, email infrastructure, a continuous background health heartbeat, and the GPU broker itself (see ADR-0006 — that's a separate spike).

---

## Phase 1 — Multi-tenancy foundations (blocks everything else)

Multi-tenancy means one running app instance serving multiple independent Profiles (tenants), each isolated from the others' data.

1. [x] **Multi-profile pipeline runner** (ADR-0005). A scheduled tick lists every active profile, then runs the existing single-profile pipeline once per profile, one at a time. The `runs` and `integration_events` tables were already scoped per profile via a `profile_id` column. Implemented 2026-07-03 as `runProfilesSerially` in `apps/cli/src/run.ts`.
2. [x] **Isolation audit.** Verify that every database query is scoped to its `profile_id`, and that role-based access control (RBAC — restricting actions by a user's role) is checked per membership, so no data can leak across profiles. This had to happen before a real second tenant existed — it's a correctness gate, not a nicety. Audited 2026-07-03: no blocking findings across `packages/core/src/storage/repos/*`, `analytics/queries.ts`, and the web and MCP request paths (see the PR for detail). `packages/core/tests/storage/isolation.test.ts` now adds a regression test for this.
3. [x] **`max_monitors_per_profile` cap** (default 25), enforced when a Monitor is created, inside `@fm/api`. Implemented 2026-07-03 as `MAX_MONITORS_PER_PROFILE` in `@fm/shared/limits.ts`, via `SearchGroupsRepo.assertMonitorCapNotExceeded()`. Both the web API and the MCP `add_monitor` tool call this same function.

## Phase 2 — Invites & account lifecycle (ADR-0003)

0. [x] **A prerequisite the original plan missed, discovered during implementation:** the web API bound one fixed `profileId` per server instance at boot time. Login, and every route, closed over that single fixed value. Under the original design, a Phase 2 invite would have created a Profile that nobody could ever log into through that same server. The Phase 1 isolation audit's "no blocking findings" result was correct for what it checked — at the time, no second profile was reachable through the web layer at all, so there was nothing to leak between profiles yet. It just hadn't anticipated that Phase 2 would need the web layer itself to become multi-tenant. Fixed 2026-07-03: login now resolves the user's actual membership instead of using the fixed value, session restore trusts the session's own stored `profile_id` (which existed already but was unused), and every route now scopes through `req.profileId` instead of the old `ctx.profileId`. `packages/api/tests/web/profile-isolation.test.ts` is the regression test guarding this: two owners, two profiles, one running app.
1. [x] **Invite issue and redeem.** The Owner generates a one-time token, producing a link. Redeeming it creates a User, creates a Profile, creates an Owner membership, and marks the token consumed. The `invites` table (added in migration 016: token hash, purpose, created_by, target_user_id, profile_id-on-redeem, expires_at, consumed_at) is shared with item 2 below. Routes: `POST /api/invites` to issue (requires the `users:manage` capability), `POST /api/invites/redeem` (public).
2. [x] **Password reset** works the same way: the owner regenerates a one-time link, using the same `invites` table with `purpose: "password_reset"` and `target_user_id` set. Routes: `POST /api/users/:id/password-reset-link` to issue, `POST /api/invites/redeem-password-reset` (public). Redeeming it destroys the user's existing sessions.
3. [x] **Profile deletion** is Owner self-serve (`DELETE /api/profile`), gated directly by `role === "owner"` rather than by a Capability, because every other capability is shared by both owner and admin roles. It cascades through every table scoped by `profile_id` (`packages/core/src/storage/profile-deletion.ts`). The "final audit record" for the deletion is written to the `default` system profile, since the deleted profile's own audit log doesn't survive the deletion.
4. [x] New audit actions were added: `invite.create`, `invite.redeem`, `password.reset.link`, `password.reset`, `profile.delete`.

## Phase 3 — Connections page (Sonarr-style, in our own visual style) (ADR-0004)

0. [x] **A prerequisite the original plan missed, discovered during implementation:** `ebay_client_id`, `ebay_client_secret`, `grailed_app_id`, `grailed_api_key`, and `scrapfly_api_key` were listed in `KNOWN_SECRETS` as settable per profile through self-service. In practice, the eBay, Grailed, and Vestiaire scrapers read these exclusively from `process.env`, never from the per-profile `profile_secrets` store. That meant a second profile's own connected credentials were silently overridden by whatever was in the deployment's shared `.env` file — every profile on a server used the same credentials, regardless of what each profile had connected. A Connections page "Test" button built on top of this would have given false confidence that a profile's own credentials were in use. Fixed 2026-07-03: `Config` gained a `platform_credentials` field, mirroring the existing `ntfy_token` pattern. `loadProfileConfig` now resolves each credential key by checking the database first, then the environment, then a fallback, through `resolveSecret`. This fix also corrected `resolveSecret`'s own precedence — it previously checked the environment before the database, even for `ntfy_token`, and no test had caught this. Database-first is the only correct order once a second profile exists. The three scrapers now read `config.platform_credentials.*` first, falling back to `process.env` only for callers like `verify-scrapers.ts` that build a `Config` without going through `loadProfileConfig`.
1. [x] **Connection model and UI.** One card per platform, showing a type badge, a status badge (`untested`, `ok`, `degraded`, `failed`, or `not_connected`), and Test/Disconnect actions. As of 2026-07-03, this phase is scoped down to a backend plus a dormant UI — a deliberate owner decision. Login-based platforms render as locked, dormant cards, with no risk-acknowledgment gate yet, because that gate only makes sense once the Spikes below (see near the end of this document) actually land. Building the risk-ack flow now would be UI for a path nobody can complete yet.
2. [x] **Per-type Test.** Each test writes an `integration_event` with `operation='test'`, using the same integration name the pipeline itself uses (`scraper:ebay`, `alerts:ntfy`), so manual tests and pipeline runs share one uptime timeline:
   - eBay: fetch an OAuth token, then run one sample search, reusing the existing scraper's own `search()` function.
   - ntfy: a new `sendTestNotification()` function, kept distinct from real alert messages.
   - Grailed: no test exists; the card just shows "Automatic."
   - Login-based platforms: deferred, not implemented. The Test endpoint returns a 400 error with `dormant` for these. A real test — "load a search with the stored session, confirm it's authenticated" — only makes sense once login connections themselves exist (see Spikes).
3. [x] **Disconnect** (mandatory) deletes the relevant `profile_secrets` rows, flips the status to `not_connected`, and writes an audit entry.
4. **Login connections stay dormant** until ToS (Terms of Service) research and an anonymous-vs-logged-in comparison are done (see Spikes). This is enforced today by the connection registry's `dormant: true` flag, and by the Test and Disconnect routes rejecting dormant platforms outright.

Implementation: `packages/shared/src/connections.ts` (the tiered registry — it documents one known discrepancy between ADR-0004 and the code, in Vestiaire's type), `packages/api/src/web/routes/connections.ts` (GET, test, and disconnect routes), `apps/web/src/pages/connections.tsx` plus `apps/web/src/components/connections/*` for the UI. This phase added 18 tests (11 API, 7 component), plus a real end-to-end smoke test against a running dashboard and a local ntfy container.

## Phase 4 — Per-profile Health page (her "monitor flow and uptime" request) (Q8)

1. [x] A plain-language, per-profile view, with no LogQL (Loki's log query language — not something a non-technical user should need). It shows connection badges — reusing Phase 3's `GET /api/connections` and the same UI component — plus the last-alert timestamp, and a "test all connections" action that loops the existing per-platform Test call on the client side, with no new bulk endpoint needed.
2. [x] A **funnel** view built from the `runs` table: scraped → new → prefiltered → scored (yes/maybe/no) → alerted, for her most recent run or runs. This closed a gap: `RunStats.prefilterRejected` was already computed in `orchestrator.ts`, but never saved. The fix added a `runs.prefilter_rejected` column (migration 017) and a new `RunsRepo.recentFunnel()` function.
3. [x] Status is derived from `integration_events` — this requirement was satisfied by reuse. The connection badges on this page are the exact same component and endpoint used in Phase 3, so manual tests and per-run health already share one timeline by construction. Nothing new was needed here. Operator-facing, system-wide monitoring stays in Grafana and Loki; it was not rebuilt for this page.

Implementation: `GET /api/profile-health` (`packages/api/src/web/routes/health.ts`, gated by the `analytics:read` capability — deliberately the lowest access tier, since viewers and curators are exactly who this page is for), `apps/web/src/pages/health.tsx` plus `apps/web/src/components/health/run-funnel-table.tsx`. This phase added 9 tests (2 core, 3 API, 4 component), plus a real end-to-end smoke test against a running dashboard with seeded run and alert rows.

## Phase 5 — Onboarding checklist (the "dashboard first" experience) (Q7) [x]

An ordered first-run checklist appears on her dashboard: ① set Taste → ② add a first Monitor → ③ connect ntfy and Test it (a banner reads "no alert destination yet" until this passes) → ④ optionally connect platforms.

Implemented 2026-07-03 as `OnboardingChecklist` on the Analytics landing page (`/`). It needed no new read endpoints — each step reads a response the app already fetches elsewhere: `GET /api/taste`'s `aesthetic_prompt`, `GET /api/monitors`'s `groups.length`, and `GET /api/connections`'s ntfy status. The only new surface is a dismiss flag, stored through `GET`/`POST /api/onboarding` in a `ProfileSettingsRepo` key — no migration needed. The checklist hides itself automatically once every step visible to that user's role is done, or once the user dismisses it. It was verified against a real invite-then-redeem-then-login flow: a freshly created profile correctly reports all three steps incomplete, while the file-seeded `default` profile — which already has monitors and taste settings from `config.yaml` — correctly reports everything done.

This completes the plan's four build phases, Phase 1 through Phase 5. What remains is the Spikes below. Both require the owner's own judgment — ToS risk tolerance and live measurement against real platforms — rather than being open implementation work.

---

## Spikes (gate the dormant features; run during Phase 3)

- **Per-platform ToS research**, producing honest per-platform risk copy and finalizing the relevant ADR. eBay uses a sanctioned API. Grailed uses its public Algolia search index. Poshmark, Depop, and Vestiaire require logging in, which violates their Terms of Service and risks a ban. The risk that matters is the rule itself and its unappealable penalty — not the odds of being caught in any one session. The UI copy must say so honestly.
- **Anonymous vs. logged-in measurement** on Poshmark, Depop, and Vestiaire: does a logged-in session return meaningfully more or better listings than an anonymous one? If not, login-based connections stay off permanently.

## Cross-cutting / open (ADR-0006)

Ollama (the shared local LLM server) runs on a GPU that is shared and contended. The planned direction is a GPU broker that sits in front of Ollama — queuing requests, prioritizing them, yielding when the machine's operator is using it directly, and emitting events. This will likely live in its own separate repo, since estate-scraper, LibreChat/LightRAG, and personal use all share the same GPU. Fashion Monitor's existing `PENDING` replay logic already absorbs a "broker busy" condition with no new code needed. This needs its own grilling session before any of it gets built.
