import { describe, expect, it, vi, afterEach } from "vitest";
import {
  resetStealthStateForTests,
  resolveStealthDriver,
} from "../../src/platforms/playwright/browser.js";

vi.mock("playwright-extra", () => ({
  chromium: {
    use: vi.fn(),
    launch: vi
      .fn()
      .mockImplementation(() => Promise.resolve({ newContext: vi.fn(), close: vi.fn() })),
    launchPersistentContext: vi.fn().mockImplementation(() => Promise.resolve({ close: vi.fn() })),
  },
}));

vi.mock("puppeteer-extra-plugin-stealth", () => ({
  default: vi.fn(() => "stealth-plugin"),
}));

vi.mock("patchright", () => ({
  chromium: {
    launch: vi.fn().mockImplementation(() => Promise.resolve({ newPage: vi.fn(), close: vi.fn() })),
    launchPersistentContext: vi
      .fn()
      .mockImplementation(() => Promise.resolve({ newPage: vi.fn(), close: vi.fn() })),
  },
}));

describe("shared playwright browser", () => {
  afterEach(() => {
    resetStealthStateForTests();
    vi.resetModules();
    vi.clearAllMocks();
    delete process.env.PLAYWRIGHT_STEALTH_DRIVER;
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

  it("only enables the stealth plugin once across a persistent-context launch and a separate ephemeral launch", async () => {
    const { chromium } = await import("playwright-extra");
    const { launchStealthPersistentContext, launchStealthEphemeralBrowser } =
      await import("../../src/platforms/playwright/browser.js");

    await launchStealthPersistentContext("/tmp/single-enable-profile", "legacy");
    await launchStealthEphemeralBrowser("legacy");

    expect(chromium.use).toHaveBeenCalledTimes(1);
  });

  it("reuses the cached persistent context on a second call with the same driver+path (no re-launch)", async () => {
    const { chromium } = await import("playwright-extra");
    const { launchStealthPersistentContext } =
      await import("../../src/platforms/playwright/browser.js");

    const first = await launchStealthPersistentContext("/tmp/cache-hit-profile", "legacy");
    const second = await launchStealthPersistentContext("/tmp/cache-hit-profile", "legacy");

    expect(second).toBe(first);
    expect(chromium.launchPersistentContext).toHaveBeenCalledTimes(1);
  });

  describe("resolveStealthDriver", () => {
    it("returns the explicit override regardless of env var", () => {
      process.env.PLAYWRIGHT_STEALTH_DRIVER = "legacy";
      expect(resolveStealthDriver("patchright")).toBe("patchright");
    });

    it("returns legacy when the env var is unset", () => {
      delete process.env.PLAYWRIGHT_STEALTH_DRIVER;
      expect(resolveStealthDriver()).toBe("legacy");
    });

    it("returns legacy when the env var is exactly legacy, without warning", () => {
      process.env.PLAYWRIGHT_STEALTH_DRIVER = "legacy";
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      expect(resolveStealthDriver()).toBe("legacy");
      expect(warnSpy).not.toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it("returns patchright when the env var is exactly patchright", () => {
      process.env.PLAYWRIGHT_STEALTH_DRIVER = "patchright";
      expect(resolveStealthDriver()).toBe("patchright");
    });

    it("warns with the bad value and falls back to legacy for an unrecognized env value", () => {
      process.env.PLAYWRIGHT_STEALTH_DRIVER = "rebrowser";
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      expect(resolveStealthDriver()).toBe("legacy");
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("rebrowser"));
      warnSpy.mockRestore();
    });
  });

  describe("patchright driver", () => {
    it("uses patchright's chromium.launchPersistentContext when PLAYWRIGHT_STEALTH_DRIVER=patchright", async () => {
      process.env.PLAYWRIGHT_STEALTH_DRIVER = "patchright";
      const { chromium: patchrightChromium } = await import("patchright");
      const { chromium: extraChromium } = await import("playwright-extra");
      const { launchStealthPersistentContext } =
        await import("../../src/platforms/playwright/browser.js");

      await launchStealthPersistentContext("/tmp/patchright-profile");

      expect(patchrightChromium.launchPersistentContext).toHaveBeenCalled();
      expect(extraChromium.launchPersistentContext).not.toHaveBeenCalled();
    });

    it("uses patchright's chromium.launch via an explicit driver override", async () => {
      const { chromium: patchrightChromium } = await import("patchright");
      const { chromium: extraChromium } = await import("playwright-extra");
      const { launchStealthEphemeralBrowser } =
        await import("../../src/platforms/playwright/browser.js");

      await launchStealthEphemeralBrowser("patchright");

      expect(patchrightChromium.launch).toHaveBeenCalled();
      expect(extraChromium.launch).not.toHaveBeenCalled();
    });

    it("warns and falls back to the legacy driver for an unrecognized PLAYWRIGHT_STEALTH_DRIVER value", async () => {
      process.env.PLAYWRIGHT_STEALTH_DRIVER = "rebrowser";
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const { chromium: patchrightChromium } = await import("patchright");
      const { chromium: extraChromium } = await import("playwright-extra");
      const { launchStealthEphemeralBrowser } =
        await import("../../src/platforms/playwright/browser.js");

      await launchStealthEphemeralBrowser();

      expect(warnSpy).toHaveBeenCalled();
      expect(extraChromium.launch).toHaveBeenCalled();
      expect(patchrightChromium.launch).not.toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it("resetStealthStateForTests clears ephemeral browser state between a patchright case and a legacy case", async () => {
      const { chromium: patchrightChromium } = await import("patchright");
      const { chromium: extraChromium } = await import("playwright-extra");
      const browserModule = await import("../../src/platforms/playwright/browser.js");

      await browserModule.launchStealthEphemeralBrowser("patchright");
      expect(patchrightChromium.launch).toHaveBeenCalledTimes(1);

      browserModule.resetStealthStateForTests();

      await browserModule.launchStealthEphemeralBrowser("legacy");
      expect(extraChromium.launch).toHaveBeenCalledTimes(1);
      expect(patchrightChromium.launch).toHaveBeenCalledTimes(1);
    });

    it("keys the persistent-context cache by driver+path so switching drivers doesn't reuse a cached context", async () => {
      const { chromium: patchrightChromium } = await import("patchright");
      const { launchStealthPersistentContext } =
        await import("../../src/platforms/playwright/browser.js");

      const legacyContext = await launchStealthPersistentContext("/tmp/shared-profile", "legacy");
      const patchrightContext = await launchStealthPersistentContext(
        "/tmp/shared-profile",
        "patchright",
      );

      expect(patchrightChromium.launchPersistentContext).toHaveBeenCalledTimes(1);
      expect(patchrightContext).not.toBe(legacyContext);
    });

    it("passes the exact LAUNCH_ARGS to both drivers' launch calls", async () => {
      const { chromium: patchrightChromium } = await import("patchright");
      const { chromium: extraChromium } = await import("playwright-extra");
      const { launchStealthEphemeralBrowser } =
        await import("../../src/platforms/playwright/browser.js");

      await launchStealthEphemeralBrowser("legacy");
      expect(extraChromium.launch).toHaveBeenCalledWith(
        expect.objectContaining({
          args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
        }),
      );

      await launchStealthEphemeralBrowser("patchright");
      expect(patchrightChromium.launch).toHaveBeenCalledWith(
        expect.objectContaining({
          args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
        }),
      );
    });

    it("getEphemeralBrowserDriver reflects the launched driver and clears on close", async () => {
      const {
        launchStealthEphemeralBrowser,
        closeStealthEphemeralBrowser,
        getEphemeralBrowserDriver,
      } = await import("../../src/platforms/playwright/browser.js");

      expect(getEphemeralBrowserDriver()).toBeNull();

      await launchStealthEphemeralBrowser("legacy");
      expect(getEphemeralBrowserDriver()).toBe("legacy");

      await closeStealthEphemeralBrowser();
      expect(getEphemeralBrowserDriver()).toBeNull();
    });

    it("throws instead of casting when patchright's launch() returns a shape missing both newPage and close", async () => {
      const { chromium: patchrightChromium } = await import("patchright");
      vi.mocked(patchrightChromium.launch).mockResolvedValueOnce({} as never);
      const { launchStealthEphemeralBrowser } =
        await import("../../src/platforms/playwright/browser.js");

      await expect(launchStealthEphemeralBrowser("patchright")).rejects.toThrow(
        /Browser shape no longer matches/,
      );
    });

    it("throws when patchright's launch() returns a shape missing only close", async () => {
      const { chromium: patchrightChromium } = await import("patchright");
      vi.mocked(patchrightChromium.launch).mockResolvedValueOnce({ newPage: vi.fn() } as never);
      const { launchStealthEphemeralBrowser } =
        await import("../../src/platforms/playwright/browser.js");

      await expect(launchStealthEphemeralBrowser("patchright")).rejects.toThrow(
        /Browser shape no longer matches/,
      );
    });

    it("throws when patchright's launch() returns a shape missing only newPage", async () => {
      const { chromium: patchrightChromium } = await import("patchright");
      vi.mocked(patchrightChromium.launch).mockResolvedValueOnce({ close: vi.fn() } as never);
      const { launchStealthEphemeralBrowser } =
        await import("../../src/platforms/playwright/browser.js");

      await expect(launchStealthEphemeralBrowser("patchright")).rejects.toThrow(
        /Browser shape no longer matches/,
      );
    });

    it("throws instead of casting when patchright's launchPersistentContext() returns a shape missing both newPage and close", async () => {
      const { chromium: patchrightChromium } = await import("patchright");
      vi.mocked(patchrightChromium.launchPersistentContext).mockResolvedValueOnce({} as never);
      const { launchStealthPersistentContext } =
        await import("../../src/platforms/playwright/browser.js");

      await expect(
        launchStealthPersistentContext("/tmp/broken-shape-profile", "patchright"),
      ).rejects.toThrow(/BrowserContext shape no longer matches/);
    });

    it("throws when patchright's launchPersistentContext() returns a shape missing only close", async () => {
      const { chromium: patchrightChromium } = await import("patchright");
      vi.mocked(patchrightChromium.launchPersistentContext).mockResolvedValueOnce({
        newPage: vi.fn(),
      } as never);
      const { launchStealthPersistentContext } =
        await import("../../src/platforms/playwright/browser.js");

      await expect(
        launchStealthPersistentContext("/tmp/broken-shape-profile-2", "patchright"),
      ).rejects.toThrow(/BrowserContext shape no longer matches/);
    });

    it("throws when patchright's launchPersistentContext() returns a shape missing only newPage", async () => {
      const { chromium: patchrightChromium } = await import("patchright");
      vi.mocked(patchrightChromium.launchPersistentContext).mockResolvedValueOnce({
        close: vi.fn(),
      } as never);
      const { launchStealthPersistentContext } =
        await import("../../src/platforms/playwright/browser.js");

      await expect(
        launchStealthPersistentContext("/tmp/broken-shape-profile-3", "patchright"),
      ).rejects.toThrow(/BrowserContext shape no longer matches/);
    });

    it("getEphemeralBrowserDriver returns patchright right after a patchright launch", async () => {
      const { launchStealthEphemeralBrowser, getEphemeralBrowserDriver } =
        await import("../../src/platforms/playwright/browser.js");

      await launchStealthEphemeralBrowser("patchright");
      expect(getEphemeralBrowserDriver()).toBe("patchright");
    });

    it("re-enables the stealth plugin after resetStealthStateForTests", async () => {
      const { chromium: extraChromium } = await import("playwright-extra");
      const browserModule = await import("../../src/platforms/playwright/browser.js");

      await browserModule.launchStealthEphemeralBrowser("legacy");
      expect(extraChromium.use).toHaveBeenCalledTimes(1);

      browserModule.resetStealthStateForTests();

      await browserModule.launchStealthEphemeralBrowser("legacy");
      expect(extraChromium.use).toHaveBeenCalledTimes(2);
    });

    it("closeStealthPersistentContext closes and removes every driver's context for a profile path", async () => {
      const { chromium: extraChromium } = await import("playwright-extra");
      const { launchStealthPersistentContext, closeStealthPersistentContext } =
        await import("../../src/platforms/playwright/browser.js");

      const context = await launchStealthPersistentContext("/tmp/close-me-profile", "legacy");
      await closeStealthPersistentContext("/tmp/close-me-profile");

      expect(context.close).toHaveBeenCalled();
      // A second launch for the same path must open a fresh context, not reuse a closed one.
      vi.mocked(extraChromium.launchPersistentContext).mockClear();
      await launchStealthPersistentContext("/tmp/close-me-profile", "legacy");
      expect(extraChromium.launchPersistentContext).toHaveBeenCalled();
    });

    it("reuses the cached ephemeral browser on a second call with the same driver (no re-launch, no re-enabling stealth)", async () => {
      const { chromium: extraChromium } = await import("playwright-extra");
      const { launchStealthEphemeralBrowser } =
        await import("../../src/platforms/playwright/browser.js");

      const first = await launchStealthEphemeralBrowser("legacy");
      const second = await launchStealthEphemeralBrowser("legacy");

      expect(second).toBe(first);
      expect(extraChromium.launch).toHaveBeenCalledTimes(1);
      expect(extraChromium.use).toHaveBeenCalledTimes(1);
    });

    it("passes headless:true to both ephemeral and persistent-context launches, for both drivers", async () => {
      const { chromium: patchrightChromium } = await import("patchright");
      const { chromium: extraChromium } = await import("playwright-extra");
      const { launchStealthEphemeralBrowser, launchStealthPersistentContext } =
        await import("../../src/platforms/playwright/browser.js");

      await launchStealthEphemeralBrowser("legacy");
      expect(extraChromium.launch).toHaveBeenCalledWith(
        expect.objectContaining({ headless: true }),
      );

      await launchStealthEphemeralBrowser("patchright");
      expect(patchrightChromium.launch).toHaveBeenCalledWith(
        expect.objectContaining({ headless: true }),
      );

      await launchStealthPersistentContext("/tmp/headless-check-legacy", "legacy");
      expect(extraChromium.launchPersistentContext).toHaveBeenCalledWith(
        "/tmp/headless-check-legacy",
        expect.objectContaining({ headless: true }),
      );

      await launchStealthPersistentContext("/tmp/headless-check-patchright", "patchright");
      expect(patchrightChromium.launchPersistentContext).toHaveBeenCalledWith(
        "/tmp/headless-check-patchright",
        expect.objectContaining({ headless: true }),
      );
    });

    it("closeStealthPersistentContext only closes the requested profile path, not other open contexts", async () => {
      const { launchStealthPersistentContext, closeStealthPersistentContext } =
        await import("../../src/platforms/playwright/browser.js");

      const contextA = await launchStealthPersistentContext("/tmp/profile-a", "legacy");
      const contextB = await launchStealthPersistentContext("/tmp/profile-b", "legacy");

      await closeStealthPersistentContext("/tmp/profile-a");

      expect(contextA.close).toHaveBeenCalled();
      expect(contextB.close).not.toHaveBeenCalled();
    });

    it("closeStealthEphemeralBrowser is a safe no-op when nothing was launched", async () => {
      const { closeStealthEphemeralBrowser, getEphemeralBrowserDriver } =
        await import("../../src/platforms/playwright/browser.js");

      await expect(closeStealthEphemeralBrowser()).resolves.toBeUndefined();
      expect(getEphemeralBrowserDriver()).toBeNull();
    });

    it("closeAllStealthBrowsers closes every open persistent context and the ephemeral browser", async () => {
      const {
        launchStealthPersistentContext,
        launchStealthEphemeralBrowser,
        closeAllStealthBrowsers,
      } = await import("../../src/platforms/playwright/browser.js");

      const context = await launchStealthPersistentContext("/tmp/close-all-profile", "legacy");
      const browser = await launchStealthEphemeralBrowser("legacy");

      await closeAllStealthBrowsers();

      expect(context.close).toHaveBeenCalled();
      expect(browser.close).toHaveBeenCalled();
    });
  });
});
