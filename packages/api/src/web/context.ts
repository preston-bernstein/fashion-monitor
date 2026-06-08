import type { FastifyReply, FastifyRequest } from "fastify";
import type { Db } from "@fm/core/storage/db.js";
import type { Config } from "@fm/core/core/config.js";
import type { Capability } from "@fm/shared/rbac.js";
import type { SecretsCipher } from "@fm/core/lib/secrets-crypto.js";
import type { ProfileSecretsRepo } from "@fm/core/storage/repos/profile-secrets.js";
import type { AuditLogRepo } from "@fm/core/storage/repos/audit-log.js";

export interface WebContext {
  db: Db;
  profileId: string;
  fileConfig?: Config;
  databasePath?: string;
  cipher?: SecretsCipher;
  now: () => Date;
  loadConfig: () => Config;
  secretsRepo: () => ProfileSecretsRepo | undefined;
  audit: AuditLogRepo;
}

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Serialize the resolved capability set for the SPA. */
export function capabilityList(caps: Set<Capability>): Capability[] {
  return [...caps];
}

export function auditFromRequest(
  ctx: WebContext,
  req: FastifyRequest,
  action: string,
  options?: { target?: string | null; detail?: Record<string, unknown> },
): void {
  const path = req.url.split("?")[0];
  ctx.audit.recordFromRequest(
    {
      userId: req.currentUser?.id ?? null,
      actorEmail: req.currentUser?.email ?? null,
    },
    action,
    ctx.now().toISOString(),
    {
      target: options?.target ?? path,
      detail: {
        ...options?.detail,
        path,
        method: req.method,
        requestId: req.id,
      },
    },
  );
}

/**
 * Capability guard for `/api/*` routes. The server is the source of truth;
 * the SPA only uses `/api/me` to hide controls it cannot use.
 */
export function requireCapability(ctx: WebContext, cap: Capability) {
  return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!req.capabilities.has(cap)) {
      if (MUTATING_METHODS.has(req.method)) {
        auditFromRequest(ctx, req, "auth.forbidden", {
          detail: { capability: cap },
        });
      }
      reply.code(403).send({ error: "forbidden", capability: cap });
      return reply;
    }
  };
}
