import type { FastifyInstance } from "fastify";
import { PLATFORMS, type Platform } from "@fm/shared/platforms.js";
import { MONITOR_STATUSES } from "@fm/shared/platforms.js";
import {
  MonitorCreateInputSchema,
  MonitorUpdateInputSchema,
  type MonitorDto,
} from "@fm/shared/schemas/monitors.js";
import { ScrapeQueriesRepo, type ScrapeQueryRow } from "@fm/core/storage/repos/scrape-queries.js";
import { ConfigRevisionsRepo } from "@fm/core/storage/repos/config-revisions.js";
import type { WebContext } from "../context.js";
import { auditFromRequest, requireCapability } from "../context.js";
import { parseBody } from "../validation.js";

function monitorSnapshot(row: ScrapeQueryRow): Record<string, unknown> {
  return {
    platform: row.platform,
    query_text: row.query_text,
    enabled: Boolean(row.enabled),
    status: row.status,
    note: row.note,
  };
}

function monitorDiff(
  before: ScrapeQueryRow,
  after: ScrapeQueryRow,
): { before: Record<string, unknown>; after: Record<string, unknown>; fields: string[] } {
  const prev = monitorSnapshot(before);
  const next = monitorSnapshot(after);
  const fields = Object.keys(next).filter(
    (key) => JSON.stringify(prev[key]) !== JSON.stringify(next[key]),
  );
  return { before: prev, after: next, fields };
}

function toDto(row: ScrapeQueryRow): MonitorDto {
  return {
    id: row.id,
    platform: row.platform,
    query_text: row.query_text,
    enabled: Boolean(row.enabled),
    status: row.status,
    note: row.note,
    updated_at: row.updated_at,
  };
}

export async function registerMonitorRoutes(app: FastifyInstance, ctx: WebContext): Promise<void> {
  const repo = () => new ScrapeQueriesRepo(ctx.db, ctx.profileId);

  function snapshotConfig(userId: number | null): void {
    const config = ctx.loadConfig();
    new ConfigRevisionsRepo(ctx.db, ctx.profileId).maybeSnapshot(
      config,
      null,
      ctx.now().toISOString(),
      userId,
    );
  }

  app.get(
    "/api/monitors",
    { preHandler: requireCapability(ctx, "monitors:read") },
    async (req, reply) => {
      reply.header("Cache-Control", "no-store");
      return {
        monitors: repo().listMonitors().map(toDto),
        platforms: [...PLATFORMS],
        statuses: [...MONITOR_STATUSES],
        canWrite: req.capabilities.has("monitors:write"),
      };
    },
  );

  app.post(
    "/api/monitors",
    { preHandler: [app.csrfProtection, requireCapability(ctx, "monitors:write")] },
    async (req, reply) => {
      const data = parseBody(MonitorCreateInputSchema, req.body, reply);
      if (!data) return reply;
      const r = repo();
      if (r.getMonitor(data.id)) {
        reply.code(409);
        return { error: "duplicate", message: "Monitor id already exists" };
      }
      const ts = ctx.now().toISOString();
      r.createMonitor(
        {
          id: data.id,
          platform: data.platform as Platform,
          query_text: data.query_text,
          enabled: data.enabled,
          status: data.status,
          note: data.note ?? null,
        },
        ts,
      );
      auditFromRequest(ctx, req, "monitor.create", {
        target: data.id,
        detail: {
          after: {
            platform: data.platform,
            query_text: data.query_text,
            enabled: data.enabled,
            status: data.status,
            note: data.note ?? null,
          },
        },
      });
      snapshotConfig(req.currentUser!.id);
      reply.code(201);
      return { monitor: toDto(r.getMonitor(data.id)!) };
    },
  );

  app.patch(
    "/api/monitors/:id",
    { preHandler: [app.csrfProtection, requireCapability(ctx, "monitors:write")] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const r = repo();
      const existing = r.getMonitor(id);
      if (!existing) {
        reply.code(404);
        return { error: "not_found" };
      }
      const data = parseBody(MonitorUpdateInputSchema, req.body, reply);
      if (!data) return reply;
      const ts = ctx.now().toISOString();
      r.updateMonitor(
        id,
        {
          platform: (data.platform ?? existing.platform) as Platform,
          query_text: data.query_text ?? existing.query_text,
          enabled: data.enabled ?? Boolean(existing.enabled),
          status: data.status ?? existing.status,
          note: data.note !== undefined ? data.note : existing.note,
        },
        ts,
      );
      const updated = r.getMonitor(id)!;
      auditFromRequest(ctx, req, "monitor.update", {
        target: id,
        detail: monitorDiff(existing, updated),
      });
      snapshotConfig(req.currentUser!.id);
      return { monitor: toDto(r.getMonitor(id)!) };
    },
  );

  app.delete(
    "/api/monitors/:id",
    { preHandler: [app.csrfProtection, requireCapability(ctx, "monitors:write")] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const r = repo();
      const existing = r.getMonitor(id);
      if (!existing) {
        reply.code(404);
        return { error: "not_found" };
      }
      r.deleteMonitor(id);
      auditFromRequest(ctx, req, "monitor.delete", {
        target: id,
        detail: { before: monitorSnapshot(existing) },
      });
      snapshotConfig(req.currentUser!.id);
      return { ok: true };
    },
  );
}
