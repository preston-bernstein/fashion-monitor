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

1. **Multi-profile pipeline runner** (ADR-0005). Scheduled tick lists active profiles → runs existing single-profile pipeline per profile, serially. Per-profile `runs`/`integration_events` already `profile_id`-scoped.
2. **Isolation audit.** Verify every query is `profile_id`-scoped and RBAC is per-membership — no cross-profile leak — *before* a real second tenant exists. This is a correctness gate, not a nicety.
3. **`max_monitors_per_profile` cap** (default 25), enforced at Monitor-create in `@fm/api`.

## Phase 2 — Invites & account lifecycle (ADR-0003)

1. **Invite issue/redeem.** Owner generates one-time token → link. Redeem: create User, create Profile, Owner membership, mark token consumed. New `invites` table (token hash, created_by, profile_id-on-redeem, expires_at, consumed_at).
2. **Password reset** = owner-regenerated one-time link (same machinery, no email).
3. **Profile deletion** = Owner self-serve, cascades all `profile_id` rows + secrets + memberships + final audit record.
4. Audit actions added: `invite.create`, `invite.redeem`, `password.reset`, `profile.delete`.

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
