import { parsePrice } from "../../lib/http.js";

export function normalizePoshmark(item: {
  id: string;
  title: string;
  price: string;
  brand: string | null;
  size: string;
  url: string;
  image: string | null;
}) {
  return {
    id: item.id,
    platform: "poshmark" as const,
    title: item.title,
    description: item.title,
    price: parsePrice(item.price),
    currency: "USD",
    size: item.size,
    brand: item.brand,
    url: item.url,
    imageUrl: item.image,
    listedAt: null,
    condition: null,
    raw: item as unknown as Record<string, unknown>,
  };
}

export function parsePoshmarkTiles(raw: unknown[]): ReturnType<typeof normalizePoshmark>[] {
  return raw.map((item) =>
    normalizePoshmark(
      item as {
        id: string;
        title: string;
        price: string;
        brand: string | null;
        size: string;
        url: string;
        image: string | null;
      },
    ),
  );
}
