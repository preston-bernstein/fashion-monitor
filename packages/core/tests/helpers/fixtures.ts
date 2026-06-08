export { minimalConfig } from "../../../api/tests/helpers/fixtures.js";
import type { Listing } from "../../src/core/types.js";

export function sampleListing(overrides: Partial<Listing> = {}) {
  return {
    id: "abc123",
    platform: "ebay" as const,
    title: "Helmut Lang Wool Crewneck XXL",
    description: "Black slub cotton, relaxed fit, excellent condition.",
    price: 85,
    currency: "USD",
    size: "XXL",
    brand: "Helmut Lang",
    url: "https://example.com/listing",
    imageUrl: "https://example.com/image.jpg",
    listedAt: new Date("2025-01-01"),
    condition: "excellent",
    raw: {},
    ...overrides,
  };
}
