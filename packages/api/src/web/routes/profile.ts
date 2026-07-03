import type { FastifyInstance } from "fastify";
import { deleteProfileCascade } from "@fm/core/storage/profile-deletion.js";
import { AuditLogRepo } from "@fm/core/storage/repos/audit-log.js";
import type { WebContext } from "../context.js";

/**
 * self-service-onboarding.md Phase 2 item 3: "Profile deletion is a
 * self-serve Owner action that cascades all profile_id-scoped rows,
 * secrets, and memberships." Deliberately gated by role === "owner" directly
 * rather than a Capability — every other capability in this codebase is
 * shared by owner AND admin (see rbac.ts's ROLE_CAPABILITIES), but a
 * cascading, irreversible delete of an entire profile's data is a strictly
 * narrower action than anything an admin can otherwise do.
 */
export async function registerProfileRoutes(app: FastifyInstance, ctx: WebContext): Promise<void> {
  app.delete("/api/profile", { preHandler: app.csrfProtection }, async (req, reply) => {
    if (req.currentUser?.role !== "owner") {
      reply.code(403);
      return { error: "forbidden", message: "Only the profile's owner can delete it" };
    }

    const profileId = req.profileId!;
    const ts = ctx.now().toISOString();

    // Record the deletion before the profile's own audit_log rows are
    // removed as part of the cascade — this row is the "final audit record"
    // the plan calls for, so it's written to the system profile, the one
    // durable place that survives the deletion.
    new AuditLogRepo(ctx.db, "default").recordFromRequest(
      { userId: req.currentUser.id, actorEmail: req.currentUser.email },
      "profile.delete",
      ts,
      { target: profileId, detail: { deletedProfileId: profileId, requestId: req.id } },
    );

    const result = deleteProfileCascade(ctx.db, profileId);
    // deleteProfileCascade already removed every `sessions` row scoped to
    // profileId, including this request's own — just clear the cookie
    // client-side. Sessions for the user's OTHER profiles (if any) are
    // untouched since they're scoped to a different profile_id.
    reply.clearCookie("sid", { path: "/" });

    return { ok: true, rowsDeleted: result.rowsDeleted };
  });
}
