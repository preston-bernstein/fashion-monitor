import { describe, expect, it, afterEach } from 'vitest';
import { openDatabase, migrate } from '@fm/core/storage/db.js';
import type { Db } from '@fm/core/storage/db.js';
import { AlertLogRepo } from '@fm/core/storage/repos/alert-log.js';
import type { Listing, ScoringResult } from '@fm/core/core/types.js';
import { createGetRecentAlerts } from '../../src/tools/get-recent-alerts.js';

function sampleListing(overrides: Partial<Listing> = {}): Listing {
  return {
    id: 'abc123',
    platform: 'ebay',
    title: 'Helmut Lang Wool Crewneck XXL',
    description: 'Black slub cotton, relaxed fit.',
    price: 85,
    currency: 'USD',
    size: 'XXL',
    brand: 'Helmut Lang',
    url: 'https://example.com/listing',
    imageUrl: 'https://i.ebayimg.com/image.jpg',
    listedAt: new Date('2025-01-01'),
    condition: 'excellent',
    raw: {},
    sourceQueryId: 'corduroy',
    ...overrides,
  };
}

function sampleResult(overrides: Partial<ScoringResult> = {}): ScoringResult {
  return {
    listing_id: 'ebay:abc123',
    score: 'YES',
    quality: 'pass',
    value: 'pass',
    aesthetic: 'pass',
    size: 'HIGH',
    reason: 'Good match',
    ...overrides,
  };
}

describe('get_recent_alerts MCP tool', () => {
  let db: Db;

  afterEach(() => {
    db?.close();
  });

  it('returns recent alerts for the configured profile, newest first, respecting limit', async () => {
    db = openDatabase(':memory:');
    migrate(db);
    const alerts = new AlertLogRepo(db, 'default');

    alerts.insert(sampleListing({ id: '1' }), sampleResult(), '2026-01-01T00:00:00.000Z');
    alerts.insert(sampleListing({ id: '2' }), sampleResult(), '2026-01-03T00:00:00.000Z');
    alerts.insert(sampleListing({ id: '3' }), sampleResult(), '2026-01-02T00:00:00.000Z');

    const getRecentAlerts = createGetRecentAlerts(db, 'default');
    const result = await getRecentAlerts({ limit: 2 });
    const rows = JSON.parse(result.content[0].text) as Array<{ listing_id: string; alerted_at: string }>;

    expect(rows).toHaveLength(2);
    expect(rows[0].listing_id).toBe('2');
    expect(rows[1].listing_id).toBe('3');
  });

  it('filters by since when provided', async () => {
    db = openDatabase(':memory:');
    migrate(db);
    const alerts = new AlertLogRepo(db, 'default');
    alerts.insert(sampleListing({ id: '1' }), sampleResult(), '2026-01-01T00:00:00.000Z');
    alerts.insert(sampleListing({ id: '2' }), sampleResult(), '2026-01-03T00:00:00.000Z');

    const getRecentAlerts = createGetRecentAlerts(db, 'default');
    const result = await getRecentAlerts({ limit: 20, since: '2026-01-02T00:00:00.000Z' });
    const rows = JSON.parse(result.content[0].text) as Array<{ listing_id: string }>;

    expect(rows).toHaveLength(1);
    expect(rows[0].listing_id).toBe('2');
  });

  it('only returns alerts for the profile it was constructed with', async () => {
    db = openDatabase(':memory:');
    migrate(db);
    new AlertLogRepo(db, 'p1').insert(sampleListing({ id: '1' }), sampleResult(), '2026-01-01T00:00:00.000Z');
    new AlertLogRepo(db, 'p2').insert(sampleListing({ id: '2' }), sampleResult(), '2026-01-01T00:00:00.000Z');

    const getRecentAlerts = createGetRecentAlerts(db, 'p1');
    const rows = JSON.parse((await getRecentAlerts({ limit: 20 })).content[0].text) as Array<{
      listing_id: string;
    }>;

    expect(rows).toHaveLength(1);
    expect(rows[0].listing_id).toBe('1');
  });

  it('returns an empty array when there are no alerts yet', async () => {
    db = openDatabase(':memory:');
    migrate(db);
    const getRecentAlerts = createGetRecentAlerts(db, 'default');
    const rows = JSON.parse((await getRecentAlerts({ limit: 20 })).content[0].text);
    expect(rows).toEqual([]);
  });
});
