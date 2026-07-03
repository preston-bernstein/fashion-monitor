/**
 * Maximum number of Monitors (search groups) a single profile may create.
 *
 * v1 choice: a plain constant, not a DB-backed `profile_settings` key. Per
 * fashion-monitor-config-and-flags, per-profile user-editable knobs belong in
 * `profile_settings`, but this is a platform-level guardrail (like a quota),
 * not a Taste/system setting a Curator tunes — so it stays a constant here,
 * shared by both the web API and the MCP server, until billing/quota tiers
 * are designed (explicitly out of scope for now, see
 * docs/plans/self-service-onboarding.md "Non-goals" and Phase 1.3, default 25).
 */
export const MAX_MONITORS_PER_PROFILE = 25;
