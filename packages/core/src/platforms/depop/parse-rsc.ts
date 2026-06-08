import type { Listing } from "../../core/types.js";
import { mapDepopProducts } from "./normalize.js";

export interface DepopSearchPayload {
  meta?: {
    result_count?: number;
    total_count?: number;
    has_more?: boolean;
    cursor?: string;
  };
  products: Record<string, unknown>[];
}

const SEARCH_MARKER = '"data":{"meta":{"result_count":';

function decodeNextFlightChunk(raw: string): string | null {
  const end = raw.lastIndexOf('"])');
  if (end < 0) return null;
  try {
    return JSON.parse(`"${raw.slice(0, end)}"`) as string;
  } catch {
    return null;
  }
}

function parseBalancedJsonObject(
  text: string,
  openBraceIndex: number,
): Record<string, unknown> | null {
  let depth = 0;
  let end = openBraceIndex;

  for (let i = openBraceIndex; i < text.length; i++) {
    const char = text[i];
    if (char === "{") depth++;
    else if (char === "}") {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }

  if (depth !== 0) return null;

  try {
    return JSON.parse(text.slice(openBraceIndex, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function extractDepopSearchFromHtml(html: string): DepopSearchPayload | null {
  const chunks = html.split('self.__next_f.push([1,"');
  for (const part of chunks) {
    if (!part) continue;
    const decoded = decodeNextFlightChunk(part);
    if (!decoded) continue;

    const markerIndex = decoded.indexOf(SEARCH_MARKER);
    if (markerIndex < 0) continue;

    const openBraceIndex = decoded.indexOf("{", markerIndex + 7);
    if (openBraceIndex < 0) continue;

    const data = parseBalancedJsonObject(decoded, openBraceIndex);
    if (!data?.products || !Array.isArray(data.products)) continue;

    return {
      meta: data.meta as DepopSearchPayload["meta"],
      products: data.products as Record<string, unknown>[],
    };
  }

  return null;
}

export function buildDepopSearchUrl(query: string): string {
  const params = new URLSearchParams({
    q: query,
    gender: "male",
    sort: "newest",
    sizes: "US-L,US-XL,US-XXL,US-2XL",
  });
  return `https://www.depop.com/search/?${params}`;
}

export function extractDepopListingsFromHtml(html: string): Listing[] {
  const payload = extractDepopSearchFromHtml(html);
  if (!payload?.products.length) return [];
  return mapDepopProducts(payload.products);
}
