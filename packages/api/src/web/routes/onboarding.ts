import type { FastifyInstance } from "fastify";
import { ProfileSettingsRepo } from "@fm/core/storage/repos/profile-settings.js";
import type { OnboardingResponse } from "@fm/shared/dto.js";
import type { WebContext } from "../context.js";
import { requireCapability } from "../context.js";

const DISMISSED_KEY = "onboarding_checklist_dismissed";

export async function registerOnboardingRoutes(
  app: FastifyInstance,
  ctx: WebContext,
): Promise<void> {
  app.get(
    "/api/onboarding",
    { preHandler: requireCapability(ctx, "analytics:read") },
    (req): OnboardingResponse => {
      const settings = new ProfileSettingsRepo(ctx.db, req.profileId!);
      return { dismissed: settings.get<boolean>(DISMISSED_KEY) ?? false };
    },
  );

  app.post(
    "/api/onboarding/dismiss",
    { preHandler: [app.csrfProtection, requireCapability(ctx, "analytics:read")] },
    (req) => {
      const settings = new ProfileSettingsRepo(ctx.db, req.profileId!);
      settings.set(DISMISSED_KEY, true, ctx.now().toISOString());
      return { ok: true };
    },
  );
}
