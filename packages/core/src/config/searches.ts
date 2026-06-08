import type { Config, SearchQueryDef } from "../core/config.js";
import type { Platform } from "../core/types.js";
import { PLATFORMS } from "../core/types.js";

export interface SearchRequest {
  queryId: string;
  text: string;
}

export const DEFAULT_SEARCHES: Record<Platform, SearchQueryDef[]> = {
  ebay: [
    {
      id: "ebay-corduroy-jacket",
      q: "men jacket corduroy charcoal black XXL",
      enabled: true,
      status: "active",
    },
    {
      id: "ebay-designer-shirt",
      q: "john varvatos helmut lang theory XXL shirt",
      enabled: true,
      status: "active",
    },
    {
      id: "ebay-wool-sweater",
      q: "dale norway sweater men XXL wool",
      enabled: true,
      status: "active",
    },
  ],
  grailed: [
    {
      id: "grailed-textured-knit",
      q: "corduroy waffle knit wool dark textured",
      enabled: true,
      status: "active",
    },
    {
      id: "grailed-designer",
      q: "john varvatos helmut lang engineered garments theory",
      enabled: true,
      status: "active",
    },
  ],
  vestiaire: [
    { id: "vestiaire-corduroy", q: "corduroy jacket men", enabled: true, status: "active" },
  ],
  vinted: [
    { id: "vinted-corduroy", q: "corduroy jacket men XXL", enabled: true, status: "active" },
  ],
  depop: [
    { id: "depop-corduroy", q: "corduroy jacket shirt dark", enabled: true, status: "active" },
  ],
  poshmark: [
    { id: "poshmark-corduroy", q: "corduroy jacket dark", enabled: true, status: "active" },
  ],
};

export function resolvePlatformSearches(config: Config, platform: Platform): SearchRequest[] {
  const configured = config.searches?.[platform] ?? DEFAULT_SEARCHES[platform];
  return configured
    .filter((entry) => entry.enabled !== false && entry.status !== "paused")
    .map((entry) => ({ queryId: entry.id, text: entry.q }));
}

export function allPlatformSearches(config: Config): Map<Platform, SearchRequest[]> {
  const map = new Map<Platform, SearchRequest[]>();
  for (const platform of PLATFORMS) {
    if (config.platforms[platform]) {
      map.set(platform, resolvePlatformSearches(config, platform));
    }
  }
  return map;
}

export function tagListings<T extends { sourceQueryId?: string }>(
  listings: T[],
  queryId: string,
): T[] {
  return listings.map((listing) => ({ ...listing, sourceQueryId: queryId }));
}
