import { describe, expect, it, vi } from "vitest";
import { logError, serializeError, type Logger } from "../../src/lib/logging.js";

describe("serializeError", () => {
  it("serializes Error with type, message, and stack", () => {
    const err = new TypeError("bad input");
    const out = serializeError(err);
    expect(out.type).toBe("TypeError");
    expect(out.message).toBe("bad input");
    expect(out.stack).toContain("TypeError: bad input");
  });

  it("coerces non-Error values", () => {
    expect(serializeError("oops")).toEqual({ type: "Error", message: "oops" });
    expect(serializeError(404)).toEqual({ type: "Error", message: "404" });
  });
});

describe("logError", () => {
  it("passes serialized err and extra context to logger.error", () => {
    const errorSpy = vi.fn();
    const logger: Logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: errorSpy,
      child: vi.fn(),
    };

    const err = new Error("boom");
    logError(logger, "pipeline.run.failed", err, { runId: 7, platform: "ebay" });

    expect(errorSpy).toHaveBeenCalledOnce();
    expect(errorSpy).toHaveBeenCalledWith("pipeline.run.failed", {
      runId: 7,
      platform: "ebay",
      err: expect.objectContaining({ type: "Error", message: "boom" }),
    });
  });
});
