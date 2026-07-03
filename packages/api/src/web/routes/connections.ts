import type { FastifyInstance } from "fastify";
import { CONNECTIONS, findConnection } from "@fm/shared/connections.js";
import type { ConnectionDto } from "@fm/shared/dto.js";
import { IntegrationHealthRepo } from "@fm/core/storage/repos/integration-health.js";
import { createEbayScraper } from "@fm/core/platforms/ebay/scraper.js";
import { createNtfyAlerter } from "@fm/core/alerts/ntfy.js";
import type { WebContext } from "../context.js";
import { auditFromRequest, requireCapability } from "../context.js";

function toDto(ctx: WebContext, profileId: string, platform: string): ConnectionDto {
  const meta = findConnection(platform)!;
  const health = new IntegrationHealthRepo(ctx.db, profileId);

  if (meta.dormant) {
    return {
      platform: meta.platform,
      label: meta.label,
      type: meta.type,
      dormant: true,
      automatic: false,
      configured: false,
      status: "not_connected",
      lastTestedAt: null,
      lastError: null,
    };
  }

  if (meta.type === "none") {
    return {
      platform: meta.platform,
      label: meta.label,
      type: meta.type,
      dormant: false,
      automatic: true,
      configured: true,
      status: "ok",
      lastTestedAt: null,
      lastError: null,
    };
  }

  const secretsRepo = ctx.secretsRepo(profileId);
  const configured = meta.requiredSecrets.every((key) => secretsRepo?.has(key));
  const latest = health.latestEvent(meta.integration, "test");

  let status: ConnectionDto["status"];
  if (!configured) status = "not_connected";
  else if (!latest) status = "untested";
  else if (latest.status === "ok") status = "ok";
  else if (latest.status === "degraded") status = "degraded";
  else status = "failed";

  return {
    platform: meta.platform,
    label: meta.label,
    type: meta.type,
    dormant: false,
    automatic: false,
    configured,
    status,
    lastTestedAt: latest?.recorded_at ?? null,
    lastError: latest?.error ?? null,
  };
}

export async function registerConnectionRoutes(
  app: FastifyInstance,
  ctx: WebContext,
): Promise<void> {
  app.get(
    "/api/connections",
    { preHandler: requireCapability(ctx, "secrets:read") },
    async (req, reply) => {
      reply.header("Cache-Control", "no-store");
      return {
        connections: CONNECTIONS.map((c) => toDto(ctx, req.profileId!, c.platform)),
      };
    },
  );

  app.post(
    "/api/connections/:platform/test",
    { preHandler: [app.csrfProtection, requireCapability(ctx, "secrets:write")] },
    async (req, reply) => {
      const { platform } = req.params as { platform: string };
      const meta = findConnection(platform);
      if (!meta) {
        reply.code(404);
        return { error: "not_found" };
      }
      if (meta.dormant) {
        reply.code(400);
        return { error: "dormant", message: "Login connections are not enabled yet" };
      }
      if (meta.type === "none") {
        reply.code(400);
        return { error: "no_test", message: "Automatic connections have nothing to test" };
      }

      const profileId = req.profileId!;
      const config = ctx.loadConfig(profileId);
      const ts = ctx.now().toISOString();
      const health = new IntegrationHealthRepo(ctx.db, profileId);

      let ok: boolean;
      let error: string | null;
      try {
        if (platform === "ebay") {
          const result = await createEbayScraper(config).search([
            { queryId: "connection-test@ebay", text: "test", sourceQueryId: "connection-test" },
          ]);
          ok = result.ok;
          error = result.ok ? null : result.error;
        } else if (platform === "ntfy") {
          ok = await createNtfyAlerter(config.alert).sendTestNotification();
          error = ok ? null : "ntfy send failed";
        } else {
          // Unreachable given the dormant/none checks above, but keeps the
          // switch exhaustive if CONNECTIONS grows a platform without a test yet.
          reply.code(501);
          return { error: "not_implemented" };
        }
      } catch (err) {
        ok = false;
        error = err instanceof Error ? err.message : "test failed";
      }

      health.record({
        integration: meta.integration,
        operation: "test",
        status: ok ? "ok" : "fail",
        error,
        recordedAt: ts,
      });
      auditFromRequest(ctx, req, "connection.test", {
        target: platform,
        detail: { ok },
      });

      return { ok, status: ok ? "ok" : "failed", error, testedAt: ts };
    },
  );

  app.post(
    "/api/connections/:platform/disconnect",
    { preHandler: [app.csrfProtection, requireCapability(ctx, "secrets:write")] },
    async (req, reply) => {
      const { platform } = req.params as { platform: string };
      const meta = findConnection(platform);
      if (!meta) {
        reply.code(404);
        return { error: "not_found" };
      }
      if (meta.dormant || meta.type === "none" || meta.requiredSecrets.length === 0) {
        reply.code(400);
        return { error: "not_disconnectable" };
      }

      const secretsRepo = ctx.secretsRepo(req.profileId!);
      if (!secretsRepo) {
        reply.code(400);
        return { error: "store_disabled", message: "Secret store is disabled (no SECRETS_KEY)." };
      }
      for (const key of meta.requiredSecrets) secretsRepo.remove(key);

      auditFromRequest(ctx, req, "connection.disconnect", { target: platform });
      return { ok: true };
    },
  );
}
