import type { FastifyInstance } from "fastify";
import { PLATFORMS, type Platform } from "@fm/shared/platforms.js";
import { MONITOR_STATUSES } from "@fm/shared/platforms.js";
import {
  SearchGroupCreateInputSchema,
  SearchGroupUpdateInputSchema,
  type ExecutionDto,
  type SearchGroupDto,
} from "@fm/shared/schemas/search-groups.js";
import type { ScrapeQueryRow } from "@fm/core/storage/repos/scrape-queries.js";
import { SearchGroupsRepo, type SearchGroupRow } from "@fm/core/storage/repos/search-groups.js";
import { ConfigRevisionsRepo } from "@fm/core/storage/repos/config-revisions.js";
import type { WebContext } from "../context.js";
import { auditFromRequest, requireCapability } from "../context.js";
import { parseBody } from "../validation.js";

function groupSnapshot(group: SearchGroupRow): Record<string, unknown> {
  return {
    query_text: group.query_text,
    platforms: group.platforms,
    query_overrides: group.query_overrides,
    enabled: Boolean(group.enabled),
    status: group.status,
    note: group.note,
  };
}

function groupDiff(
  before: SearchGroupRow,
  after: SearchGroupRow,
): { before: Record<string, unknown>; after: Record<string, unknown>; fields: string[] } {
  const prev = groupSnapshot(before);
  const next = groupSnapshot(after);
  const fields = Object.keys(next).filter(
    (key) => JSON.stringify(prev[key]) !== JSON.stringify(next[key]),
  );
  return { before: prev, after: next, fields };
}

function toGroupDto(
  group: SearchGroupRow,
  executions: ScrapeQueryRow[],
  lastRuns: Map<string, { error: string | null; run_started_at: string | null }>,
): SearchGroupDto {
  return {
    id: group.id,
    query_text: group.query_text,
    platforms: group.platforms,
    query_overrides:
      Object.keys(group.query_overrides).length > 0
        ? (group.query_overrides as SearchGroupDto["query_overrides"])
        : undefined,
    enabled: Boolean(group.enabled),
    status: group.status,
    note: group.note,
    updated_at: group.updated_at,
    executions: executions.map(
      (row): ExecutionDto => ({
        id: row.id,
        platform: row.platform,
        query_text: row.query_text,
        enabled: Boolean(row.enabled),
        status: row.status,
        last_error: lastRuns.get(row.id)?.error ?? null,
        last_run_at: lastRuns.get(row.id)?.run_started_at ?? null,
      }),
    ),
  };
}

function enabledPlatformsFromConfig(ctx: WebContext): Platform[] {
  const config = ctx.loadConfig();
  return PLATFORMS.filter((p) => config.platforms[p]);
}

export async function registerMonitorRoutes(app: FastifyInstance, ctx: WebContext): Promise<void> {
  const groupsRepo = () => new SearchGroupsRepo(ctx.db, ctx.profileId);

  function snapshotConfig(userId: number | null): void {
    const config = ctx.loadConfig();
    new ConfigRevisionsRepo(ctx.db, ctx.profileId).maybeSnapshot(
      config,
      null,
      ctx.now().toISOString(),
      userId,
    );
  }

  function listGroupsWithExecutions(): SearchGroupDto[] {
    const groups = groupsRepo();
    const allGroups = groups.listGroups();
    const allExecutions = groups.listAllExecutions();
    const executionsByGroup = new Map<string, ScrapeQueryRow[]>();
    for (const exec of allExecutions) {
      const bucket = executionsByGroup.get(exec.group_id);
      if (bucket) bucket.push(exec);
      else executionsByGroup.set(exec.group_id, [exec]);
    }
    const lastRuns = groups.fetchLastRunByExecution(allExecutions.map((e) => e.id));
    return allGroups.map((g) => toGroupDto(g, executionsByGroup.get(g.id) ?? [], lastRuns));
  }

  app.get(
    "/api/monitors",
    { preHandler: requireCapability(ctx, "monitors:read") },
    async (req, reply) => {
      reply.header("Cache-Control", "no-store");
      return {
        groups: listGroupsWithExecutions(),
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
      const data = parseBody(SearchGroupCreateInputSchema, req.body, reply);
      if (!data) return reply;
      const ts = ctx.now().toISOString();
      const groups = groupsRepo();
      if (groups.getGroup(data.id)) {
        reply.code(409);
        return { error: "duplicate", message: "Search group id already exists" };
      }

      const platforms =
        data.platforms && data.platforms.length > 0
          ? data.platforms
          : enabledPlatformsFromConfig(ctx);

      groups.createGroup(
        {
          id: data.id,
          query_text: data.query_text,
          platforms,
          query_overrides: data.query_overrides ?? {},
          enabled: data.enabled,
          status: data.status,
          note: data.note ?? null,
        },
        ts,
      );

      const created = groups.getGroup(data.id)!;
      auditFromRequest(ctx, req, "search_group.create", {
        target: data.id,
        detail: { after: groupSnapshot(created) },
      });
      snapshotConfig(req.currentUser!.id);
      reply.code(201);
      const lastRuns = groups.fetchLastRunByExecution(
        groups.listExecutions(data.id).map((e) => e.id),
      );
      return { group: toGroupDto(created, groups.listExecutions(data.id), lastRuns) };
    },
  );

  app.patch(
    "/api/monitors/:id",
    { preHandler: [app.csrfProtection, requireCapability(ctx, "monitors:write")] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const groups = groupsRepo();
      const existingGroup = groups.getGroup(id);
      if (!existingGroup) {
        reply.code(404);
        return { error: "not_found" };
      }

      const data = parseBody(SearchGroupUpdateInputSchema, req.body, reply);
      if (!data) return reply;
      const ts = ctx.now().toISOString();
      groups.updateGroup(
        id,
        {
          query_text: data.query_text ?? existingGroup.query_text,
          platforms: data.platforms ?? existingGroup.platforms,
          query_overrides:
            data.query_overrides !== undefined
              ? (data.query_overrides ?? {})
              : existingGroup.query_overrides,
          enabled: data.enabled ?? Boolean(existingGroup.enabled),
          status: data.status ?? existingGroup.status,
          note: data.note !== undefined ? data.note : existingGroup.note,
        },
        ts,
      );
      const updated = groups.getGroup(id)!;
      auditFromRequest(ctx, req, "search_group.update", {
        target: id,
        detail: groupDiff(existingGroup, updated),
      });
      snapshotConfig(req.currentUser!.id);
      const lastRuns = groups.fetchLastRunByExecution(groups.listExecutions(id).map((e) => e.id));
      return { group: toGroupDto(updated, groups.listExecutions(id), lastRuns) };
    },
  );

  app.delete(
    "/api/monitors/:id",
    { preHandler: [app.csrfProtection, requireCapability(ctx, "monitors:write")] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const groups = groupsRepo();
      const existingGroup = groups.getGroup(id);
      if (!existingGroup) {
        reply.code(404);
        return { error: "not_found" };
      }

      groups.deleteGroup(id);
      auditFromRequest(ctx, req, "search_group.delete", {
        target: id,
        detail: { before: groupSnapshot(existingGroup) },
      });
      snapshotConfig(req.currentUser!.id);
      return { ok: true };
    },
  );
}
