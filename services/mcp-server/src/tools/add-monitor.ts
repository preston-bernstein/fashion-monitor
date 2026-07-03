import { z } from 'zod';
import { MonitorCapExceededError, SearchGroupsRepo } from '@fm/core/storage/repos/search-groups.js';
import type { Db } from '@fm/core/storage/db.js';
import { IMPLEMENTED_PLATFORMS } from '@fm/shared/platforms.js';
import type { Platform } from '@fm/shared/platforms.js';

const schema = z.object({
  query: z.string().min(1),
  platforms: z.array(z.enum(IMPLEMENTED_PLATFORMS)).optional(),
  note: z.string().optional(),
});

/**
 * Factory so the handler can be exercised in tests against an isolated
 * in-memory db, without going through `../context.js`'s module-scope
 * db/config wiring (which reads from disk via env vars at import time).
 * `index.ts` binds this to the real `db`/`config.profile_id` at startup.
 */
export function createAddMonitor(database: Db, profileId: string) {
  return async function addMonitor(args: z.infer<typeof schema>) {
    const platforms = (args.platforms ?? ['ebay', 'grailed', 'depop', 'poshmark']) as Platform[];

    const repo = new SearchGroupsRepo(database, profileId);

    // Shared enforcement point (also used by the web API's POST /api/monitors)
    // so the cap can't drift between the two write paths.
    try {
      repo.assertMonitorCapNotExceeded();
    } catch (err) {
      if (err instanceof MonitorCapExceededError) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ ok: false, error: 'monitor_limit_reached', message: err.message }),
            },
          ],
        };
      }
      throw err;
    }

    // slug from query + short timestamp suffix for uniqueness
    const slug = args.query
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
      .slice(0, 40);
    const id = `${slug}-${Date.now().toString(36)}`;

    repo.createGroup(
      {
        id,
        query_text: args.query,
        platforms,
        query_overrides: {},
        enabled: true,
        status: 'active',
        note: args.note ?? null,
      },
      new Date().toISOString(),
    );

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({
            ok: true,
            id,
            query: args.query,
            platforms,
            message: `Monitor "${id}" created. Will run on next pipeline cycle.`,
          }),
        },
      ],
    };
  };
}
