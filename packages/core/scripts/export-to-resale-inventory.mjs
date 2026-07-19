#!/usr/bin/env node
// Manual acquisition bridge: fashion-monitor -> resale-inventory.
// Exports specific scored listings (things you actually bought) as a CSV
// matching resale-inventory's existing /api/import clothing schema.
// This repo and resale-inventory stay separate codebases (see the vault doc
// Development/Research/fashion-monitor-resale-inventory-merge.md) — this
// script is the whole bridge, deliberately just an offline file handoff.
//
// Usage (from repo root):
//   pnpm run export:resale-inventory -- --db path/to/fashion_monitor.db <platform:id> [...] > acquisitions.csv
// --db is required on purpose: this app's own configured DB path resolves
// relative to process cwd (see apps/cli/src/run.ts), which varies by how the
// CLI happens to be invoked — never guess it here.
//
// Then upload the CSV via resale-inventory's existing import UI/endpoint.
// Every row imports with status=Unlisted regardless of any status column
// (resale-inventory's own import route enforces this) — acquisition_cost_usd
// and acquisition_date are pre-filled from the listing but reflect the
// LISTED price and export date, not necessarily what you actually paid or
// when you actually received it. Review both before uploading.

import Database from 'better-sqlite3';

const CONDITION_MAP = {
  'new with tags': 'NWT',
  nwt: 'NWT',
  'new without tags': 'NWOT',
  nwot: 'NWOT',
  'like new': 'EUC',
  excellent: 'EUC',
  euc: 'EUC',
  good: 'GUC',
  guc: 'GUC',
  used: 'GUC',
  fair: 'Fair',
  worn: 'Fair',
};

function mapCondition(raw) {
  if (!raw) return '';
  const hit = CONDITION_MAP[raw.trim().toLowerCase()];
  return hit ?? ''; // unmapped -> blank, forces a manual pick on import
}

function csvCell(value) {
  const s = value === null || value === undefined ? '' : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function parseArgs(argv) {
  const keys = [];
  let dbPath = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--db') {
      dbPath = argv[++i];
    } else {
      keys.push(argv[i]);
    }
  }
  return { keys, dbPath };
}

function main() {
  const { keys, dbPath } = parseArgs(process.argv.slice(2));
  if (keys.length === 0 || !dbPath) {
    // No default path guessed on purpose: this repo's config-driven DB path
    // resolves relative to wherever the CLI process's cwd happens to be
    // (see apps/cli/src/run.ts / config.database.path), which is exactly the
    // cwd-dependent-path footgun resale-inventory's own architecture-contract
    // skill documents as W7 for its sibling app. Always pass --db explicitly.
    console.error('Usage: export-to-resale-inventory.mjs --db <path-to-fashion_monitor.db> <platform:id> [...]');
    process.exit(1);
  }

  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  const stmt = db.prepare(
    'SELECT platform, id, score, last_price, listing_snapshot FROM seen_listings WHERE platform = ? AND id = ?'
  );

  const header = [
    'category',
    'title',
    'brand',
    'size_label',
    'condition',
    'acquisition_cost_usd',
    'acquisition_date',
    'gender_department',
    'weight_oz',
    'pit_to_pit_in',
    'length_in',
    'sleeve_length_in',
    'waist_in',
    'rise_in',
    'inseam_in',
    'leg_opening_in',
    'hip_in',
  ];
  const rows = [header];
  const today = new Date().toISOString().slice(0, 10);
  const missing = [];

  for (const key of keys) {
    const [platform, id] = key.split(':');
    if (!platform || !id) {
      console.error(`Skipping malformed key (want platform:id): ${key}`);
      continue;
    }
    const row = stmt.get(platform, id);
    if (!row) {
      missing.push(key);
      continue;
    }
    const listing = row.listing_snapshot ? JSON.parse(row.listing_snapshot) : {};
    rows.push([
      'clothing',
      listing.title ?? '',
      listing.brand ?? '',
      listing.size ?? '',
      mapCondition(listing.condition),
      (row.last_price ?? listing.price ?? '').toString(),
      today,
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
    ]);
  }

  const csv = rows.map((r) => r.map(csvCell).join(',')).join('\n') + '\n';
  process.stdout.write(csv);

  if (missing.length > 0) {
    console.error(`Not found in seen_listings, skipped: ${missing.join(', ')}`);
  }
  console.error(
    `Wrote ${rows.length - 1} row(s). Review acquisition_cost_usd/acquisition_date and any blank condition before importing.`
  );
}

main();
