import { z } from 'zod';
import type { Db } from '@fm/core/storage/db.js';

const schema = z.object({
  limit: z.number().min(1).max(100).default(20),
  since: z.string().optional(),
});

/**
 * Factory so the handler can be exercised in tests against an isolated
 * in-memory db, without going through `../context.js`'s module-scope
 * db/config wiring (which reads from disk via env vars at import time).
 * `index.ts` binds this to the real `db`/`config.profile_id` at startup.
 */
export function createGetRecentAlerts(db: Db, profileId: string) {
  return async function getRecentAlerts(args: z.infer<typeof schema>) {
    const rows = args.since
      ? db
          .prepare(
            `SELECT platform, listing_id, title, brand, price, url, score,
                    llm_reason, source_query_id, alerted_at
             FROM alert_log
             WHERE profile_id = ? AND alerted_at >= ?
             ORDER BY alerted_at DESC
             LIMIT ?`
          )
          .all(profileId, args.since, args.limit)
      : db
          .prepare(
            `SELECT platform, listing_id, title, brand, price, url, score,
                    llm_reason, source_query_id, alerted_at
             FROM alert_log
             WHERE profile_id = ?
             ORDER BY alerted_at DESC
             LIMIT ?`
          )
          .all(profileId, args.limit);

    return { content: [{ type: 'text' as const, text: JSON.stringify(rows) }] };
  };
}
