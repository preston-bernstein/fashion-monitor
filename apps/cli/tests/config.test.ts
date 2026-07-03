import { describe, expect, it, vi, afterEach } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadCliConfig } from "../src/config.js";

const minimalYaml = `
profile_id: default
aesthetic_prompt: "Dark academic aesthetic."
hard_no: []
positive_signals:
  strong: []
  weak: []
price_ceiling:
  default: 300
measurements: {}
platforms:
  ebay: true
llm:
  provider: mock
alert:
  ntfy_url: "http://ntfy-test"
  ntfy_topic: "test"
database:
  path: ":memory:"
scraper:
  poshmark_profile_path: "data/poshmark-profile"
`;

describe("loadCliConfig", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("loads and parses a valid config file", () => {
    const dir = mkdtempSync(join(tmpdir(), "fm-cli-config-"));
    const path = join(dir, "config.yaml");
    writeFileSync(path, minimalYaml, "utf8");

    const config = loadCliConfig(path);
    expect(config.profile_id).toBe("default");
    expect(config.aesthetic_prompt).toBe("Dark academic aesthetic.");
  });

  it("calls process.exit(1) when the file doesn't exist", () => {
    // process.exit is mocked to a no-op (real termination can't be tested in
    // vitest), so control falls through past it — loadConfigFromFile then
    // throws on the still-missing file. That's fine: what this test asserts
    // is that the missing-file path called exit(1) before anything else.
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

    expect(() => loadCliConfig("/definitely/not/a/real/path/config.yaml")).toThrow();
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
