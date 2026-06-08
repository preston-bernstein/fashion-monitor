import type { Listing } from "../../src/core/types.js";
import type { PlatformScraper } from "../../src/platforms/types.js";
import { sampleListing } from "./fixtures.js";

export function mockScraper(
  platform: PlatformScraper["platform"],
  listings: Listing[] = [sampleListing({ platform })],
  queryId?: string,
  sourceQueryId?: string,
): PlatformScraper {
  const qid = queryId ?? `${platform}-test`;
  const tagId = sourceQueryId ?? qid;
  const tagged = listings.map((l) => ({ ...l, platform, sourceQueryId: tagId }));
  return {
    platform,
    async search() {
      return {
        ok: true,
        listings: tagged,
        queryResults: [
          {
            queryId: qid,
            groupId: tagId,
            queryText: "test query",
            platform,
            ok: true,
            listings: tagged,
          },
        ],
      };
    },
  };
}
