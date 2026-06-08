import type { Listing } from "../../core/types.js";

type DepopListingFields = Omit<Listing, "platform" | "sourceQueryId">;

function buildDepopListing(fields: DepopListingFields): Listing {
  return { ...fields, platform: "depop" };
}

export function mapDepopProducts(products: Record<string, unknown>[]): Listing[] {
  return products.map((item) => normalizeDepop(item));
}

export function parseDepopProducts(raw: { products?: Record<string, unknown>[] }): Listing[] {
  return mapDepopProducts(raw.products ?? []);
}

export function normalizeDepop(item: Record<string, unknown>): Listing {
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
    raw: item,
  });
}

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
    raw: item,
  });
}
