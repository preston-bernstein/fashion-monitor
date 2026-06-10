import { z } from 'zod';
import { db, config } from '../context.js';

const schema = z.object({
  limit: z.number().min(1).max(100).default(20),
  since: z.string().optional(),
});

export async function getRecentAlerts(args: z.infer<typeof schema>) {
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
        .all(config.profile_id, args.since, args.limit)
    : db
        .prepare(
          `SELECT platform, listing_id, title, brand, price, url, score,
                  llm_reason, source_query_id, alerted_at
           FROM alert_log
           WHERE profile_id = ?
           ORDER BY alerted_at DESC
           LIMIT ?`
        )
        .all(config.profile_id, args.limit);

  return { content: [{ type: 'text' as const, text: JSON.stringify(rows) }] };
}
