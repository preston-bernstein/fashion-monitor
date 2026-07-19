import Database from "better-sqlite3";
import type { Config } from "../core/config.js";
import type { FeedbackRow, Listing, Platform, ScoringResult } from "../core/types.js";
import { listingKey } from "../core/types.js";
import type { LLMProvider } from "../llm/provider.js";
import { scoreListings } from "../pipeline/scorer.js";
import type { Db } from "../storage/db.js";
import type { ConfigRevisionRow, ConfigSnapshot } from "../storage/repos/config-revisions.js";
import { ConfigRevisionsRepo } from "../storage/repos/config-revisions.js";
import { FeedbackRepo } from "../storage/repos/feedback.js";
import { deserializeListing } from "../storage/listing-snapshot.js";

/**
 * Applies a frozen Taste revision (aesthetic_prompt / hard_no / positive_signals)
 * on top of a base config, leaving measurements/llm/searches untouched — those
 * aren't part of what config_revisions snapshots.
 */
export function applyFrozenSnapshot(config: Config, snapshot: ConfigSnapshot): Config {
  return {
    ...config,
    aesthetic_prompt: snapshot.aesthetic_prompt,
    hard_no: snapshot.hard_no,
    positive_signals: snapshot.positive_signals,
  };
}

interface RawEvalRow {
  feedback_id: number;
  signal: "positive" | "negative";
  source_query_id: string | null;
  recorded_at: string;
  listing_snapshot: string;
}

function fetchEvalRows(db: Db, profileId: string, limit?: number): RawEvalRow[] {
  const sql = `
    SELECT f.id AS feedback_id, f.signal, f.source_query_id, f.recorded_at, s.listing_snapshot
    FROM feedback f
    JOIN seen_listings s
      ON s.profile_id = f.profile_id AND s.platform = f.platform AND s.id = f.listing_id
    WHERE f.profile_id = ? AND s.listing_snapshot IS NOT NULL
    ORDER BY f.recorded_at ASC
    ${limit ? "LIMIT ?" : ""}
  `;
  const stmt = db.prepare(sql);
  return (limit ? stmt.all(profileId, limit) : stmt.all(profileId)) as RawEvalRow[];
}

/**
 * A FeedbackRepo bound to an in-memory copy of the feedback table with the
 * eval set's own listing ids removed, so buildSystemPrompt's few-shot
 * injection can't leak an item's own label into the prompt used to score it.
 */
function buildHoldoutFeedbackRepo(
  db: Db,
  profileId: string,
  excludeListingIds: Set<string>,
): FeedbackRepo {
  const mem = new Database(":memory:");
  mem.exec(`
    CREATE TABLE feedback (
      id              INTEGER PRIMARY KEY,
      profile_id      TEXT NOT NULL,
      platform        TEXT NOT NULL,
      listing_id      TEXT NOT NULL,
      signal          TEXT NOT NULL,
      title           TEXT,
      brand           TEXT,
      description     TEXT,
      image_url       TEXT,
      price           REAL,
      condition       TEXT,
      fabric_signals  TEXT,
      recorded_at     TEXT NOT NULL,
      source_query_id TEXT
    );
  `);

  const rows = db
    .prepare(`SELECT * FROM feedback WHERE profile_id = ?`)
    .all(profileId) as FeedbackRow[];

  const insert = mem.prepare(
    `INSERT INTO feedback (
       id, profile_id, platform, listing_id, signal, title, brand, description,
       image_url, price, condition, fabric_signals, recorded_at, source_query_id
     ) VALUES (@id, @profile_id, @platform, @listing_id, @signal, @title, @brand, @description,
       @image_url, @price, @condition, @fabric_signals, @recorded_at, @source_query_id)`,
  );

  for (const row of rows) {
    if (excludeListingIds.has(listingKey(row.platform, row.listing_id))) continue;
    insert.run(row);
  }

  return new FeedbackRepo(mem, profileId);
}

function resolveRevision(
  revisionsRepo: ConfigRevisionsRepo,
  profileId: string,
  revisionId?: number,
): ConfigRevisionRow {
  const revisions = revisionsRepo.fetchRecent(revisionId ? 100_000 : 1);
  const revision = revisionId ? revisions.find((r) => r.id === revisionId) : revisions[0];
  if (!revision) {
    throw new Error(
      revisionId
        ? `No config_revisions row with id=${revisionId} for profile=${profileId}`
        : `No config_revisions rows found for profile=${profileId} — cannot freeze a Taste revision to replay against`,
    );
  }
  return revision;
}

export interface EvalOptions {
  db: Db;
  config: Config;
  profileId: string;
  provider: LLMProvider;
  /** Freeze this specific config_revisions.id; defaults to the most recent revision. */
  revisionId?: number;
  /** Cap the number of feedback-labeled items replayed, oldest first. */
  limit?: number;
}

export interface EvalItemResult {
  listingId: string;
  platform: Platform;
  title: string;
  sourceQueryId: string | null;
  signal: "positive" | "negative";
  recordedAt: string;
  verdict: ScoringResult["score"];
  reason: string;
  correct: boolean;
}

export interface ConfusionMatrix {
  truePositive: number;
  falsePositive: number;
  falseNegative: number;
  trueNegative: number;
  precision: number | null;
  recall: number | null;
  n: number;
}

export interface EvalReport {
  revisionId: number;
  revisionRecordedAt: string;
  provider: string;
  itemsEvaluated: number;
  itemsSkipped: number;
  confusion: ConfusionMatrix;
  items: EvalItemResult[];
}

/**
 * Replays labeled seen_listings against buildSystemPrompt + a chosen provider
 * under a frozen Taste revision, and compares verdicts to feedback signals.
 */
export async function runEvalHarness(options: EvalOptions): Promise<EvalReport> {
  const { db, config, profileId, provider, revisionId, limit } = options;

  const revisionsRepo = new ConfigRevisionsRepo(db, profileId);
  const revision = resolveRevision(revisionsRepo, profileId, revisionId);
  const snapshot = JSON.parse(revision.snapshot_json) as ConfigSnapshot;
  const frozenConfig = applyFrozenSnapshot(config, snapshot);

  const rawRows = fetchEvalRows(db, profileId, limit);

  const listingsByKey = new Map<string, Listing>();
  const rowsByKey = new Map<string, RawEvalRow[]>();
  let skipped = 0;

  for (const row of rawRows) {
    let listing: Listing;
    try {
      listing = deserializeListing(row.listing_snapshot);
    } catch {
      skipped++;
      continue;
    }
    const key = listingKey(listing.platform, listing.id);
    listingsByKey.set(key, listing);
    const bucket = rowsByKey.get(key) ?? [];
    bucket.push(row);
    rowsByKey.set(key, bucket);
  }

  const listings = [...listingsByKey.values()];
  const feedbackRepo = buildHoldoutFeedbackRepo(db, profileId, new Set(listingsByKey.keys()));

  const { scored } = await scoreListings(listings, frozenConfig, provider, feedbackRepo);
  const verdictByKey = new Map(
    scored.map((s) => [listingKey(s.listing.platform, s.listing.id), s.result]),
  );

  const items: EvalItemResult[] = [];
  let truePositive = 0;
  let falsePositive = 0;
  let falseNegative = 0;
  let trueNegative = 0;

  for (const [key, rows] of rowsByKey) {
    const result = verdictByKey.get(key);
    const listing = listingsByKey.get(key);
    if (!result || !listing) {
      skipped += rows.length;
      continue;
    }
    const predictedYes = result.score === "YES";

    for (const row of rows) {
      const actualPositive = row.signal === "positive";
      if (predictedYes && actualPositive) truePositive++;
      else if (predictedYes && !actualPositive) falsePositive++;
      else if (!predictedYes && actualPositive) falseNegative++;
      else trueNegative++;

      items.push({
        listingId: key,
        platform: listing.platform,
        title: listing.title,
        sourceQueryId: row.source_query_id,
        signal: row.signal,
        recordedAt: row.recorded_at,
        verdict: result.score,
        reason: result.reason,
        correct: predictedYes === actualPositive,
      });
    }
  }

  const n = truePositive + falsePositive + falseNegative + trueNegative;

  return {
    revisionId: revision.id,
    revisionRecordedAt: revision.recorded_at,
    provider: frozenConfig.llm.provider,
    itemsEvaluated: items.length,
    itemsSkipped: skipped,
    confusion: {
      truePositive,
      falsePositive,
      falseNegative,
      trueNegative,
      precision:
        truePositive + falsePositive > 0 ? truePositive / (truePositive + falsePositive) : null,
      recall:
        truePositive + falseNegative > 0 ? truePositive / (truePositive + falseNegative) : null,
      n,
    },
    items,
  };
}
