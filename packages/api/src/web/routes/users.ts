import type { FastifyInstance } from "fastify";
import { UsersRepo, MembershipsRepo } from "@fm/core/storage/repos/users.js";
import { SessionsRepo } from "@fm/core/storage/repos/sessions.js";
import { ROLES, ROLE_LABELS, type Role } from "@fm/shared/rbac.js";
import {
  CreateUserInputSchema,
  RoleInputSchema,
  StatusInputSchema,
} from "@fm/shared/schemas/users.js";
import { hashPassword } from "../auth.js";
import type { WebContext } from "../context.js";
import { auditFromRequest, requireCapability } from "../context.js";
import { parseBody } from "../validation.js";

export async function registerUserRoutes(app: FastifyInstance, ctx: WebContext): Promise<void> {
  const users = () => new UsersRepo(ctx.db);
  const memberships = () => new MembershipsRepo(ctx.db);

  app.get("/api/users", { preHandler: requireCapability(ctx, "users:manage") }, async (_req, reply) => {
    reply.header("Cache-Control", "no-store");
    return {
      users: users().listForProfile(ctx.profileId),
      roles: ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] })),
    };
  });

  app.post(
    "/api/users",
    { preHandler: [app.csrfProtection, requireCapability(ctx, "users:manage")] },
    async (req, reply) => {
      const data = parseBody(CreateUserInputSchema, req.body, reply);
      if (!data) return reply;
      const ts = ctx.now().toISOString();
      const u = users();
      if (u.findByEmail(data.email)) {
        reply.code(409);
        return { error: "duplicate", message: "A user with that email already exists" };
      }
      const userId = u.create(data.email, await hashPassword(data.password), ts);
      memberships().upsert(userId, ctx.profileId, data.role as Role, ts);
      auditFromRequest(ctx, req, "user.create", {
        target: data.email,
        detail: { role: data.role },
      });
      reply.code(201);
      return {
        user: { id: userId, email: data.email, role: data.role, status: "active" },
      };
    },
  );

  app.patch(
    "/api/users/:id/role",
    { preHandler: [app.csrfProtection, requireCapability(ctx, "users:manage")] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const userId = Number(id);
      const data = parseBody(RoleInputSchema, req.body, reply);
      if (!data) return reply;
      const u = users();
      const user = u.findById(userId);
      if (!user) {
        reply.code(404);
        return { error: "not_found" };
      }
      const membership = memberships().forUser(userId, ctx.profileId);
      if (!membership) {
        reply.code(404);
        return { error: "not_found" };
      }
      if (membership.role === "owner" && data.role !== "owner") {
        const owners = memberships().countOwners(ctx.profileId);
        if (owners <= 1) {
          reply.code(400);
          return { error: "last_owner", message: "Cannot demote the last owner" };
        }
      }
      const ts = ctx.now().toISOString();
      memberships().upsert(userId, ctx.profileId, data.role as Role, ts);
      new SessionsRepo(ctx.db).destroyForUser(userId);
      auditFromRequest(ctx, req, "user.role", {
        target: user.email,
        detail: { role: data.role },
      });
      return { ok: true };
    },
  );

  app.patch(
    "/api/users/:id/status",
    { preHandler: [app.csrfProtection, requireCapability(ctx, "users:manage")] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const userId = Number(id);
      const data = parseBody(StatusInputSchema, req.body, reply);
      if (!data) return reply;
      const u = users();
      const user = u.findById(userId);
      if (!user) {
        reply.code(404);
        return { error: "not_found" };
      }
      const ts = ctx.now().toISOString();
      u.setStatus(userId, data.status, ts);
      if (data.status === "disabled") new SessionsRepo(ctx.db).destroyForUser(userId);
      auditFromRequest(ctx, req, "user.status", {
        target: user.email,
        detail: { status: data.status },
      });
      return { ok: true };
    },
  );
}
