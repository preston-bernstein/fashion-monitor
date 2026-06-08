import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi, afterEach } from "vitest";
import { fetchVestiaireHtml } from "../../src/platforms/vestiaire/fetch-page.js";

describe("vestiaire fetch", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses scrapfly when direct fetch returns 403", async () => {
    const html = readFileSync(
      join(process.cwd(), "tests/fixtures/vestiaire/search-page.html"),
      "utf8",
    );

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        text: async () => "",
      }),
    );

    const scrapfly = vi.fn().mockResolvedValue(html);

    const result = await fetchVestiaireHtml("https://www.vestiairecollective.com/search/?q=test", {
      scrapfly,
    });
    expect(result).toContain("__NEXT_DATA__");
    expect(scrapfly).toHaveBeenCalled();
  });
});
