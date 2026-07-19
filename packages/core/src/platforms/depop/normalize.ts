import type { Listing } from "../../core/types.js";
import { LogEvents } from "../../lib/log-events.js";
import { createLogger } from "../../lib/logging.js";

// TODO(longer-term): the branches below dispatch on duck-typed response shape
// (presence/absence of `pricing.final_price_key`, etc). Once the caller knows
// which scraper tier produced the data, prefer an explicit source tag passed
// in over more shape-sniffing here.

const log = createLogger("platform.depop.normalize");

type DepopListingFields = Omit<Listing, "platform" | "sourceQueryId">;

function buildDepopListing(fields: DepopListingFields): Listing {
  return { ...fields, platform: "depop" };
}

/**
 * A single malformed product (missing id, unparseable price) must not sink
 * an entire page of otherwise-good results — normalizeDepop throws per-item
 * (per FR9/FR8: never silently default a required field), so this catches
 * that per item, logs it, and skips just the bad one rather than letting one
 * throw propagate through .map() and fail the whole batch.
 */
export function mapDepopProducts(products: Record<string, unknown>[]): Listing[] {
  const listings: Listing[] = [];
  for (const item of products) {
    try {
      listings.push(normalizeDepop(item));
    } catch (error) {
      log.warn(LogEvents.PlatformDepopItemInvalid, {
        error: error instanceof Error ? error.message : "unknown error",
      });
    }
  }
  return listings;
}

export function parseDepopProducts(raw: {
  objects?: Record<string, unknown>[];
  products?: Record<string, unknown>[];
  [key: string]: unknown;
}): Listing[] {
  const items = raw.objects ?? raw.products;
  if (!items) {
    if ("meta" in raw || "page_info" in raw) {
      throw new Error("Depop unexpected response shape");
    }
    return [];
  }
  return mapDepopProducts(items);
}

export function normalizeDepop(item: Record<string, unknown>): Listing {
  const pricing = item.pricing as { final_price_key?: string } | undefined;
  if (pricing?.final_price_key) {
    return normalizeDepopApiProduct(item);
  }
  if (item.pricing) {
    return normalizeDepopRscProduct(item);
  }

  const preview = (item.preview as Array<{ url: string }> | undefined)?.[0];
  const price = item.price as { amountUsd?: string; amount?: string } | undefined;
  const sizes = item.sizes as string[] | undefined;

  return buildDepopListing({
    id: String(item.id),
    title: String(item.description ?? ""),
    description: String(item.description ?? ""),
    price: parseFloat(price?.amountUsd ?? price?.amount ?? "0"),
    currency: "USD",
    size: sizes?.[0] ?? "",
    brand: item.brandName ? String(item.brandName) : null,
    url: `https://www.depop.com/products/${item.slug ?? item.id}/`,
    imageUrl: preview?.url ?? null,
    listedAt: item.lastUpdated ? new Date(String(item.lastUpdated)) : null,
    condition: item.condition ? String(item.condition) : null,
    raw: { ...item, _normalizerSource: "webapi-legacy" },
  });
}

type DepopApiPricing = {
  final_price_key?: string;
  currency?: string;
  [key: string]: { price_breakdown?: { price?: { amount?: string } } } | string | undefined;
};

/** Throws if the pricing object doesn't resolve to a parseable amount — never silently 0. */
function resolveDepopApiPrice(pricing: DepopApiPricing | undefined): number {
  const finalPriceKey = pricing?.final_price_key ?? "original_price";
  const finalPriceEntry = pricing?.[finalPriceKey] as
    | { price_breakdown?: { price?: { amount?: string } } }
    | undefined;
  const amountRaw = finalPriceEntry?.price_breakdown?.price?.amount;
  const price = amountRaw !== undefined ? parseFloat(amountRaw) : NaN;
  if (amountRaw === undefined || Number.isNaN(price)) {
    throw new Error("Depop product missing parseable price");
  }
  return price;
}

function resolveDepopApiImageUrl(item: Record<string, unknown>): string | null {
  const preview = item.preview as { formats?: { P0?: { url?: string } } } | undefined;
  const pictures = item.pictures as Array<{ formats?: { P0?: { url?: string } } }> | undefined;
  return preview?.formats?.P0?.url ?? pictures?.[0]?.formats?.P0?.url ?? null;
}

function normalizeDepopApiProduct(item: Record<string, unknown>): Listing {
  if (item.id === null || item.id === undefined) {
    throw new Error("Depop product missing id");
  }

  const slug = String(item.slug ?? item.id);
  const description = item.description ? String(item.description) : slug.replace(/-/g, " ");
  const pricing = item.pricing as DepopApiPricing | undefined;
  const price = resolveDepopApiPrice(pricing);
  const sizes = item.sizes as Array<{ name?: string }> | undefined;
  const attributes = item.attributes as { condition?: string } | undefined;

  return buildDepopListing({
    id: String(item.id),
    title: description,
    description,
    price,
    currency: pricing?.currency ?? "USD",
    size: sizes?.[0]?.name ?? "",
    brand: item.brand_name ? String(item.brand_name) : null,
    url: `https://www.depop.com/products/${slug}/`,
    imageUrl: resolveDepopApiImageUrl(item),
    listedAt: null,
    condition: attributes?.condition ? String(attributes.condition) : null,
    raw: { ...item, _normalizerSource: "api" },
  });
}

// Retained as documented legacy: a live investigation found the new API shape
// (normalizeDepopApiProduct) is closely related to but not identical to this
// RSC shape — see docs/depop-scraper-fix/investigation-findings.md.
function normalizeDepopRscProduct(item: Record<string, unknown>): Listing {
  const pricing = item.pricing as
    | {
        original_price?: { price_breakdown?: { price?: { amount?: string } } };
        discounted_price?: { price_breakdown?: { price?: { amount?: string } } };
        currency_name?: string;
      }
    | undefined;

  const amount =
    pricing?.discounted_price?.price_breakdown?.price?.amount ??
    pricing?.original_price?.price_breakdown?.price?.amount ??
    "0";

  const preview = item.preview as Record<string, string> | undefined;
  const pictures = item.pictures as Array<{ formats?: { P0?: { url?: string } } }> | undefined;

  const imageUrl =
    preview?.["640"] ??
    preview?.["1280"] ??
    preview?.["320"] ??
    pictures?.[0]?.formats?.P0?.url ??
    null;

  const sizes = item.sizes as string[] | undefined;
  const slug = String(item.slug ?? item.id);
  const description = item.description ? String(item.description) : slug.replace(/-/g, " ");

  return buildDepopListing({
    id: String(item.id),
    title: description,
    description,
    price: parseFloat(amount),
    currency: pricing?.currency_name ?? "USD",
    size: sizes?.[0] ?? "",
    brand: item.brand_name ? String(item.brand_name) : null,
    url: `https://www.depop.com/products/${slug}/`,
    imageUrl,
    listedAt: item.date_created ? new Date(String(item.date_created)) : null,
    condition: item.condition ? String(item.condition) : null,
    raw: { ...item, _normalizerSource: "rsc" },
  });
}
