import { z } from 'zod';
import { createScrapers } from '@fm/core/platforms/registry.js';
import { IMPLEMENTED_PLATFORMS } from '@fm/shared/platforms.js';
import type { Platform } from '@fm/shared/platforms.js';
import { config } from '../context.js';

const schema = z.object({
  query: z.string().min(1),
  platforms: z.array(z.enum(IMPLEMENTED_PLATFORMS)).optional(),
  price_max: z.number().positive().optional(),
  limit: z.number().min(1).max(40).default(20),
});

export async function searchListings(args: z.infer<typeof schema>) {
  const targetPlatforms = (args.platforms ?? [...IMPLEMENTED_PLATFORMS]) as Platform[];
  const scrapers = createScrapers(config, targetPlatforms);

  const results = await Promise.allSettled(
    scrapers.map(s =>
      s.search([{ queryId: 'mcp', sourceQueryId: 'mcp', text: args.query }])
    )
  );

  let listings = results
    .flatMap(r => {
      if (r.status === 'rejected') return [];
      if (!r.value.ok) return [];
      return r.value.listings;
    });

  if (args.price_max != null) {
    listings = listings.filter(l => l.price <= args.price_max!);
  }

  // deduplicate cross-platform by platform:id
  const seen = new Set<string>();
  listings = listings.filter(l => {
    const key = `${l.platform}:${l.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  listings = listings.slice(0, args.limit);

  const out = listings.map(l => ({
    id: l.id,
    platform: l.platform,
    title: l.title,
    brand: l.brand,
    price: l.price,
    currency: l.currency,
    size: l.size,
    condition: l.condition,
    url: l.url,
    imageUrl: l.imageUrl,
    description: l.description.slice(0, 300),
  }));

  return { content: [{ type: 'text' as const, text: JSON.stringify(out) }] };
}
