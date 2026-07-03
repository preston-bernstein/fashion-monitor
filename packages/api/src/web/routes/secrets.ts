import type { FastifyInstance } from "fastify";
import { IntegrationHealthRepo } from "@fm/core/storage/repos/integration-health.js";
import { ProfileSettingsRepo } from "@fm/core/storage/repos/profile-settings.js";
import { KNOWN_SECRETS, SecretInputSchema } from "@fm/shared/schemas/secrets.js";
import type { WebContext } from "../context.js";
import { auditFromRequest, requireCapability } from "../context.js";
import { parseBody } from "../validation.js";

export { KNOWN_SECRETS };

export async function registerSecretsRoutes(app: FastifyInstance, ctx: WebContext): Promise<void> {
  app.get(
    "/api/secrets",
    { preHandler: requireCapability(ctx, "secrets:read") },
    async (req, reply) => {
      reply.header("Cache-Control", "no-store");
      const repo = ctx.secretsRepo(req.profileId!);
      const health = new IntegrationHealthRepo(ctx.db, req.profileId!);
      const secrets = repo
        ? repo.list().map((m) => ({ key: m.key, updated_at: m.updated_at }))
        : [];
      const runRequestedAt =
        new ProfileSettingsRepo(ctx.db, req.profileId!).get<string>("run_requested_at") ?? null;
      return {
        storeEnabled: Boolean(repo),
        secrets,
        knownSecrets: KNOWN_SECRETS,
        uptime: health.fetchUptime7d(),
        failures: health.fetchRecentFailures(15),
        runRequestedAt,
        canWrite: req.capabilities.has("secrets:write"),
        canTrigger: req.capabilities.has("pipeline:trigger"),
      };
    },
  );

  app.put(
    "/api/secrets",
    { preHandler: [app.csrfProtection, requireCapability(ctx, "secrets:write")] },
    async (req, reply) => {
      const repo = ctx.secretsRepo(req.profileId!);
      if (!repo) {
        reply.code(400);
        return { error: "store_disabled", message: "Secret store is disabled (no SECRETS_KEY)." };
      }
      const data = parseBody(SecretInputSchema, req.body, reply);
      if (!data) return reply;
      const ts = ctx.now().toISOString();
      repo.set(data.key, data.value, ts, req.currentUser!.id);
      auditFromRequest(ctx, req, "secret.upsert", {
        target: data.key,
        detail: { key: data.key },
      });
      return { ok: true };
    },
  );

  app.post(
    "/api/secrets/trigger-run",
    { preHandler: [app.csrfProtection, requireCapability(ctx, "pipeline:trigger")] },
    async (req, _reply) => {
      const ts = ctx.now().toISOString();
      new ProfileSettingsRepo(ctx.db, req.profileId!).set("run_requested_at", ts, ts);
      auditFromRequest(ctx, req, "pipeline.trigger");
      return { ok: true, runRequestedAt: ts };
    },
  );
}
