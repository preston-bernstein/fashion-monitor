import type { Config } from "../core/config.js";
import type { Listing } from "../core/types.js";
import { classifyPriceCategory, priceCeilingForCategory } from "./category.js";

export const QUALITY_BLOCKLIST_BRANDS = new Set([
  "zara",
  "h&m",
  "shein",
  "forever 21",
  "fashion nova",
  "asos",
  "boohoo",
  "primark",
  "uniqlo",
  "old navy",
  "gap",
  "banana republic",
]);

export const QUALITY_BLOCKLIST_KEYWORDS = [
  "replica",
  "inspired by",
  "dupe",
  "faux leather",
  "pleather",
  "lot of",
  "bundle of",
  "wholesale",
  "slim fit",
  "graphic tee",
  "graphic print",
  "tropical",
  "floral",
];

export const PRIMARY_SYNTHETIC_FABRICS = [
  "100% polyester",
  "100% acrylic",
  "100% nylon",
  "polyester blend",
];

export const BRAND_PRICE_FLOORS: Record<string, number> = {
  "brunello cucinelli": 80,
  "helmut lang": 40,
  "john varvatos": 35,
  theory: 30,
  "rag & bone": 40,
  "engineered garments": 50,
};

export type PrefilterReason =
  | "blocklist_brand"
  | "blocklist_keyword"
  | "synthetic_fabric"
  | "price_floor"
  | "price_ceiling"
  | "hard_no";

export interface PrefilterResult {
  passed: Listing[];
  rejected: Array<{ listing: Listing; reason: PrefilterReason }>;
}

function searchableText(listing: Listing): string {
  return `${listing.title} ${listing.description} ${listing.brand ?? ""}`.toLowerCase();
}

function gateBlocklist(listing: Listing): PrefilterReason | null {
  const text = searchableText(listing);
  const brand = (listing.brand ?? "").toLowerCase();
  if ([...QUALITY_BLOCKLIST_BRANDS].some((b) => brand.includes(b))) {
    return "blocklist_brand";
  }
  if (QUALITY_BLOCKLIST_KEYWORDS.some((k) => text.includes(k))) {
    return "blocklist_keyword";
  }
  if (PRIMARY_SYNTHETIC_FABRICS.some((f) => text.includes(f))) {
    return "synthetic_fabric";
  }
  return null;
}

function gatePriceFloor(listing: Listing): PrefilterReason | null {
  const brand = (listing.brand ?? "").toLowerCase();
  for (const [name, floor] of Object.entries(BRAND_PRICE_FLOORS)) {
    if (brand.includes(name) && listing.price < floor) {
      return "price_floor";
    }
  }
  return null;
}

function gatePriceCeiling(listing: Listing, config: Config): PrefilterReason | null {
  const category = classifyPriceCategory(listing.title);
  const ceiling = priceCeilingForCategory(category, config.price_ceiling);
  if (listing.price > ceiling) return "price_ceiling";
  return null;
}

function gateHardNo(listing: Listing, config: Config): PrefilterReason | null {
  const text = searchableText(listing);
  if (config.hard_no.some((rule) => text.includes(rule.toLowerCase()))) {
    return "hard_no";
  }
  return null;
}

export function prefilterListings(listings: Listing[], config: Config): PrefilterResult {
  const passed: Listing[] = [];
  const rejected: Array<{ listing: Listing; reason: PrefilterReason }> = [];

  for (const listing of listings) {
    const reason =
      gateBlocklist(listing) ??
      gatePriceFloor(listing) ??
      gatePriceCeiling(listing, config) ??
      gateHardNo(listing, config);

    if (reason) {
      rejected.push({ listing, reason });
    } else {
      passed.push(listing);
    }
  }

  return { passed, rejected };
}
