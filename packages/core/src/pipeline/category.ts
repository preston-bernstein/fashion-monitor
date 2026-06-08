import type { PriceCategory } from "../core/types.js";

const OUTERWEAR_KEYWORDS = [
  "jacket",
  "coat",
  "blazer",
  "parka",
  "overcoat",
  "vest",
  "gilet",
  "anorak",
  "windbreaker",
];

const PANTS_KEYWORDS = ["pants", "trousers", "jeans", "chinos", "shorts", "denim"];

export function classifyPriceCategory(title: string): PriceCategory {
  const lower = title.toLowerCase();
  if (OUTERWEAR_KEYWORDS.some((k) => lower.includes(k))) return "outerwear";
  if (PANTS_KEYWORDS.some((k) => lower.includes(k))) return "pants";
  return "tops";
}

export function priceCeilingForCategory(
  category: PriceCategory,
  ceilings: { tops?: number; pants?: number; outerwear?: number; default: number },
): number {
  switch (category) {
    case "outerwear":
      return ceilings.outerwear ?? ceilings.default;
    case "pants":
      return ceilings.pants ?? ceilings.default;
    case "tops":
      return ceilings.tops ?? ceilings.default;
    default:
      return ceilings.default;
  }
}
