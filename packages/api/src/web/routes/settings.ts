import type { FastifyInstance } from "fastify";
import { PLATFORMS } from "@fm/shared/platforms.js";
import {
  ALERT_MODES,
  LLM_PROVIDERS,
  LlmConfigSchema,
  SystemInputSchema,
  TasteInputSchema,
  VISION_BACKENDS,
} from "@fm/shared/schemas/config.js";
import { ProfileSettingsRepo } from "@fm/core/storage/repos/profile-settings.js";
import { ConfigRevisionsRepo } from "@fm/core/storage/repos/config-revisions.js";
import type { WebContext } from "../context.js";
import { auditFromRequest, requireCapability } from "../context.js";
import { parseBody } from "../validation.js";

export { LLM_PROVIDERS, VISION_BACKENDS, ALERT_MODES };

function changedKeys(before: Record<string, unknown>, after: Record<string, unknown>): string[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys].filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]));
}

export async function registerSettingsRoutes(app: FastifyInstance, ctx: WebContext): Promise<void> {
  const settings = () => new ProfileSettingsRepo(ctx.db, ctx.profileId);

  function snapshot(userId: number): void {
    new ConfigRevisionsRepo(ctx.db, ctx.profileId).maybeSnapshot(
      ctx.loadConfig(),
      null,
      ctx.now().toISOString(),
      userId,
    );
  }

  app.get("/api/taste", { preHandler: requireCapability(ctx, "taste:read") }, async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    const s = settings();
    return {
      taste: {
        aesthetic_prompt: s.get<string>("aesthetic_prompt") ?? "",
        hard_no: s.get<string[]>("hard_no") ?? [],
        positive_signals: s.get<{ strong: string[]; weak: string[] }>("positive_signals") ?? {
          strong: [],
          weak: [],
        },
        price_ceiling: s.get<Record<string, number>>("price_ceiling") ?? { default: 0 },
        measurements: s.get<Record<string, unknown>>("measurements") ?? {},
      },
      canWrite: req.capabilities.has("taste:write"),
    };
  });

  app.put(
    "/api/taste",
    { preHandler: [app.csrfProtection, requireCapability(ctx, "taste:write")] },
    async (req, reply) => {
      const data = parseBody(TasteInputSchema, req.body, reply);
      if (!data) return reply;
      const ts = ctx.now().toISOString();
      const s = settings();
      const beforeTaste = {
        aesthetic_prompt: s.get<string>("aesthetic_prompt") ?? "",
        hard_no: s.get<string[]>("hard_no") ?? [],
        positive_signals: s.get<{ strong: string[]; weak: string[] }>("positive_signals") ?? {
          strong: [],
          weak: [],
        },
        price_ceiling: s.get<Record<string, number>>("price_ceiling") ?? { default: 0 },
        measurements: s.get<Record<string, unknown>>("measurements") ?? {},
      };
      s.set("aesthetic_prompt", data.aesthetic_prompt, ts);
      s.set("hard_no", data.hard_no, ts);
      s.set("positive_signals", data.positive_signals, ts);
      s.set("price_ceiling", data.price_ceiling, ts);
      s.set("measurements", data.measurements, ts);

      const afterTaste = {
        aesthetic_prompt: data.aesthetic_prompt,
        hard_no: data.hard_no,
        positive_signals: data.positive_signals,
        price_ceiling: data.price_ceiling,
        measurements: data.measurements,
      };
      auditFromRequest(ctx, req, "taste.update", {
        detail: { fields: changedKeys(beforeTaste, afterTaste) },
      });
      snapshot(req.currentUser!.id);
      return { ok: true };
    },
  );

  app.get("/api/system", { preHandler: requireCapability(ctx, "system:read") }, async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    const s = settings();
    return {
      system: {
        platforms: (s.get<Record<string, boolean>>("platforms") ?? {}) as Record<string, boolean>,
        llm: LlmConfigSchema.parse(s.get("llm") ?? {}),
        alert_options: s.get<{ mode: string; notify_empty: boolean }>("alert_options") ?? {
          mode: "immediate",
          notify_empty: false,
        },
        scraper: s.get<{ poshmark_profile_path: string }>("scraper") ?? {
          poshmark_profile_path: "data/poshmark-profile",
        },
      },
      options: {
        platforms: [...PLATFORMS],
        providers: [...LLM_PROVIDERS],
        visionBackends: [...VISION_BACKENDS],
        alertModes: [...ALERT_MODES],
      },
      canWrite: req.capabilities.has("system:write"),
    };
  });

  app.put(
    "/api/system",
    { preHandler: [app.csrfProtection, requireCapability(ctx, "system:write")] },
    async (req, reply) => {
      const data = parseBody(SystemInputSchema, req.body, reply);
      if (!data) return reply;
      const ts = ctx.now().toISOString();
      const s = settings();

      const beforeSystem = {
        platforms: (s.get<Record<string, boolean>>("platforms") ?? {}) as Record<string, boolean>,
        llm: LlmConfigSchema.parse(s.get("llm") ?? {}),
        alert_options: s.get<{ mode: string; notify_empty: boolean }>("alert_options") ?? {
          mode: "immediate",
          notify_empty: false,
        },
        scraper: s.get<{ poshmark_profile_path: string }>("scraper") ?? {
          poshmark_profile_path: "data/poshmark-profile",
        },
      };

      const platforms: Record<string, boolean> = {};
      for (const p of PLATFORMS) platforms[p] = data.platforms?.[p] === true;

      s.set("platforms", platforms, ts);
      s.set("llm", data.llm, ts);
      s.set("alert_options", data.alert_options, ts);
      s.set("scraper", data.scraper, ts);

      const afterSystem = {
        platforms,
        llm: data.llm,
        alert_options: data.alert_options,
        scraper: data.scraper,
      };
      auditFromRequest(ctx, req, "system.update", {
        detail: { fields: changedKeys(beforeSystem, afterSystem) },
      });
      snapshot(req.currentUser!.id);
      return { ok: true };
    },
  );
}
