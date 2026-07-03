# Push alerts are delivered via self-hosted ntfy, not Telegram

**Status: accepted — implemented 2026-07-03.**

Telegram was the original push channel (ADR-004, ADR-011 in `spec/06-decisions.md`): free, inline images, and — critically at the time — native inline-keyboard buttons that let the feedback loop (ADR-009) ride the same bot without a hosted webhook. In practice this coupled the alert channel to a third-party bot account bound to a phone number, Telegram's Bot API availability, and a chat-id per profile that had to be provisioned out-of-band. None of that is required once feedback ingestion moves off Telegram replies (see the feedback-restoration ADR for that decision) — Telegram's main advantage over any other push channel evaporates.

**Decision:** alerts are delivered via a **self-hosted ntfy** instance (`binwiederhier/ntfy`, `docker-compose.yml` service `ntfy`), published through ntfy's JSON API (`POST {ntfy_url}` with `topic`, `title`, `message`, `priority`, `tags`, `click` in the body — not the header-based publish API, which rejects non-ASCII header values and would throw on the ✅/🟡 score icons). `packages/core/src/alerts/ntfy.ts` implements `AlertClient` (`sendAlert`/`sendDigest`/`sendEmptyRunNotice`); `packages/core/src/pipeline/orchestrator.ts` calls `createNtfyAlerter(config.alert)`. Config: `alert.ntfy_url`/`alert.ntfy_topic` in `config.yaml`, optional `alert.ntfy_token` (bearer auth) resolved from `NTFY_TOKEN` env, DB secret store, or config fallback via `loadProfileConfig` in `profile-config.ts`. `integration_events` records deliveries under `alerts:ntfy` (was `alerts:telegram`; historical rows keep the old label).

**Why ntfy:**
- Self-hosted — no dependency on a third-party bot account, phone-number binding, or Telegram's API availability
- Runs on the same Synology NAS as everything else (ADR-005) via `docker-compose.yml`, zero cloud dependency
- Native Android/iOS push apps subscribe to a topic — no per-profile bot chat-id provisioning
- Simple HTTP POST, same operational shape as Telegram's `api.telegram.org` calls (no infra cost)
- Optional token auth per topic if exposed beyond the LAN

**Rejected alternative — keep Telegram:** the original rationale (ADR-004, ADR-011) leaned heavily on inline reply buttons carrying the feedback loop for free. With feedback ingestion redesigned to not depend on Telegram's callback_query webhook, that advantage no longer applies, and the operational cost (bot token, chat-id per profile, dependency on a third party for a personal always-on pipeline) outweighed the convenience.

Supersedes ADR-004 and ADR-011 in `spec/06-decisions.md`.
