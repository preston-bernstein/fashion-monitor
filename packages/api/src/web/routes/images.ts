import type { FastifyInstance } from "fastify";
import type { Platform } from "@fm/shared/platforms.js";
import { PLATFORMS } from "@fm/shared/platforms.js";
import { SearchGroupImageAddInputSchema } from "@fm/shared/schemas/images.js";
import { ListingImagesRepo } from "@fm/core/storage/repos/listing-images.js";
import { SearchGroupImagesRepo } from "@fm/core/storage/repos/search-group-images.js";
import { SearchGroupsRepo } from "@fm/core/storage/repos/search-groups.js";
import type { WebContext } from "../context.js";
import { auditFromRequest, requireCapability } from "../context.js";
import { parseBody } from "../validation.js";

function toListingImageDto(row: {
  url: string;
  position: number;
  width: number | null;
  height: number | null;
}) {
  return {
    url: row.url,
    position: row.position,
    width: row.width,
    height: row.height,
  };
}

function toSearchGroupImageDto(row: {
  id: number;
  source: "listing" | "url";
  listing_platform: Platform | null;
  listing_id: string | null;
  url: string;
  sort_order: number;
  caption: string | null;
  created_at: string;
  updated_at: string;
}) {
  return {
    id: row.id,
    source: row.source,
    listing_platform: row.listing_platform,
    listing_id: row.listing_id,
    url: row.url,
    sort_order: row.sort_order,
    caption: row.caption,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function registerImageRoutes(app: FastifyInstance, ctx: WebContext): Promise<void> {
  const listingImages = (profileId: string) => new ListingImagesRepo(ctx.db, profileId);
  const groupImages = (profileId: string) => new SearchGroupImagesRepo(ctx.db, profileId);
  const groups = (profileId: string) => new SearchGroupsRepo(ctx.db, profileId);

  app.get(
    "/api/monitors/:id/images",
    { preHandler: requireCapability(ctx, "monitors:read") },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      if (!groups(req.profileId!).getGroup(id)) {
        reply.code(404);
        return { error: "not_found" };
      }

      reply.header("Cache-Control", "private, max-age=60");
      const curated = groupImages(req.profileId!).listForGroup(id);
      const fallback = listingImages(req.profileId!).findAutoPickForGroup(id, 5);
      return {
        group_id: id,
        curated: curated.map(toSearchGroupImageDto),
        fallback,
      };
    },
  );

  app.post(
    "/api/monitors/:id/images",
    { preHandler: [app.csrfProtection, requireCapability(ctx, "monitors:write")] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      if (!groups(req.profileId!).getGroup(id)) {
        reply.code(404);
        return { error: "not_found" };
      }

      const data = parseBody(SearchGroupImageAddInputSchema, req.body, reply);
      if (!data) return reply;

      const ts = ctx.now().toISOString();
      const repo = groupImages(req.profileId!);

      try {
        const image =
          data.source === "listing"
            ? repo.addFromListing(id, data.platform, data.listing_id, ts, data.caption)
            : repo.addFromUrl(id, data.url, ts, data.caption);

        auditFromRequest(ctx, req, "search_group.image.add", {
          target: id,
          detail: { image_id: image.id, source: data.source },
        });
        reply.code(201);
        return { image: toSearchGroupImageDto(image) };
      } catch (err) {
        const message = err instanceof Error ? err.message : "add_failed";
        if (message === "listing_has_no_images") {
          reply.code(404);
          return { error: "listing_has_no_images" };
        }
        if (message === "image_url_not_allowed") {
          reply.code(400);
          return { error: "image_url_not_allowed" };
        }
        throw err;
      }
    },
  );

  app.delete(
    "/api/monitors/:id/images/:imageId",
    { preHandler: [app.csrfProtection, requireCapability(ctx, "monitors:write")] },
    async (req, reply) => {
      const { id, imageId } = req.params as { id: string; imageId: string };
      if (!groups(req.profileId!).getGroup(id)) {
        reply.code(404);
        return { error: "not_found" };
      }

      const numericId = Number(imageId);
      if (!Number.isInteger(numericId) || numericId <= 0) {
        reply.code(400);
        return { error: "invalid_input" };
      }

      const existing = groupImages(req.profileId!).getById(numericId);
      if (!existing || existing.group_id !== id) {
        reply.code(404);
        return { error: "not_found" };
      }

      groupImages(req.profileId!).remove(numericId);
      auditFromRequest(ctx, req, "search_group.image.remove", {
        target: id,
        detail: { image_id: numericId },
      });
      return { ok: true };
    },
  );

  app.get(
    "/api/listings/:platform/:listingId/images",
    { preHandler: requireCapability(ctx, "monitors:read") },
    async (req, reply) => {
      const { platform, listingId } = req.params as { platform: string; listingId: string };
      if (!(PLATFORMS as readonly string[]).includes(platform)) {
        reply.code(400);
        return { error: "invalid_platform" };
      }

      reply.header("Cache-Control", "private, max-age=300");
      const images = listingImages(req.profileId!).listForListing(platform as Platform, listingId);
      return {
        platform,
        listing_id: listingId,
        images: images.map(toListingImageDto),
      };
    },
  );
}
