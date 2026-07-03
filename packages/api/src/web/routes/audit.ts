import type { FastifyInstance } from "fastify";
import type { AuditCategory } from "@fm/shared/dto.js";
import type { WebContext } from "../context.js";
import { requireCapability } from "../context.js";

const AUDIT_CATEGORIES = new Set<AuditCategory>([
  "auth",
  "monitors",
  "settings",
  "secrets",
  "users",
  "system",
]);

function parseAuditQuery(query: Record<string, unknown>): {
  limit: number;
  offset: number;
  actionPrefix?: string;
  actorEmail?: string;
  since?: string;
  category?: AuditCategory;
} {
  const parsedLimit = Number.parseInt(String(query.limit ?? "50"), 10);
  const limit = Number.isFinite(parsedLimit) ? Math.min(100, Math.max(1, parsedLimit)) : 50;
  const parsedOffset = Number.parseInt(String(query.offset ?? "0"), 10);
  const offset = Number.isFinite(parsedOffset) ? Math.max(0, parsedOffset) : 0;

  const action =
    typeof query.action === "string" && query.action.trim() ? query.action.trim() : undefined;
  const actor =
    typeof query.actor === "string" && query.actor.trim() ? query.actor.trim() : undefined;
  const since =
    typeof query.since === "string" && query.since.trim() ? query.since.trim() : undefined;
  const categoryRaw = typeof query.category === "string" ? query.category.trim() : undefined;
  const category =
    categoryRaw && AUDIT_CATEGORIES.has(categoryRaw as AuditCategory)
      ? (categoryRaw as AuditCategory)
      : undefined;

  if (since && Number.isNaN(Date.parse(since))) {
    throw new Error("invalid_since");
  }

  return {
    limit,
    offset,
    actionPrefix: category ? undefined : action,
    actorEmail: actor,
    since,
    category,
  };
}

export async function registerAuditRoutes(app: FastifyInstance, ctx: WebContext): Promise<void> {
  app.get(
    "/api/audit",
    { preHandler: requireCapability(ctx, "system:read") },
    async (req, reply) => {
      reply.header("Cache-Control", "no-store");
      try {
        const filters = parseAuditQuery((req.query ?? {}) as Record<string, unknown>);
        const { entries, total } = ctx.audit.fetchFiltered(filters);
        return {
          entries,
          total,
          limit: filters.limit,
          offset: filters.offset,
          has_more: filters.offset + entries.length < total,
        };
      } catch (err) {
        if (err instanceof Error && err.message === "invalid_since") {
          reply.code(400);
          return { error: "invalid_since", message: "since must be a valid ISO date" };
        }
        throw err;
      }
    },
  );
}
