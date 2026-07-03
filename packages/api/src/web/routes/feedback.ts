import type { FastifyInstance } from "fastify";
import { FeedbackCreateInputSchema } from "@fm/shared/schemas/feedback.js";
import { FeedbackRepo } from "@fm/core/storage/repos/feedback.js";
import { AlertLogRepo } from "@fm/core/storage/repos/alert-log.js";
import { buildFeedbackInsert } from "@fm/core/alerts/feedback-record.js";
import type { WebContext } from "../context.js";
import { auditFromRequest, requireCapability } from "../context.js";
import { parseBody } from "../validation.js";

export async function registerFeedbackRoutes(app: FastifyInstance, ctx: WebContext): Promise<void> {
  app.post(
    "/api/feedback",
    { preHandler: [app.csrfProtection, requireCapability(ctx, "feedback:write")] },
    async (req, reply) => {
      const data = parseBody(FeedbackCreateInputSchema, req.body, reply);
      if (!data) return reply;

      const alertLog = new AlertLogRepo(ctx.db, ctx.profileId);
      const row = buildFeedbackInsert(
        { platform: data.platform, listing_id: data.listing_id, signal: data.signal },
        alertLog,
      );

      const ts = ctx.now().toISOString();
      new FeedbackRepo(ctx.db, ctx.profileId).insert(row, ts);

      auditFromRequest(ctx, req, "feedback.record", {
        target: `${data.platform}:${data.listing_id}`,
        detail: { signal: data.signal, source_query_id: row.source_query_id ?? null },
      });

      reply.code(201);
      return { ok: true };
    },
  );
}
