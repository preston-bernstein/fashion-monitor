import type { FastifyInstance } from "fastify";
import { RunsRepo } from "@fm/core/storage/repos/runs.js";
import { AlertLogRepo } from "@fm/core/storage/repos/alert-log.js";
import type { HealthResponse, RunFunnelDto } from "@fm/shared/dto.js";
import type { WebContext } from "../context.js";
import { requireCapability } from "../context.js";

export async function registerHealthRoutes(app: FastifyInstance, ctx: WebContext): Promise<void> {
  app.get(
    "/api/profile-health",
    { preHandler: requireCapability(ctx, "analytics:read") },
    async (req, reply): Promise<HealthResponse> => {
      reply.header("Cache-Control", "no-store");
      const profileId = req.profileId!;
      const runs = new RunsRepo(ctx.db, profileId).recentFunnel(5);
      const lastAlertedAt = new AlertLogRepo(ctx.db, profileId).latestAlertedAt();

      const runDtos: RunFunnelDto[] = runs.map((r) => ({
        id: r.id,
        startedAt: r.started_at,
        finishedAt: r.finished_at,
        durationSeconds: r.duration_seconds,
        scraped: r.listings_found,
        new: r.listings_new,
        prefiltered: r.prefilter_rejected,
        scoredYes: r.scored_yes,
        scoredMaybe: r.scored_maybe,
        scoredNo: r.scored_no,
        alerted: r.alerts_sent,
        hadError: r.had_error === 1,
      }));

      return { runs: runDtos, lastAlertedAt };
    },
  );
}
