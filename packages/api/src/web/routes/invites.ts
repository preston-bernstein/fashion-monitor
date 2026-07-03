import type { FastifyInstance } from "fastify";
import { InvitesRepo } from "@fm/core/storage/repos/invites.js";
import { UsersRepo, MembershipsRepo, ProfilesRepo } from "@fm/core/storage/repos/users.js";
import { SessionsRepo } from "@fm/core/storage/repos/sessions.js";
import { AuditLogRepo } from "@fm/core/storage/repos/audit-log.js";
import {
  InviteRedeemInputSchema,
  PasswordResetRedeemInputSchema,
} from "@fm/shared/schemas/invites.js";
import { hashPassword } from "../auth.js";
import { generateInviteToken, hashInviteToken, slugFromEmail, INVITE_TTL_SECONDS } from "../invites.js";
import type { WebContext } from "../context.js";
import { auditFromRequest, requireCapability } from "../context.js";
import { parseBody } from "../validation.js";

export async function registerInviteRoutes(app: FastifyInstance, ctx: WebContext): Promise<void> {
  const invites = () => new InvitesRepo(ctx.db);
  const users = () => new UsersRepo(ctx.db);

  // --- Owner/admin: issue a signup invite for the CURRENT profile's owner
  // to hand to a new person. Redeeming it creates an entirely separate,
  // fresh Profile — this route only records who issued it and when it
  // expires; it isn't scoped to req.profileId because the profile it
  // produces doesn't exist yet.
  app.post(
    "/api/invites",
    { preHandler: [app.csrfProtection, requireCapability(ctx, "users:manage")] },
    async (req, reply) => {
      const ts = ctx.now().toISOString();
      const { token, tokenHash } = generateInviteToken();
      const expiresAt = new Date(ctx.now().getTime() + INVITE_TTL_SECONDS * 1000).toISOString();
      invites().create(
        { tokenHash, purpose: "signup", createdBy: req.currentUser!.id, expiresAt },
        ts,
      );
      auditFromRequest(ctx, req, "invite.create", { detail: { purpose: "signup" } });
      reply.code(201);
      return { token, expiresAt };
    },
  );

  // --- Public: redeem a signup invite. Creates User + fresh Profile + Owner
  // membership (ADR-0003). No session is created here — the client calls
  // POST /api/login separately with the credentials it just set.
  app.post("/api/invites/redeem", { preHandler: app.csrfProtection }, async (req, reply) => {
    const data = parseBody(InviteRedeemInputSchema, req.body, reply);
    if (!data) return reply;

    const ts = ctx.now().toISOString();
    const invite = invites().findValidByTokenHash(hashInviteToken(data.token), ts);
    if (!invite || invite.purpose !== "signup") {
      reply.code(400);
      return { error: "invalid_invite", message: "This invite link is invalid or has expired." };
    }

    const u = users();
    if (u.findByEmail(data.email)) {
      reply.code(409);
      return { error: "duplicate", message: "A user with that email already exists" };
    }

    const profileId = slugFromEmail(data.email);
    new ProfilesRepo(ctx.db).ensure(profileId, data.email, ts);
    const userId = u.create(data.email, await hashPassword(data.password), ts);
    new MembershipsRepo(ctx.db).upsert(userId, profileId, "owner", ts);
    invites().consume(invite.id, profileId, ts);

    new AuditLogRepo(ctx.db, profileId).recordFromRequest(
      { userId, actorEmail: data.email },
      "invite.redeem",
      ts,
      { target: data.email, detail: { requestId: req.id } },
    );

    reply.code(201);
    return { ok: true, email: data.email };
  });

  // --- Owner/admin: generate a one-time password-reset link for an existing
  // user IN THE CURRENT profile. Reuses the invite table/machinery (same
  // token/hash/expiry shape) per self-service-onboarding.md Phase 2 item 2.
  app.post(
    "/api/users/:id/password-reset-link",
    { preHandler: [app.csrfProtection, requireCapability(ctx, "users:manage")] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const userId = Number(id);
      const membership = new MembershipsRepo(ctx.db).forUser(userId, req.profileId!);
      if (!membership) {
        reply.code(404);
        return { error: "not_found" };
      }

      const ts = ctx.now().toISOString();
      const { token, tokenHash } = generateInviteToken();
      const expiresAt = new Date(ctx.now().getTime() + INVITE_TTL_SECONDS * 1000).toISOString();
      invites().create(
        {
          tokenHash,
          purpose: "password_reset",
          createdBy: req.currentUser!.id,
          targetUserId: userId,
          expiresAt,
        },
        ts,
      );
      auditFromRequest(ctx, req, "password.reset.link", { target: String(userId) });
      reply.code(201);
      return { token, expiresAt };
    },
  );

  // --- Public: redeem a password-reset link. Updates the target user's
  // password and destroys their existing sessions (same as an admin-forced
  // role/status change already does elsewhere in users.ts).
  app.post(
    "/api/invites/redeem-password-reset",
    { preHandler: app.csrfProtection },
    async (req, reply) => {
      const data = parseBody(PasswordResetRedeemInputSchema, req.body, reply);
      if (!data) return reply;

      const ts = ctx.now().toISOString();
      const invite = invites().findValidByTokenHash(hashInviteToken(data.token), ts);
      if (!invite || invite.purpose !== "password_reset" || !invite.target_user_id) {
        reply.code(400);
        return { error: "invalid_invite", message: "This reset link is invalid or has expired." };
      }

      const user = users().findById(invite.target_user_id);
      if (!user) {
        reply.code(404);
        return { error: "not_found" };
      }

      users().updatePassword(user.id, await hashPassword(data.password), ts);
      new SessionsRepo(ctx.db).destroyForUser(user.id);
      invites().consume(invite.id, null, ts);

      const memberships = new MembershipsRepo(ctx.db).listForUser(user.id);
      const profileId = memberships[0]?.profile_id;
      if (profileId) {
        new AuditLogRepo(ctx.db, profileId).recordFromRequest(
          { userId: user.id, actorEmail: user.email },
          "password.reset",
          ts,
          { target: user.email, detail: { requestId: req.id } },
        );
      }

      return { ok: true };
    },
  );
}
