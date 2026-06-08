import { describe, expect, it, vi, afterEach } from "vitest";
import { resetStealthStateForTests } from "../../src/platforms/playwright/browser.js";

vi.mock("playwright-extra", () => ({
  chromium: {
    use: vi.fn(),
    launch: vi.fn().mockResolvedValue({ newContext: vi.fn(), close: vi.fn() }),
    launchPersistentContext: vi.fn().mockResolvedValue({ close: vi.fn() }),
  },
}));

vi.mock("puppeteer-extra-plugin-stealth", () => ({
  default: vi.fn(() => "stealth-plugin"),
}));

describe("shared playwright browser", () => {
  afterEach(() => {
    resetStealthStateForTests();
    vi.resetModules();
  });

  it("enables stealth plugin on persistent context launch", async () => {
    const { chromium } = await import("playwright-extra");
    const { launchStealthPersistentContext } =
      await import("../../src/platforms/playwright/browser.js");

    await launchStealthPersistentContext("/tmp/poshmark-profile");
    expect(chromium.use).toHaveBeenCalled();
    expect(chromium.launchPersistentContext).toHaveBeenCalled();
  });

  it("enables stealth plugin on ephemeral browser launch", async () => {
    const { chromium } = await import("playwright-extra");
    const { launchStealthEphemeralBrowser } =
      await import("../../src/platforms/playwright/browser.js");

    await launchStealthEphemeralBrowser();
    expect(chromium.use).toHaveBeenCalled();
    expect(chromium.launch).toHaveBeenCalled();
  });
});
