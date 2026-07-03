import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Config } from '@fm/core/core/config.js';
import type { Listing } from '@fm/core/core/types.js';
import type { PlatformScraper } from '@fm/core/platforms/types.js';

const createScrapers = vi.fn();

vi.mock('@fm/core/platforms/registry.js', () => ({ createScrapers }));

const { createSearchListings } = await import('../../src/tools/search-listings.js');

function sampleListing(overrides: Partial<Listing> = {}): Listing {
  return {
    id: 'abc123',
    platform: 'ebay',
    title: 'Helmut Lang Wool Crewneck XXL',
    description: 'A long description that goes on and on '.repeat(20),
    price: 85,
    currency: 'USD',
    size: 'XXL',
    brand: 'Helmut Lang',
    url: 'https://example.com/listing',
    imageUrl: 'https://i.ebayimg.com/image.jpg',
    listedAt: new Date('2025-01-01'),
    condition: 'excellent',
    raw: {},
    ...overrides,
  };
}

function stubScraper(platform: PlatformScraper['platform'], listings: Listing[]): PlatformScraper {
  return {
    platform,
    async search() {
      return {
        ok: true,
        listings,
        queryResults: [
          { queryId: 'mcp', groupId: 'mcp', queryText: 'test', platform, ok: true, listings },
        ],
      };
    },
  };
}

function minimalConfig(): Config {
  return {} as Config;
}

describe('search_listings MCP tool', () => {
  beforeEach(() => {
    createScrapers.mockReset();
  });

  it('flattens and returns listings from every scraper', async () => {
    createScrapers.mockReturnValue([
      stubScraper('ebay', [sampleListing({ id: '1', platform: 'ebay' })]),
      stubScraper('grailed', [sampleListing({ id: '2', platform: 'grailed' })]),
    ]);

    const searchListings = createSearchListings(minimalConfig());
    const result = await searchListings({ query: 'corduroy jacket', limit: 20 });
    const out = JSON.parse(result.content[0].text) as Array<{ id: string; platform: string }>;

    expect(out).toHaveLength(2);
    expect(out.map((l) => l.platform).sort()).toEqual(['ebay', 'grailed']);
  });

  it('ignores a scraper that rejects or returns ok:false, without failing the whole call', async () => {
    createScrapers.mockReturnValue([
      stubScraper('ebay', [sampleListing({ id: '1' })]),
      {
        platform: 'grailed',
        async search() {
          throw new Error('network down');
        },
      },
      {
        platform: 'depop',
        async search() {
          return { ok: false, error: 'blocked', listings: [], queryResults: [] };
        },
      },
    ]);

    const searchListings = createSearchListings(minimalConfig());
    const result = await searchListings({ query: 'corduroy jacket', limit: 20 });
    const out = JSON.parse(result.content[0].text) as Array<{ id: string }>;

    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('1');
  });

  it('filters out listings above price_max', async () => {
    createScrapers.mockReturnValue([
      stubScraper('ebay', [
        sampleListing({ id: '1', price: 50 }),
        sampleListing({ id: '2', price: 500 }),
      ]),
    ]);

    const searchListings = createSearchListings(minimalConfig());
    const result = await searchListings({ query: 'jacket', price_max: 100, limit: 20 });
    const out = JSON.parse(result.content[0].text) as Array<{ id: string }>;

    expect(out.map((l) => l.id)).toEqual(['1']);
  });

  it('deduplicates cross-platform by platform:id', async () => {
    createScrapers.mockReturnValue([
      stubScraper('ebay', [sampleListing({ id: '1', platform: 'ebay' })]),
      stubScraper('ebay', [sampleListing({ id: '1', platform: 'ebay' })]),
    ]);

    const searchListings = createSearchListings(minimalConfig());
    const result = await searchListings({ query: 'jacket', limit: 20 });
    const out = JSON.parse(result.content[0].text) as Array<{ id: string }>;

    expect(out).toHaveLength(1);
  });

  it('respects the limit and truncates the description to 300 characters', async () => {
    createScrapers.mockReturnValue([
      stubScraper('ebay', [
        sampleListing({ id: '1' }),
        sampleListing({ id: '2' }),
        sampleListing({ id: '3' }),
      ]),
    ]);

    const searchListings = createSearchListings(minimalConfig());
    const result = await searchListings({ query: 'jacket', limit: 2 });
    const out = JSON.parse(result.content[0].text) as Array<{ description: string }>;

    expect(out).toHaveLength(2);
    expect(out[0].description.length).toBeLessThanOrEqual(300);
  });

  it('passes the requested platform filter through to createScrapers', async () => {
    createScrapers.mockReturnValue([]);
    const searchListings = createSearchListings(minimalConfig());
    await searchListings({ query: 'jacket', platforms: ['ebay', 'grailed'], limit: 20 });

    expect(createScrapers).toHaveBeenCalledWith(expect.anything(), ['ebay', 'grailed']);
  });
});
