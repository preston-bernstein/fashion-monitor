import { z } from "zod";
import { PLATFORMS } from "../platforms.js";

export const ListingImageDtoSchema = z.object({
  url: z.string().url(),
  position: z.number().int().nonnegative(),
  width: z.number().int().positive().nullable().optional(),
  height: z.number().int().positive().nullable().optional(),
});

export type ListingImageDto = z.infer<typeof ListingImageDtoSchema>;

export const SearchGroupImageDtoSchema = z.object({
  id: z.number().int().positive(),
  source: z.enum(["listing", "url"]),
  listing_platform: z.enum(PLATFORMS).nullable(),
  listing_id: z.string().nullable(),
  url: z.string().url(),
  sort_order: z.number().int(),
  caption: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

export type SearchGroupImageDto = z.infer<typeof SearchGroupImageDtoSchema>;

export const SearchGroupImagesResponseSchema = z.object({
  group_id: z.string(),
  curated: z.array(SearchGroupImageDtoSchema),
  fallback: z.array(
    z.object({
      platform: z.enum(PLATFORMS),
      listing_id: z.string(),
      url: z.string().url(),
      score: z.string().nullable(),
    }),
  ),
});

export type SearchGroupImagesResponse = z.infer<typeof SearchGroupImagesResponseSchema>;

export const ListingImagesResponseSchema = z.object({
  platform: z.enum(PLATFORMS),
  listing_id: z.string(),
  images: z.array(ListingImageDtoSchema),
});

export type ListingImagesResponse = z.infer<typeof ListingImagesResponseSchema>;

export const SearchGroupImageAddListingSchema = z.object({
  source: z.literal("listing"),
  platform: z.enum(PLATFORMS),
  listing_id: z.string().trim().min(1).max(120),
  caption: z.string().trim().max(200).optional(),
});

export const SearchGroupImageAddUrlSchema = z.object({
  source: z.literal("url"),
  url: z.string().url().max(2000),
  caption: z.string().trim().max(200).optional(),
});

export const SearchGroupImageAddInputSchema = z.discriminatedUnion("source", [
  SearchGroupImageAddListingSchema,
  SearchGroupImageAddUrlSchema,
]);

export type SearchGroupImageAddInput = z.infer<typeof SearchGroupImageAddInputSchema>;
