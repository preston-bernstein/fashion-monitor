import { z } from 'zod';
import { SearchGroupsRepo } from '@fm/core/storage/repos/search-groups.js';
import { IMPLEMENTED_PLATFORMS } from '@fm/shared/platforms.js';
import type { Platform } from '@fm/shared/platforms.js';
import { db, config } from '../context.js';

const schema = z.object({
  query: z.string().min(1),
  platforms: z.array(z.enum(IMPLEMENTED_PLATFORMS)).optional(),
  note: z.string().optional(),
});

export async function addMonitor(args: z.infer<typeof schema>) {
  const platforms = (args.platforms ?? ['ebay', 'grailed', 'depop', 'poshmark']) as Platform[];

  // slug from query + short timestamp suffix for uniqueness
  const slug = args.query
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 40);
  const id = `${slug}-${Date.now().toString(36)}`;

  const repo = new SearchGroupsRepo(db, config.profile_id);
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
}
